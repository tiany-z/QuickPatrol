/**
 * TOOL_AUTO_COMMIT_WITH_AI.js
 * 
 * 自动化读取当前 Git 仓库中所有未提交的修改（无论是否已 git add），
 * 提取代码 Diff 与修改文件概要，调用 AI 大模型接口智能生成符合
 * Conventional Commits 规范的 Commit Title。
 * 
 * 提交后自动将代码推送到远程仓库当前分支 (git push)。
 * 
 * 特性：
 *   - 选项单键即按即响应（按下 1/2/3 即刻执行）
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { getAiConfig, hasValidAiKey } from './config_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ----------------- 配置与参数 -----------------
const aiConfig = getAiConfig();
const OPENAI_API_KEY = aiConfig.apiKey;
const OPENAI_API_BASE = aiConfig.apiBase;
const OPENAI_MODEL = aiConfig.model;

/**
 * 清屏函数
 */
function clearScreen() {
  try {
    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J');
    console.clear?.();
  } catch {}
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

readline.emitKeypressEvents(process.stdin);

/**
 * 监听用户键盘按键（双重监听 keypress + data，零延迟即时捕获方向键与功能键）
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
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim() || 'ENTER');
      });
    }
  });
}

/**
 * 文本行输入问答（需要回车确认）
 */
function askQuestion(query) {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * 获取当前工作区的所有未提交变更（暂存区 + 未暂存区 + 未跟踪新文件）
 */
function getWorkingTreeChanges() {
  const statusShort = git(['status', '-s']);
  if (!statusShort) {
    return null;
  }

  let diffContent = git(['diff', 'HEAD'], { allowError: true });
  if (!diffContent) {
    const cachedDiff = git(['diff', '--cached'], { allowError: true });
    const unstagedDiff = git(['diff'], { allowError: true });
    diffContent = [cachedDiff, unstagedDiff].filter(Boolean).join('\n');
  }

  const statusLines = statusShort.split('\n').filter(Boolean);
  const untrackedFiles = statusLines
    .filter((line) => line.startsWith('??'))
    .map((line) => line.substring(3).trim());

  let untrackedSummary = '';
  if (untrackedFiles.length > 0) {
    untrackedSummary = `\n【新增未跟踪文件列表】：\n` + untrackedFiles.map((f) => `  + ${f}`).join('\n');
  }

  return {
    statusShort,
    untrackedFiles,
    statSummary: statusShort,
    diffContent: (diffContent + untrackedSummary).trim()
  };
}

/**
 * 获取本地尚未 push 到远程的 commits
 */
function getUnpushedCommits() {
  const cherry = git(['cherry', '-v'], { allowError: true });
  if (!cherry) return [];
  return cherry.split('\n').filter(Boolean).map((l) => l.trim());
}

/**
 * 清洗 AI 返回的 Title
 */
function cleanGeneratedTitle(raw) {
  let text = raw.trim();
  text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  text = text.replace(/^["'`]|["'`]$/g, '').trim();
  return text.split('\n')[0].trim();
}

/**
 * Commit Agent 专用工具集声明
 */
const COMMIT_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_file_diff',
      description: '获取工作区中特定文件的详细代码 git diff 差异内容',
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
      name: 'view_file_context',
      description: '读取项目中特定源码文件的部分代码片段，用于辅助理解代码修改意图',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '相对项目根目录的文件路径' },
          start_line: { type: 'number', description: '起始行号 (1-indexed)' },
          line_count: { type: 'number', description: '读取行数 (默认 40 行)' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish_commit_analysis',
      description: '完成分析并输出最终的规范 Commit Title 与结构化 Body 说明要点',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Conventional Commit Title: <type>(<scope>): <简明中文描述>' },
          body: { type: 'string', description: '多行结构化 Commit 说明要点（使用 • 分列 2~4 条核心变动）' }
        },
        required: ['title', 'body']
      }
    }
  }
];

