/**
 * TOOL_OPTIMIZE_COMMIT_TITLES.js
 * 
 * 自动化检测当前 Git 仓库所有分支中的 Commit Title，
 * 找出不符合 Conventional Commits 格式 (type(scope): description) 的提交，
 * 调用 AI 大模型接口根据代码变更 Diff 智能生成规范 Title，
 * 随后使用 Git 底层 Plumbing 命令重构整个提交历史图 (DAG)，保持拓扑结构与作者元数据。
 */

import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { getAiConfig } from './config_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ----------------- 配置与参数 -----------------
const aiConfig = getAiConfig();
const OPENAI_API_KEY = aiConfig.apiKey;
const OPENAI_API_BASE = aiConfig.apiBase;
const OPENAI_MODEL = aiConfig.model;

// 检查是否仅测试运行（不实际修改 git 历史）
const isDryRun = process.argv.includes('--dry-run');
// 检查是否自动执行 git push
const autoPush = !process.argv.includes('--no-push');

// 规范格式正则：如 feat(host): xxx, docs(readme): xxx, chore(merge): xxx
const CONVENTION_REGEX = /^[a-zA-Z0-9_\-]+\([a-zA-Z0-9_\-\/\.]+\)\s*:\s*.+$/;

readline.emitKeypressEvents(process.stdin);

/**
 * 监听用户键盘按键（基于 Node.js keypress 事件，零延迟捕获方向键）
 */
function getKeyPress(promptText = '') {
  if (promptText) {
    process.stdout.write(promptText);
  }

  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let resolved = false;
      const cleanupAndResolve = (result) => {
        if (resolved) return;
        resolved = true;
        process.stdin.removeListener('keypress', onKeypress);
        process.stdin.removeListener('data', onData);
        resolve(result);
      };

      const onKeypress = (str, key) => {
        if (key && key.ctrl && key.name === 'c') {
          console.log('\n');
          process.exit(0);
        }

        if (key) {
          if (key.name === 'up' || key.name === 'k' || key.name === 'w') return cleanupAndResolve('UP');
          if (key.name === 'down' || key.name === 'j' || key.name === 's') return cleanupAndResolve('DOWN');
          if (key.name === 'return' || key.name === 'enter') return cleanupAndResolve('ENTER');
          if (key.name === 'escape') return cleanupAndResolve('ESC');
          if (key.name === 'space') return cleanupAndResolve('SPACE');
          if (key.name) return cleanupAndResolve(key.name.toLowerCase());
        }

        if (str === '\u001b[A' || str === '\x1bOA') return cleanupAndResolve('UP');
        if (str === '\u001b[B' || str === '\x1bOB') return cleanupAndResolve('DOWN');
        if (str === '\r' || str === '\n') return cleanupAndResolve('ENTER');
        if (str === '\u001b') return cleanupAndResolve('ESC');
        if (str === ' ') return cleanupAndResolve('SPACE');
        if (str) return cleanupAndResolve(str.trim());
      };

      const onData = (chunk) => {
        const str = chunk.toString();
        if (str === '\u0003') {
          console.log('\n');
          process.exit(0);
        }
        if (str === '\u001b[A' || str === '\x1bOA') return cleanupAndResolve('UP');
        if (str === '\u001b[B' || str === '\x1bOB') return cleanupAndResolve('DOWN');
        if (str === '\r' || str === '\n' || str === '\r\n') return cleanupAndResolve('ENTER');
        if (str === '\u001b') return cleanupAndResolve('ESC');
        if (str === ' ') return cleanupAndResolve('SPACE');
        if (str === 'k' || str === 'K' || str === 'w' || str === 'W') return cleanupAndResolve('UP');
        if (str === 'j' || str === 'J' || str === 's' || str === 'S') return cleanupAndResolve('DOWN');
        if (str === 'q' || str === 'Q') return cleanupAndResolve('ESC');
      };

      process.stdin.on('keypress', onKeypress);
      process.stdin.on('data', onData);
    } else {
      resolve('ENTER');
    }
  });
}

/**
 * 执行 Git 命令并返回 UTF-8 字符串
 */
function git(args, options = {}) {
  try {
    const res = spawnSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 30 * 1024 * 1024,
      ...options
    });
    if (res.status !== 0 && !options.allowError) {
      throw new Error(`Git command failed [git ${args.join(' ')}]: ${res.stderr || res.stdout}`);
    }
    return (res.stdout || '').trim();
  } catch (err) {
    if (options.allowError) return '';
    throw err;
  }
}

