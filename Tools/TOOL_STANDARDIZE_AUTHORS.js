/**
 * TOOL_STANDARDIZE_AUTHORS.js
 * 
 * 遍历所有分支的全部 commit，将所有提交者与提交人信息（无任何例外）
 * 全部统一修改为当前 Git 用户（或指定用户）：张天予 <zhangtianyu200444@126.com>
 * 然后重构 Git DAG 历史、更新分支引用并强制推送到 GitHub 远程仓库。
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

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

async function main() {
  const currentName = git(['config', 'user.name'], { allowError: true }) || '张天予';
  const currentEmail = git(['config', 'user.email'], { allowError: true }) || 'zhangtianyu200444@126.com';

  const TARGET_NAME = currentName;
  const TARGET_EMAIL = currentEmail;

  const initialBranch = git(['branch', '--show-current'], { allowError: true });
  if (!initialBranch) {
    console.error('❌ 错误：当前处于 detached HEAD 状态，请先切换到具体分支。');
    process.exit(1);
  }

  // 获取所有本地分支
  const branchOutput = git(['for-each-ref', '--format=%(refname:short)|%(objectname)', 'refs/heads']);
  const branchMap = {};
  for (const line of branchOutput.split('\n').filter(Boolean)) {
    const [name, head] = line.split('|');
    branchMap[name] = head;
  }

  // 获取所有 commit（按拓扑顺序）
  const allShas = git(['rev-list', '--topo-order', '--reverse', '--all'])
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const confirmOptions = [
    { id: 'confirm', label: `✔ 确认将全部历史提交者统一修改为 "${TARGET_NAME} <${TARGET_EMAIL}>"` },
    { id: 'cancel', label: '🚪 取消并返回' }
  ];
  let confirmCursor = 0;

  function renderStandardizeMenu(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t👤 Git 提交者账号全量规范化工具\n';
    out += `|\t🎯 目标账号:\t\x1b[1m\x1b[32m${TARGET_NAME}\x1b[0m <\x1b[1m\x1b[36m${TARGET_EMAIL}\x1b[0m>\n`;
    out += '+========================================================================+\n\n';
    out += `📌 当前所在分支:\t\x1b[1m\x1b[36m${initialBranch}\x1b[0m\n`;
    out += `🌿 待同步分支:\t${Object.keys(branchMap).join(', ')}\n`;
    out += `📜 历史 Commit 节点数:\t${allShas.length}\n\n`;

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
    renderStandardizeMenu(confirmCursor);

    const key = await getKeyPress();

    if (key === 'ESC' || (key === 'ENTER' && confirmOptions[confirmCursor].id === 'cancel')) {
      console.log('\n🚪 已取消操作，未对 Git 历史做任何更改。\n');
      process.exit(0);
    }

    if (key === 'UP') {
      confirmCursor = (confirmCursor - 1 + confirmOptions.length) % confirmOptions.length;
      renderStandardizeMenu(confirmCursor);
      continue;
    }

    if (key === 'DOWN') {
      confirmCursor = (confirmCursor + 1) % confirmOptions.length;
      renderStandardizeMenu(confirmCursor);
      continue;
    }

    if (key === 'ENTER' && confirmOptions[confirmCursor].id === 'confirm') {
      break;
    }
  }

  console.log('\n⏳ 正在重构 Git DAG 拓扑历史...');

  const oldToNewShaMap = new Map();
  let modifiedCount = 0;

  for (const sha of allShas) {
    const metaStr = git(['log', '-1', '--format=%an|%ae|%ad|%cn|%ce|%cd|%T|%P', '--date=raw', sha]);
    const [an, ae, ad, cn, ce, cd, tree, rawParents] = metaStr.split('|');
    const oldParents = rawParents ? rawParents.split(/\s+/).filter(Boolean) : [];
    const fullMessage = git(['log', '-1', '--format=%B', sha]);

    const newParents = oldParents.map(p => oldToNewShaMap.get(p) || p);
    const parentsChanged = newParents.some((np, idx) => np !== oldParents[idx]);
    const infoNeedsChange = (an !== TARGET_NAME || ae !== TARGET_EMAIL || cn !== TARGET_NAME || ce !== TARGET_EMAIL);

    if (!parentsChanged && !infoNeedsChange) {
      oldToNewShaMap.set(sha, sha);
      continue;
    }

    const commitTreeArgs = ['commit-tree', tree];
    for (const np of newParents) {
      commitTreeArgs.push('-p', np);
    }

    const commitRes = spawnSync('git', commitTreeArgs, {
      input: fullMessage,
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: TARGET_NAME,
        GIT_AUTHOR_EMAIL: TARGET_EMAIL,
        GIT_AUTHOR_DATE: ad,
        GIT_COMMITTER_NAME: TARGET_NAME,
        GIT_COMMITTER_EMAIL: TARGET_EMAIL,
        GIT_COMMITTER_DATE: cd
      }
    });

    if (commitRes.status !== 0) {
      throw new Error(`git commit-tree 失败 [${sha}]: ${commitRes.stderr}`);
    }

    const newSha = commitRes.stdout.trim();
    oldToNewShaMap.set(sha, newSha);
    modifiedCount++;
  }

  console.log(`✔ Commit 节点处理完成，重构了 ${modifiedCount} 个节点。`);

  // 更新所有分支引用
  console.log('\n🌿 正在更新本地所有分支引用...');
  for (const [branchName, oldHead] of Object.entries(branchMap)) {
    const newHead = oldToNewShaMap.get(oldHead);
    if (newHead && newHead !== oldHead) {
      git(['update-ref', `refs/heads/${branchName}`, newHead]);
      console.log(`   ✔ 分支 [${branchName}]: ${oldHead.substring(0, 7)} -> ${newHead.substring(0, 7)}`);
    } else {
      console.log(`   - 分支 [${branchName}]: 无需更新`);
    }
  }

  // 签出原分支
  git(['checkout', '-f', initialBranch]);
  console.log(`✔ 已恢复工作区至分支: ${initialBranch}`);

  // 强制推送到 GitHub
  console.log('\n🚀 正在将重构后的历史推送到 GitHub 远程仓库 (git push --force --all origin)...');
  try {
    const pushRes = git(['push', '--force', '--all', 'origin']);
    console.log('✔ 推送成功！');
    if (pushRes) console.log(pushRes);
  } catch (err) {
    console.warn(`⚠️ 自动推送失败 (请稍后手动执行 git push --force --all origin): ${err.message}`);
  }

  console.log('\n+========================================================================+');
  console.log('|\t🎉 全仓库历史 Commit 作者与邮箱已全部统一规范完成！');
  console.log('+========================================================================+\n');
  await getKeyPress('👉 按 [回车] 或 [ESC] 返回主菜单...');
  process.exit(0);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 执行异常:', err);
  process.exit(1);
});