/**
 * 运行 Commit Agent 自主感知分析并生成提交信息
 */
async function runCommitAgent(changes, attempt = 1) {
  const url = OPENAI_API_BASE.endsWith('/v1')
    ? `${OPENAI_API_BASE}/chat/completions`
    : `${OPENAI_API_BASE}/v1/chat/completions`;

  const systemPrompt = `你是一个 Git 专家与代码提交智能体 (Git Commit Agent)。
你的核心目标是深入理解当前工作区的未提交代码变更，洞察核心意图与架构影响，生成极为严谨专业的 Conventional Commit 提交信息。

【你拥有的工具能力】：
1. get_file_diff: 当某个文件的变更较多或值得深入研读时，调用该工具查看该文件的独立 diff。
2. view_file_context: 当单看 diff 无法确认上下文函数或类型定义时，调用该工具阅读源码上下文。
3. finish_commit_analysis: 当你掌握了本次提交的核心脉络后，务必调用此工具输出最终结果。

【规范要求】：
1. Title 格式：<type>(<scope>): <简短中文描述>
   - type 必须为：feat, fix, docs, style, refactor, perf, test, chore, build, ci
   - scope 为模块（如 tools, host, backend, router, config, readme 等）
   - 描述在 10~30 汉字以内，精准清晰，严禁泛泛而谈。
2. Body 格式：2~4 条精炼的要点列表，每行以 "• " 开头，概述关键设计与改动细节。
${attempt > 1 ? `\n【注意】：当前是第 ${attempt} 次重试，请尝试从不同切入点更准确地总结。` : ''}
`;

  const conversation = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `请分析以下工作区未提交变更，必要时调用工具深入探查关键文件，最终输出规范的 Commit Title 和 Body：\n\n【变更状态统计】：\n${changes.statusShort}\n\n【全局 Diff 概要】：\n${changes.diffContent.slice(0, 3500)}`
    }
  ];

  let maxSteps = 5;
  let finalResult = null;

  for (let step = 1; step <= maxSteps; step++) {
    const payload = {
      model: OPENAI_MODEL,
      messages: conversation,
      tools: COMMIT_AGENT_TOOLS,
      tool_choice: 'auto',
      temperature: attempt === 1 ? 0.2 : 0.6
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Agent 请求失败 (HTTP ${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('AI Agent 返回空响应');
    }

    const assistantMsg = choice.message;
    conversation.push(assistantMsg);

    // 终端实时打印思考内容
    const reasoning = assistantMsg.reasoning_content || assistantMsg.thought;
    if (reasoning) {
      console.log(`\n  🧠 \x1b[35m[Commit Agent 思考]\x1b[0m ${reasoning.slice(0, 160).replace(/\n/g, ' ')}...`);
    } else if (assistantMsg.content && !assistantMsg.tool_calls) {
      console.log(`\n  🧠 \x1b[35m[Commit Agent 分析]\x1b[0m ${assistantMsg.content.slice(0, 160).replace(/\n/g, ' ')}...`);
    }

    // 检查工具调用
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const call of assistantMsg.tool_calls) {
        const toolName = call.function.name;
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {}

        if (toolName === 'finish_commit_analysis') {
          finalResult = {
            title: cleanGeneratedTitle(args.title || ''),
            body: (args.body || '').trim()
          };
          console.log(`\n  🎯 \x1b[32m[Commit Agent 决议]\x1b[0m 生成目标: ${finalResult.title}`);
          break;
        } else if (toolName === 'get_file_diff') {
          console.log(`  🛠️  \x1b[36m[Commit Agent 探查]\x1b[0m 深入研读文件 diff: \x1b[33m${args.file_path}\x1b[0m`);
          let fileDiff = git(['diff', 'HEAD', '--', args.file_path], { allowError: true });
          if (!fileDiff) {
            fileDiff = git(['diff', '--', args.file_path], { allowError: true }) || '(该文件为新增或无 diff)';
          }
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: fileDiff.slice(0, 4000)
          });
        } else if (toolName === 'view_file_context') {
          console.log(`  🛠️  \x1b[36m[Commit Agent 探查]\x1b[0m 检视源码上下文: \x1b[33m${args.file_path}\x1b[0m`);
          const fullPath = path.resolve(PROJECT_ROOT, args.file_path);
          let contextSnippet = '';
          try {
            if (fs.existsSync(fullPath)) {
              const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
              const start = Math.max(1, args.start_line || 1);
              const count = args.line_count || 40;
              contextSnippet = lines.slice(start - 1, start - 1 + count).map((l, i) => `${start + i}: ${l}`).join('\n');
            } else {
              contextSnippet = `文件不存在: ${args.file_path}`;
            }
          } catch (e) {
            contextSnippet = `读取失败: ${e.message}`;
          }
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: contextSnippet.slice(0, 3000)
          });
        }
      }

      if (finalResult) {
        return finalResult;
      }
    } else {
      // 模型没有调工具，直接给出了文本
      const raw = assistantMsg.content || '';
      const lines = raw.split('\n').filter(Boolean);
      const title = cleanGeneratedTitle(lines[0] || 'feat(project): 优化与更新项目代码');
      const body = lines.slice(1).join('\n').trim();
      return { title, body };
    }
  }

  // 若超出步数，做最后兜底提取
  return {
    title: 'chore(project): 提交未分类代码变更与系统调整',
    body: '• 自动更新代码变更与相关配置文件'
  };
}