/**
 * 获取所有本地分支列表及对应的 HEAD Commit Hash
 */
function getLocalBranches() {
  const output = git(['for-each-ref', '--format=%(refname:short)|%(objectname)', 'refs/heads']);
  const branches = {};
  for (const line of output.split('\n').filter(Boolean)) {
    const [name, head] = line.split('|');
    branches[name] = head;
  }
  return branches;
}

/**
 * 确定某个 commit 存在于哪些本地分支中
 */
function getBranchesContainingCommit(sha, branchList) {
  const containing = [];
  for (const branch of branchList) {
    const res = git(['merge-base', '--is-ancestor', sha, branch], { allowError: true });
    // returncode 0 means ancestor
    const check = spawnSync('git', ['merge-base', '--is-ancestor', sha, branch]);
    if (check.status === 0) {
      containing.push(branch);
    }
  }
  return containing;
}

/**
 * Commit Audit Agent 专用工具声明
 */
const AUDIT_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_commit_file_diff',
      description: '获取指定 Commit 中某个特定文件的详细代码改动 Diff',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对项目根目录的文件路径' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish_audit',
      description: '完成审计并输出最优的 Conventional Commit 规范标题',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '规范化 Commit 标题: <type>(<scope>): <简明描述>' },
          reason: { type: 'string', description: '重构理由与依据' }
        },
        required: ['title']
      }
    }
  }
];

/**
 * 运行 Commit Audit Agent 对历史 Commit 进行深入审计与规范化判定
 */