/**
 * 执行 Git Push
 */
function pushToRemote(branch) {
  console.log(`\n🚀 正在推送到远程仓库: origin/${branch} (git push origin ${branch}) ...`);
  try {
    const pushResult = git(['push', 'origin', branch]);
    console.log('✔ 推送远程仓库成功！');
    if (pushResult) {
      console.log(pushResult);
    }
  } catch (err) {
    console.error(`\n⚠️ 推送远程仓库失败: ${err.message}`);
    console.log('💡 提示：您可以稍后手动执行 `git push origin ' + branch + '` 再次尝试推送。');
  }
}

/**
 * 主流程
 */
async function main() {
  if (!hasValidAiKey()) {
    clearScreen();
    console.log('\n+========================================================================+');
    console.log('|\t⚠️  [AI 未配置] 当前尚未配置 AI API Key，该功能暂不可用！');
    console.log('|\t👉 请前往总控台 [⚙️  AI 接口参数配置] 完成设置。');
    console.log('+========================================================================+\n');
    await getKeyPress('👉 按 [回车] 返回主菜单...');
    process.exit(0);
  }

  clearScreen();

  const currentBranch = git(['branch', '--show-current']) || 'main';

  // 1. 检查工作区修改
  const changes = getWorkingTreeChanges();
  if (!changes) {
    console.log('+------------------------------------------------------------------------+');
    console.log('|\t✨ 当前工作区非常干净，没有检测到任何未提交的代码修改！');
    console.log('+------------------------------------------------------------------------+');

    const unpushed = getUnpushedCommits();
    if (unpushed.length > 0) {
      console.log(`\n📦 检测到本地有 \x1b[1m\x1b[33m${unpushed.length}\x1b[0m 个已提交但尚未推送到远程的 Commit：`);
      unpushed.forEach((c) => console.log(`\t${c}`));

      const unpushedOptions = [
        { id: 'push', label: '✔ 立即执行 git push 推送到远程' },
        { id: 'exit', label: '🚪 退出程序' }
      ];
      let unpushedCursor = 0;

      while (true) {
        console.log('\n+------------------------------------------------------------------------+');
        unpushedOptions.forEach((opt, idx) => {
          const isFocused = idx === unpushedCursor;
          const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
          if (isFocused) {
            console.log(`${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m`);
          } else {
            console.log(`${pointer}\x1b[37m${opt.label}\x1b[0m`);
          }
        });
        console.log('\n+------------------------------------------------------------------------+');
        console.log('操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 退出]\n');

        const key = await getKeyPress();
        if (key === 'ESC' || (key === 'ENTER' && unpushedOptions[unpushedCursor].id === 'exit')) {
          console.log('\n🚪 已退出。\n');
          process.exit(0);
        }
        if (key === 'UP' || key === 'DOWN') {
          unpushedCursor = 1 - unpushedCursor;
          continue;
        }
        if (key === 'ENTER' && unpushedOptions[unpushedCursor].id === 'push') {
          pushToRemote(currentBranch);
          break;
        }
      }
    } else {
      console.log('\n✔ 本地分支与远程仓库完全同步。');
    }

    process.exit(0);
  }

  const startOptions = [
    { id: 'start', label: '✔ 立即调用 AI 大模型分析代码变更并生成提交信息' },
    { id: 'cancel', label: '🚪 取消并返回主菜单' }
  ];
  let startCursor = 0;

  function renderStartMenu(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🤖 Git AI 智能代码变更分析与自动提交推送工具\n';
    out += '+========================================================================+\n';
    out += `\n\t📌 当前分支:\t\x1b[1m\x1b[36m${currentBranch}\x1b[0m\n\n`;

    out += '+------------------------------------------------------------------------+\n';
    out += '|\t📋 检测到以下文件变更:\n';
    out += '+------------------------------------------------------------------------+\n';
    changes.statusShort.split('\n').forEach((l) => {
      out += `\t${l}\n`;
    });
    out += '+------------------------------------------------------------------------+\n\n';

    startOptions.forEach((opt, index) => {
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
    renderStartMenu(startCursor);

    const key = await getKeyPress();

    if (key === 'ESC' || (key === 'ENTER' && startOptions[startCursor].id === 'cancel')) {
      console.log('\n🚪 已取消操作，未消耗任何 AI 接口额度。\n');
      process.exit(0);
    }

    if (key === 'UP') {
      startCursor = (startCursor - 1 + startOptions.length) % startOptions.length;
      renderStartMenu(startCursor);
      continue;
    }

    if (key === 'DOWN') {
      startCursor = (startCursor + 1) % startOptions.length;
      renderStartMenu(startCursor);
      continue;
    }

    if (key === 'ENTER' && startOptions[startCursor].id === 'start') {
      break;
    }
  }

  // 2. 循环生成与用户确认
  let attempt = 1;
  while (true) {
    console.log(`\n⏳ [第 ${attempt} 次尝试] 正在唤起 Commit Agent 自主感知代码变更并生成结构化提交...`);
    
    let commitInfo = null;
    try {
      commitInfo = await runCommitAgent(changes, attempt);
      console.log('✔ Agent 智能审计完成！');
    } catch (err) {
      console.log('\n❌ Commit Agent 执行失败:', err.message);
      const retryOptions = [
        { id: 'retry', label: '🔄 重试调用 Agent' },
        { id: 'exit', label: '🚪 退出程序' }
      ];
      let retryCursor = 0;
      while (true) {
        clearScreen();
        console.log('\n❌ Commit Agent 执行失败:', err.message);
        console.log('\n请选择处理方式：\n');
        retryOptions.forEach((opt, idx) => {
          const isFocused = idx === retryCursor;
          const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
          console.log(`${pointer}${opt.label}`);
        });
        const rKey = await getKeyPress();
        if (rKey === 'ESC' || (rKey === 'ENTER' && retryOptions[retryCursor].id === 'exit')) {
          process.exit(1);
        }
        if (rKey === 'UP' || rKey === 'DOWN') {
          retryCursor = 1 - retryCursor;
          continue;
        }
        if (rKey === 'ENTER' && retryOptions[retryCursor].id === 'retry') {
          break;
        }
      }
      attempt++;
      continue;
    }

    const actionOptions = [
      { id: 'commit_push', label: '🚀 确认提交并推送到远程 (git commit + git push)' },
      { id: 'commit_local', label: '📦 仅在本地提交，不推送远程 (git commit)' },
      { id: 'edit_title', label: '✏️  交互式微调提交标题' },
      { id: 'regenerate', label: '🔄 让 Commit Agent 换个视角重新分析' },
      { id: 'cancel', label: '🚪 取消并退出程序' }
    ];
    let actionCursor = 0;

    function renderActionMenu(idx) {
      let out = '';
      out += '+========================================================================+\n';
      out += '|\t🎯 Commit Agent 智能代码审计与提议完成:\n';
      out += `|\t📌 提交标题:\t\x1b[1m\x1b[32m${commitInfo.title}\x1b[0m\n`;
      if (commitInfo.body) {
        out += '|\t📝 结构化说明:\n';
        commitInfo.body.split('\n').filter(Boolean).forEach((line) => {
          out += `|\t   \x1b[36m${line}\x1b[0m\n`;
        });
      }
      out += '+========================================================================+\n\n';
      out += '请选择后续操作：\n\n';

      actionOptions.forEach((opt, index) => {
        const isFocused = index === idx;
        const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
        if (isFocused) {
          out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m\n`;
        } else {
          out += `${pointer}\x1b[37m${opt.label}\x1b[0m\n`;
        }
      });

      out += '\n+------------------------------------------------------------------------+\n';
      out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 取消退出]\n';

      process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
    }

    let userAction = null;
    while (true) {
      renderActionMenu(actionCursor);

      const key = await getKeyPress();

      if (key === 'ESC' || (key === 'ENTER' && actionOptions[actionCursor].id === 'cancel')) {
        console.log('\n🚪 已取消操作。\n');
        process.exit(0);
      }

      if (key === 'UP') {
        actionCursor = (actionCursor - 1 + actionOptions.length) % actionOptions.length;
        continue;
      }

      if (key === 'DOWN') {
        actionCursor = (actionCursor + 1) % actionOptions.length;
        continue;
      }

      if (key === 'ENTER') {
        userAction = actionOptions[actionCursor].id;
        break;
      }
    }

    if (userAction === 'edit_title') {
      console.log('\n--------------------------------------------------------------------------');
      console.log(`当前标题: \x1b[1m\x1b[33m${commitInfo.title}\x1b[0m`);
      const edited = await askQuestion('👉 请输入微调后的 Commit 标题 (直接回车保留原标题): ');
      if (edited && edited.trim()) {
        commitInfo.title = cleanGeneratedTitle(edited.trim());
      }
      continue;
    }

    if (userAction === 'regenerate') {
      attempt++;
      continue;
    }

    if (userAction === 'commit_push' || userAction === 'commit_local') {
      console.log('\n📦 正在执行 git add -A ...');
      git(['add', '-A']);

      console.log(`📝 正在执行 git commit ...`);
      const commitArgs = ['commit', '-m', commitInfo.title];
      if (commitInfo.body) {
        commitArgs.push('-m', commitInfo.body);
      }
      const commitOutput = git(commitArgs);

      console.log('\n+========================================================================+');
      console.log('|\t🎉 本地代码提交成功！');
      console.log('+========================================================================+');
      if (commitOutput) {
        console.log(commitOutput);
      }

      if (userAction === 'commit_push') {
        pushToRemote(currentBranch);
      } else {
        console.log('\n💡 提示：本次为纯本地提交，未推送到远程。您可随时稍后手动执行 git push。');
      }

      console.log('\n+========================================================================+');
      console.log('|\t✨ 全部流程执行完成！');
      console.log('+========================================================================+\n');
      await getKeyPress('👉 按 [回车] 或 [ESC] 返回主菜单...');
      process.exit(0);
    }
  }
  process.exit(0);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 运行发生异常:', err);
  process.exit(1);
});