async function runCommitAuditAgent(sha, oldTitle) {
  let statContent = '';
  try {
    statContent = git(['show', '--stat', '--oneline', sha]);
  } catch {
    statContent = git(['log', '-1', '--stat', sha], { allowError: true });
  }

  const systemPrompt = `你是一个 Git 提交规范化与历史代码审计智能体 (Commit Audit Agent)。
你的核心目标是审计一个旧的历史 Commit，探查其实际修改代码与涉及子模块，将其优化为一个精准符合 Conventional Commits 规范的优秀 Title。

【工具能力】：
1. get_commit_file_diff: 当需要研读特定文件的具体修改时调用；
2. finish_audit: 准备就绪时调用此工具输出最终标题。

【格式规范要求】：
1. 必须是：<type>(<scope>): <简短中文描述>
   - type 属于：feat, fix, docs, style, refactor, perf, test, chore, build, ci
   - scope 为模块名（如 host, backend, router, web, tools, config, merge, project 等）
   - 描述在 10~30 个汉字以内，精准概括核心变动，严禁模棱两可。
2. 严禁带有 markdown、反引号或多余解释前缀。
`;

  const conversation = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `请审计以下 Commit 并规范化其标题：\n\nCommit Hash: ${sha}\n原始标题: "${oldTitle}"\n\n【文件修改统计】：\n${statContent.slice(0, 3000)}`
    }
  ];

  const url = OPENAI_API_BASE.endsWith('/v1')
    ? `${OPENAI_API_BASE}/chat/completions`
    : `${OPENAI_API_BASE}/v1/chat/completions`;

  let maxSteps = 4;
  let finalTitle = '';

  for (let step = 1; step <= maxSteps; step++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: conversation,
        tools: AUDIT_AGENT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`AI API 请求失败 (HTTP ${response.status}): ${errBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      break;
    }

    const assistantMsg = choice.message;
    conversation.push(assistantMsg);

    const reasoning = assistantMsg.reasoning_content || assistantMsg.thought;
    if (reasoning) {
      process.stdout.write(`\n     🧠 \x1b[35m[审计思考]\x1b[0m ${reasoning.slice(0, 90).replace(/\n/g, ' ')}... `);
    }

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const call of assistantMsg.tool_calls) {
        const toolName = call.function.name;
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {}

        if (toolName === 'finish_audit') {
          finalTitle = args.title || '';
          break;
        } else if (toolName === 'get_commit_file_diff') {
          process.stdout.write(`\n     🛠️  \x1b[36m[探查改动]\x1b[0m ${args.file_path} `);
          let fileDiff = '';
          try {
            fileDiff = git(['show', `${sha}`, '--', args.file_path], { allowError: true });
          } catch {}
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: fileDiff.slice(0, 3000) || '(无 diff)'
          });
        }
      }

      if (finalTitle) {
        break;
      }
    } else {
      const raw = (assistantMsg.content || '').trim().split('\n')[0];
      finalTitle = raw;
      break;
    }
  }

  let clean = (finalTitle || oldTitle).replace(/^[`'"]+|[`'"]+$/g, '').trim();
  if (!CONVENTION_REGEX.test(clean)) {
    if (oldTitle.includes('Merge branch')) {
      clean = 'chore(merge): 合并远程分支最新变更';
    } else {
      clean = `feat(project): ${clean.replace(/^[^:]*:\s*/, '')}`;
    }
  }
  return clean;
}

/**
 * 主执行流程
 */
async function main() {
  console.log('='.repeat(70));
  console.log('🚀 高校后勤巡查e速办 Git Commit Title 智能规范化与历史重写工具');
  console.log('='.repeat(70));
  console.log(`📡 AI API Base       : ${OPENAI_API_BASE}`);
  console.log(`🤖 AI Model          : ${OPENAI_MODEL}`);
  console.log(`🔑 API Key (已配置)  : ${OPENAI_API_KEY.substring(0, 8)}...${OPENAI_API_KEY.slice(-4)}`);
  console.log(`⚙️ 运行模式          : ${isDryRun ? '🔍 仅预览 (Dry Run)' : '⚡ 实际重写并更新分支'}`);
  console.log('-'.repeat(70));

  // 1. 获取当前分支
  const initialBranch = git(['branch', '--show-current']);
  if (!initialBranch) {
    console.error('❌ 错误：当前处于游离 HEAD 状态 (detached HEAD)，请先切换到具体分支。');
    process.exit(1);
  }
  console.log(`📌 当前所在分支: \x1b[36m${initialBranch}\x1b[0m`);

  // 2. 获取所有本地分支
  const branchMap = getLocalBranches();
  const branchNames = Object.keys(branchMap);
  console.log(`🌿 本地分支总数: ${branchNames.length} (${branchNames.join(', ')})`);

  // 3. 按照拓扑顺序获取所有提交 (从旧到新)
  const allShasOutput = git(['rev-list', '--topo-order', '--reverse', '--all']);
  const allShas = allShasOutput.split('\n').map(s => s.trim()).filter(Boolean);
  console.log(`📜 仓库内全分支涉及 Commit 总数: ${allShas.length}`);

  // 4. 扫描并找出所有不符合格式的 Commit
  const nonConformingCommits = [];
  for (const sha of allShas) {
    const subject = git(['log', '-1', '--format=%s', sha]);
    if (!CONVENTION_REGEX.test(subject.trim())) {
      nonConformingCommits.push({
        sha,
        shortSha: sha.substring(0, 7),
        oldTitle: subject.trim(),
        branches: getBranchesContainingCommit(sha, branchNames)
      });
    }
  }

  console.log(`\n🔍 扫描完成，发现 \x1b[33m${nonConformingCommits.length}\x1b[0m 个格式不规范的 Commit:`);
  nonConformingCommits.forEach((c, idx) => {
    console.log(`   [${idx + 1}] ${c.shortSha} | 所在分支: [${c.branches.join(', ')}] | 原始Title: "${c.oldTitle}"`);
  });

  if (nonConformingCommits.length === 0) {
    console.log('\n🎉 所有 Commit 的 Title 均已符合 xxx(xxx): xxx 规范，无需修改！');
    process.exit(0);
  }

  const confirmOptions = [
    { id: 'start', label: `✔ 开始调用 AI 大模型批量优化这 ${nonConformingCommits.length} 个 Commit Title` },
    { id: 'cancel', label: '🚪 取消并返回主菜单' }
  ];
  let confirmCursor = 0;

  function renderConfirmMenu(idx) {
    let out = '';
    out += '+------------------------------------------------------------------------+\n';
    out += `|\t🤖 即将调用 AI 大模型为以上 ${nonConformingCommits.length} 个 Commit 生成规范 Title\n`;
    out += '+------------------------------------------------------------------------+\n\n';

    confirmOptions.forEach((opt, index) => {
      const isFocused = index === idx;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m\n`;
      } else {
        out += `${pointer}\x1b[37m${opt.label}\x1b[0m\n`;
      }
    });

    out += '\n+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 取消返回]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderConfirmMenu(confirmCursor);

    const confirmKey = await getKeyPress();

    if (confirmKey === 'ESC' || (confirmKey === 'ENTER' && confirmOptions[confirmCursor].id === 'cancel')) {
      console.log('\n🚪 已取消操作，未消耗任何 AI 接口额度。\n');
      process.exit(0);
    }

    if (confirmKey === 'UP') {
      confirmCursor = (confirmCursor - 1 + confirmOptions.length) % confirmOptions.length;
      renderConfirmMenu(confirmCursor);
      continue;
    }

    if (confirmKey === 'DOWN') {
      confirmCursor = (confirmCursor + 1) % confirmOptions.length;
      renderConfirmMenu(confirmCursor);
      continue;
    }

    if (confirmKey === 'ENTER' && confirmOptions[confirmCursor].id === 'start') {
      break;
    }
  }

  // 5. 逐个调用 Commit Audit Agent 深入代码审计并生成新 Title
  console.log('\n' + '-'.repeat(70));
  console.log('🤖 正在启动 Commit Audit Agent 对不规范的 Commit 展开深入代码审计...');
  console.log('-'.repeat(70));

  const newTitleMap = new Map();
  for (let i = 0; i < nonConformingCommits.length; i++) {
    const item = nonConformingCommits[i];
    console.log(`\n⏳ [${i + 1}/${nonConformingCommits.length}] Commit Agent 正在审计 ${item.shortSha} ("${item.oldTitle}")...`);
    try {
      const newTitle = await runCommitAuditAgent(item.sha, item.oldTitle);
      newTitleMap.set(item.sha, newTitle);
      item.newTitle = newTitle;
      console.log(`\n   \x1b[32m✔ 审计完成\x1b[0m 优化后 Title: \x1b[32m"${newTitle}"\x1b[0m`);
    } catch (err) {
      console.log(`\n   \x1b[31m✖ 审计失败\x1b[0m (${err.message})`);
      process.exit(1);
    }
  }

  if (isDryRun) {
    console.log('\n🔍 [Dry Run 模式结束] 未对 Git 历史做任何修改。如需实际重写，请去掉 --dry-run 参数执行。');
    return;
  }

  // 6. 重写 Git 历史 (DAG 拓扑重构)
  console.log('\n' + '-'.repeat(70));
  console.log('🔨 正在重构 Git 提交历史 (保持元数据、树对象与父子拓扑关系)...');
  console.log('-'.repeat(70));

  const oldToNewShaMap = new Map();
  const modifiedCommitLog = [];

  for (const sha of allShas) {
    // 获取提交完整元数据
    const metaStr = git(['log', '-1', '--format=%an|%ae|%ad|%cn|%ce|%cd|%T|%P', '--date=raw', sha]);
    const [an, ae, ad, cn, ce, cd, tree, rawParents] = metaStr.split('|');
    const oldParents = rawParents ? rawParents.split(/\s+/).filter(Boolean) : [];
    const oldSubject = git(['log', '-1', '--format=%s', sha]).trim();
    const oldBody = git(['log', '-1', '--format=%b', sha]).trim();

    // 映射父提交为新的 SHA
    const newParents = oldParents.map(p => oldToNewShaMap.get(p) || p);
    const parentsChanged = newParents.some((np, idx) => np !== oldParents[idx]);
    const titleNeedsChange = newTitleMap.has(sha);

    if (!parentsChanged && !titleNeedsChange) {
      // 本提交及其祖先未变动
      oldToNewShaMap.set(sha, sha);
      continue;
    }

    // 确定新的 Commit Message
    const targetTitle = titleNeedsChange ? newTitleMap.get(sha) : oldSubject;
    const finalMessage = oldBody ? `${targetTitle}\n\n${oldBody}` : targetTitle;

    // 构造 git commit-tree 命令参数
    const commitTreeArgs = ['commit-tree', tree];
    for (const np of newParents) {
      commitTreeArgs.push('-p', np);
    }

    // 执行 git commit-tree 创建新 Commit 对象
    const commitRes = spawnSync('git', commitTreeArgs, {
      input: finalMessage,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: an,
        GIT_AUTHOR_EMAIL: ae,
        GIT_AUTHOR_DATE: ad,
        GIT_COMMITTER_NAME: cn,
        GIT_COMMITTER_EMAIL: ce,
        GIT_COMMITTER_DATE: cd
      }
    });

    if (commitRes.status !== 0) {
      throw new Error(`git commit-tree 失败 [${sha}]: ${commitRes.stderr}`);
    }

    const newSha = commitRes.stdout.trim();
    oldToNewShaMap.set(sha, newSha);

    if (titleNeedsChange) {
      const affectedBranches = nonConformingCommits.find(c => c.sha === sha)?.branches || [];
      modifiedCommitLog.push({
        oldSha: sha.substring(0, 7),
        newSha: newSha.substring(0, 7),
        oldTitle: oldSubject,
        newTitle: targetTitle,
        branches: affectedBranches
      });
    }
  }

  // 7. 更新所有受影响的本地分支引用 (refs/heads/*)
  console.log('\n🌿 正在更新本地所有分支 HEAD 引用...');
  const updatedBranches = [];
  for (const [bName, oldHead] of Object.entries(branchMap)) {
    const newHead = oldToNewShaMap.get(oldHead);
    if (newHead && newHead !== oldHead) {
      git(['update-ref', `refs/heads/${bName}`, newHead]);
      updatedBranches.push({ name: bName, oldHead: oldHead.substring(0, 7), newHead: newHead.substring(0, 7) });
      console.log(`   ✔ 分支 [${bName}]: ${oldHead.substring(0, 7)} -> ${newHead.substring(0, 7)}`);
    } else {
      console.log(`   - 分支 [${bName}]: 无需更新 (已是最新)`);
    }
  }

  // 8. 确保切回并同步当前分支引用
  console.log(`\n🔄 正在切回并同步当前分支 [\x1b[36m${initialBranch}\x1b[0m]...`);
  git(['checkout', initialBranch]);
  const currentBranchNewHead = oldToNewShaMap.get(branchMap[initialBranch]) || branchMap[initialBranch];
  git(['reset', '--soft', currentBranchNewHead]);
  console.log(`   ✔ 当前分支已无缝对齐到最新 Commit: ${currentBranchNewHead.substring(0, 7)}`);

  // 9. 打印终端详细报告
  console.log('\n' + '='.repeat(70));
  console.log('📋 优化修改详细汇总报告');
  console.log('='.repeat(70));
  modifiedCommitLog.forEach((item, idx) => {
    console.log(`\n[#${idx + 1}] 涉及分支: \x1b[35m${item.branches.join(', ')}\x1b[0m`);
    console.log(`    旧 Commit: \x1b[31m${item.oldSha}\x1b[0m -> 新 Commit: \x1b[32m${item.newSha}\x1b[0m`);
    console.log(`    原始 Title: \x1b[31m"${item.oldTitle}"\x1b[0m`);
    console.log(`    优化 Title: \x1b[32m"${item.newTitle}"\x1b[0m`);
  });

  // 10. 保存与推送到 GitHub 远程仓库
  console.log('\n' + '-'.repeat(70));
  console.log('🚀 保存并同步至 GitHub 远程仓库...');
  console.log('-'.repeat(70));

  if (autoPush) {
    console.log('📡 正在执行: git push origin --force --all && git push origin --force --tags');
    try {
      const pushBranches = git(['push', 'origin', '--force', '--all']);
      console.log('✔ 分支全量强推成功:\n', pushBranches || '(All branches up to date)');
      const pushTags = git(['push', 'origin', '--force', '--tags'], { allowError: true });
      if (pushTags) console.log('✔ Tags 同步成功:\n', pushTags);
      console.log('\n🎉 所有优化后的 Commit 已成功同步并保存到 GitHub 远程仓库！');
    } catch (err) {
      console.warn('\n⚠️ 自动推送遇到网络或权限限制，您可以通过以下命令手动推送到 GitHub:');
      console.log('   \x1b[33mgit push origin --force --all\x1b[0m');
      console.log('   \x1b[33mgit push origin --force --tags\x1b[0m');
    }
  } else {
    console.log('💡 已跳过自动推送。您可以手动执行以下命令推送到 GitHub:');
    console.log('   \x1b[33mgit push origin --force --all\x1b[0m');
  }

  console.log('\n' + '='.repeat(70));
  console.log(`✨ 全部完成！当前依然处于分支: \x1b[36m${git(['branch', '--show-current'])}\x1b[0m`);
  console.log('='.repeat(70) + '\n');
  await getKeyPress('👉 按 [回车] 或 [ESC] 返回主菜单...');
  process.exit(0);
}

// 执行入口
main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ 运行过程中发生错误:', err);
  process.exit(1);
});
