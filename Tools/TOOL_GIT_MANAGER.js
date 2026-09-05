/**
 * TOOL_GIT_MANAGER.js
 * 
 * Git 全能运维与版本控制工作台 (Comprehensive Git Operations & Management Console)
 * 
 * 核心功能矩阵：
 *   1. 📜 交互式提交记录浏览器 (Commit Browser)：
 *      - 支持多页浏览、键盘左右键翻页 (10条/页)、指定跳转
 *      - 交互式查看单条 Commit 详情、文件统计与完整代码 Diff
 *      - 支持按分支/全部分支过滤、按作者过滤、提交信息关键字检索
 *      - 支持查看 ASCII 拓扑分支图谱、一键复制 Commit SHA、基于 Commit 新建分支/回滚
 *   2. 🔀 分支全能管理 (Branch Manager)：
 *      - 快速切换分支 (置顶推荐主开发分支)、新建分支、重命名分支、安全删除分支
 *      - 抓取远程最新分支与清理失效引用 (fetch & prune)、分支超前/落后状态对比
 *   3. 📊 工作区与暂存区治理 (Working Tree & Staging)：
 *      - 详细状态分类 (已暂存、未暂存、未跟踪)
 *      - 查看工作区/暂存区 Diff、一键全部暂存/取消暂存、单文件交互式暂存
 *      - 放弃未暂存修改 (带安全确认)、清理未跟踪新文件
 *   4. 📦 暂存藏匿管理 (Git Stash Manager)：
 *      - 查看 Stash 列表、一键保存当前改动至 Stash、弹出恢复 Stash、查看 Stash Diff、清空 Stash
 *   5. ⬆️ / ⬇️ 远程同步与诊断 (Remote Sync & Push/Pull)：
 *      - 智能 Git Push (自动关联 upstream)、Git Pull (冲突智能诊断)、Git Fetch、查看 Remote 状态
 *   6. 🏷️ 版本标签管理 (Git Tag Manager)：
 *      - 标签列表与搜索、创建附注标签、推送标签至远程、删除本地/远程标签
 *   7. 👤 提交者身份与常用配置 (Identity & Config)：
 *      - 查看与修改 Local / Global 用户名与邮箱、查看 Git 核心环境配置
 */

import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// 1. 基础工具与终端辅助函数
// ============================================================================

/**
 * 跨平台终端清屏
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
      maxBuffer: 40 * 1024 * 1024,
      ...options
    });
    if (res.status !== 0 && !options.allowError) {
      const errMsg = (res.stderr || res.stdout || '').trim();
      throw new Error(errMsg || `Git 指令执行失败 [git ${args.join(' ')}]`);
    }
    return (res.stdout || '').trim();
  } catch (err) {
    if (options.allowError) return '';
    throw err;
  }
}

readline.emitKeypressEvents(process.stdin);

/**
 * 监听用户键盘按键（零延迟即时捕获方向键与功能键）
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
          if (key.name === 'left' || key.name === 'h' || key.name === 'a') return cleanupAndResolve('LEFT');
          if (key.name === 'right' || key.name === 'l' || key.name === 'd') return cleanupAndResolve('RIGHT');
          if (key.name === 'pageup') return cleanupAndResolve('PAGEUP');
          if (key.name === 'pagedown') return cleanupAndResolve('PAGEDOWN');
          if (key.name === 'home') return cleanupAndResolve('HOME');
          if (key.name === 'end') return cleanupAndResolve('END');
          if (key.name === 'return' || key.name === 'enter') return cleanupAndResolve('ENTER');
          if (key.name === 'escape') return cleanupAndResolve('ESC');
          if (key.name === 'space') return cleanupAndResolve('SPACE');
          if (key.name) return cleanupAndResolve(key.name.toLowerCase());
        }

        if (str === '\u001b[A' || str === '\x1bOA') return cleanupAndResolve('UP');
        if (str === '\u001b[B' || str === '\x1bOB') return cleanupAndResolve('DOWN');
        if (str === '\u001b[D' || str === '\x1bOD') return cleanupAndResolve('LEFT');
        if (str === '\u001b[C' || str === '\x1bOC') return cleanupAndResolve('RIGHT');
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
        if (str === '\u001b[D' || str === '\x1bOD') return cleanupAndResolve('LEFT');
        if (str === '\u001b[C' || str === '\x1bOC') return cleanupAndResolve('RIGHT');
        if (str === '\r' || str === '\n' || str === '\r\n') return cleanupAndResolve('ENTER');
        if (str === '\u001b') return cleanupAndResolve('ESC');
        if (str === ' ') return cleanupAndResolve('SPACE');
        if (str === 'k' || str === 'K' || str === 'w' || str === 'W') return cleanupAndResolve('UP');
        if (str === 'j' || str === 'J' || str === 's' || str === 'S') return cleanupAndResolve('DOWN');
        if (str === 'h' || str === 'H' || str === 'a' || str === 'A') return cleanupAndResolve('LEFT');
        if (str === 'l' || str === 'L' || str === 'd' || str === 'D') return cleanupAndResolve('RIGHT');
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
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      resolve(answer.trim());
    });
  });
}

/**
 * 跨平台复制文本到系统剪贴板
 */
function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      spawnSync('clip', { input: text, encoding: 'utf-8' });
      return true;
    } else if (process.platform === 'darwin') {
      spawnSync('pbcopy', { input: text, encoding: 'utf-8' });
      return true;
    } else {
      spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf-8' });
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * 计算终端视觉宽度 (中文占 2 宽，英文占 1 宽)
 */
function getVisualWidth(str) {
  let w = 0;
  // 移除 ANSI 颜色字符后再计算宽度
  const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      w += 1;
    } else {
      w += 2;
    }
  }
  return w;
}

function padVisual(str, targetWidth) {
  const currentWidth = getVisualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * 获取当前所在的分支名
 */
function getCurrentBranch() {
  return git(['branch', '--show-current'], { allowError: true }) || '(游离 HEAD 状态)';
}

/**
 * 获取所有本地分支并智能排序 (new-version 置顶推荐)
 */
function getSortedBranches() {
  const raw = git(['branch', '--list'], { allowError: true });
  if (!raw) return [];

  const branches = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const isCurrent = line.startsWith('*');
      const name = line.replace(/^\*\s*/, '').trim();
      return { name, isCurrent };
    });

  branches.sort((a, b) => {
    if (a.name === 'new-version') return -1;
    if (b.name === 'new-version') return 1;
    if (a.name === 'main' || a.name === 'master') return -1;
    if (b.name === 'main' || b.name === 'master') return 1;
    return a.name.localeCompare(b.name);
  });

  return branches;
}

// ============================================================================
// 2. 📜 交互式提交记录浏览器 (Commit Log Browser with Pagination)
// ============================================================================

/**
 * 解析并拉取 Commit 列表
 */
function fetchCommitList(options = {}) {
  const { branch = 'HEAD', author = '', search = '', limit = 1000 } = options;
  const args = [
    'log',
    branch,
    `-n`,
    String(limit),
    '--pretty=format:%H%x09%h%x09%an%x09%ae%x09%ad%x09%ar%x09%s%x09%d',
    '--date=short'
  ];

  if (author) {
    args.push(`--author=${author}`);
  }
  if (search) {
    args.push(`--grep=${search}`);
  }

  const raw = git(args, { allowError: true });
  if (!raw) return [];

  const lines = raw.split('\n').filter(Boolean);
  return lines.map((line) => {
    const parts = line.split('\t');
    return {
      hash: parts[0] || '',
      shortHash: parts[1] || '',
      author: parts[2] || '',
      email: parts[3] || '',
      date: parts[4] || '',
      relDate: parts[5] || '',
      subject: parts[6] || '',
      decorations: parts[7] ? parts[7].trim() : ''
    };
  });
}

/**
 * 查看单个 Commit 深度详情与完整 Diff
 */
async function handleInspectCommit(commit) {
  clearScreen();
  console.log('+========================================================================+');
  console.log(`|\t🔍 Commit 深度详情检查 [${commit.shortHash}]`);
  console.log('+========================================================================+\n');

  const commitDetails = git(['show', '--stat', '--pretty=format:Commit:  %H%nAuthor:  %an <%ae>%nDate:    %ad (%ar)%nRefs:    %d%n%n%B%n---', commit.hash], { allowError: true });

  console.log(commitDetails || `无法读取该 Commit 详情 [${commit.hash}]`);
  console.log('\n+------------------------------------------------------------------------+');
  console.log('操作选项:');
  console.log('\t\x1b[1m\x1b[32m[1 / d]\x1b[0m\t📋 查看该 Commit 的完整代码改动 Diff');
  console.log('\t\x1b[1m\x1b[36m[2 / b]\x1b[0m\t🌿 基于此 Commit 创建新分支');
  console.log('\t\x1b[1m\x1b[33m[3 / c]\x1b[0m\t📋 复制完整 SHA 到系统剪贴板');
  console.log('\t\x1b[1m\x1b[35m[4 / r]\x1b[0m\t🔄 回滚此提交 (git revert)');
  console.log('\t\x1b[1m\x1b[37m[回车 / ESC / q]\x1b[0m\t🔙 返回提交列表');
  console.log('+------------------------------------------------------------------------+\n');

  while (true) {
    const actionKey = await getKeyPress('👉 请选择操作按键: ');

    if (actionKey === '1' || actionKey === 'd' || actionKey === 'D') {
      clearScreen();
      console.log(`+========================================================================+`);
      console.log(`|\t📄 [Diff 代码改动] Commit: ${commit.shortHash} - ${commit.subject}`);
      console.log(`+========================================================================+\n`);

      const fullDiff = git(['show', '--color=always', commit.hash], { allowError: true });
      console.log(fullDiff || '(无 Diff 输出)');
      console.log('\n+------------------------------------------------------------------------+');
      await getKeyPress('👉 按 [回车] 或 [ESC] 返回详情...');
      return handleInspectCommit(commit);
    }

    if (actionKey === '2' || actionKey === 'b' || actionKey === 'B') {
      const newBranchName = await askQuestion(`\n👉 请输入基于 [${commit.shortHash}] 创建的新分支名称 (回车取消): `);
      if (newBranchName) {
        try {
          git(['branch', newBranchName, commit.hash]);
          console.log(`\n\x1b[32m✔ 分支 [${newBranchName}] 已成功基于 [${commit.shortHash}] 创建！\x1b[0m`);
          const checkoutNow = await askQuestion('👉 是否立即切换到该新分支？[y/n] (默认 y): ');
          if (!checkoutNow || checkoutNow.toLowerCase() === 'y') {
            git(['checkout', newBranchName]);
            console.log(`✔ 已切换至分支: \x1b[1m\x1b[36m${newBranchName}\x1b[0m`);
          }
        } catch (err) {
          console.log(`\n\x1b[31m❌ 创建分支失败: ${err.message}\x1b[0m`);
        }
        await getKeyPress('\n👉 按 [回车] 返回详情...');
      }
      return handleInspectCommit(commit);
    }

    if (actionKey === '3' || actionKey === 'c' || actionKey === 'C') {
      const ok = copyToClipboard(commit.hash);
      if (ok) {
        console.log(`\n\x1b[32m✔ 完整 Commit SHA 已成功复制到剪贴板:\x1b[0m \x1b[36m${commit.hash}\x1b[0m\n`);
      } else {
        console.log(`\n📋 Commit SHA: \x1b[36m${commit.hash}\x1b[0m\n`);
      }
      continue;
    }

    if (actionKey === '4' || actionKey === 'r' || actionKey === 'R') {
      const confirmRevert = await askQuestion(`\n⚠️ 确认对提交 [${commit.shortHash}] 执行 revert 回滚操作？[y/n]: `);
      if (confirmRevert.toLowerCase() === 'y') {
        try {
          const revertOut = git(['revert', '--no-edit', commit.hash]);
          console.log('\n\x1b[32m✔ 回滚成功，已生成新的回滚提交！\x1b[0m');
          if (revertOut) console.log(revertOut);
        } catch (err) {
          console.log(`\n\x1b[31m❌ 回滚操作失败: ${err.message}\x1b[0m`);
        }
        await getKeyPress('\n👉 按 [回车] 返回...');
      }
      return;
    }

    // 回车或 ESC 返回
    return;
  }
}

/**
 * 查看 ASCII 拓扑分支图谱
 */
async function handleViewGraphHistory() {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🌳 Git 全局分支拓扑图谱 (Topological Branch Graph - 最近 35 条)');
  console.log('+========================================================================+\n');

  const graphOutput = git([
    'log',
    '--graph',
    '--oneline',
    '--decorate',
    '--all',
    '-n',
    '35',
    '--color=always'
  ], { allowError: true });

  if (graphOutput) {
    console.log(graphOutput);
  } else {
    console.log('\t暂无提交历史图谱。');
  }

  console.log('\n+------------------------------------------------------------------------+');
  await getKeyPress('👉 按 [回车] 或 [ESC] 返回提交浏览器...');
}

/**
 * 交互式提交记录浏览器主入口 (支持翻页、过滤、查看详情)
 */
async function handleInteractiveCommitBrowser() {
  let filterBranch = 'HEAD';
  let filterAuthor = '';
  let searchQuery = '';
  let pageSize = 10;
  let currentPage = 0;
  let cursorIndex = 0;

  while (true) {
    const commits = fetchCommitList({
      branch: filterBranch,
      author: filterAuthor,
      search: searchQuery,
      limit: 500
    });

    const totalCommits = commits.length;
    const totalPages = Math.max(1, Math.ceil(totalCommits / pageSize));

    if (currentPage >= totalPages) {
      currentPage = totalPages - 1;
    }
    if (currentPage < 0) {
      currentPage = 0;
    }

    const startIndex = currentPage * pageSize;
    const pageCommits = commits.slice(startIndex, startIndex + pageSize);

    if (cursorIndex >= pageCommits.length) {
      cursorIndex = Math.max(0, pageCommits.length - 1);
    }

    function renderBrowserUI() {
      let out = '';
      out += '+================================================================================+\n';
      out += `|  📜 Git 提交历史翻页浏览器  |  页码: \x1b[1m\x1b[33m${currentPage + 1}/${totalPages}\x1b[0m  |  共 \x1b[1m\x1b[36m${totalCommits}\x1b[0m 条提交记录\n`;
      out += `|  🌿 分支范围: \x1b[1m\x1b[32m${filterBranch === 'HEAD' ? '当前所在分支' : filterBranch === '--all' ? '所有分支 (--all)' : filterBranch}\x1b[0m`;
      if (filterAuthor) out += `  |  👤 作者: \x1b[36m${filterAuthor}\x1b[0m`;
      if (searchQuery) out += `  |  🔍 搜索: \x1b[33m"${searchQuery}"\x1b[0m`;
      out += '\n+================================================================================+\n\n';

      if (pageCommits.length === 0) {
        out += '\t⚠️  未检索到符合条件的提交记录。\n\n';
      } else {
        pageCommits.forEach((c, idx) => {
          const isFocused = idx === cursorIndex;
          const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
          const shaPadded = `\x1b[33m${c.shortHash}\x1b[0m`;
          const authorPadded = padVisual(c.author, 10);
          const dateStr = `\x1b[90m${c.date} (${c.relDate})\x1b[0m`;
          const decoStr = c.decorations ? ` \x1b[1m\x1b[35m${c.decorations}\x1b[0m` : '';

          let subjectStr = c.subject;
          if (getVisualWidth(subjectStr) > 42) {
            subjectStr = subjectStr.substring(0, 38) + '...';
          }
          const subjPadded = padVisual(subjectStr, 42);

          if (isFocused) {
            out += `${pointer}${shaPadded}  \x1b[1m\x1b[32m${authorPadded}\x1b[0m  \x1b[1m\x1b[37m${subjPadded}\x1b[0m  ${dateStr}${decoStr}\n`;
          } else {
            out += `${pointer}${shaPadded}  \x1b[37m${authorPadded}\x1b[0m  \x1b[90m${subjPadded}\x1b[0m  ${dateStr}${decoStr}\n`;
          }
        });
      }

      out += '\n+--------------------------------------------------------------------------------+\n';
      out += '操作快捷键:\n';
      out += '  [\x1b[36m↑/↓\x1b[0m 移动光标] [\x1b[33m←/→\x1b[0m 翻页(p/n)] [\x1b[32m回车\x1b[0m 查看详情与Diff] [\x1b[36mf\x1b[0m 搜索过滤] [\x1b[35ma\x1b[0m 切换全部分支]\n';
      out += '  [\x1b[32mc\x1b[0m 复制SHA] [\x1b[33mg\x1b[0m 查看图谱] [\x1b[36mr\x1b[0m 重置过滤] [\x1b[31mESC / q\x1b[0m 返回Git控制台]\n';

      process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
    }

    renderBrowserUI();

    const key = await getKeyPress();

    if (key === 'ESC' || key === 'q') {
      return;
    }

    if (key === 'UP') {
      if (pageCommits.length > 0) {
        cursorIndex = (cursorIndex - 1 + pageCommits.length) % pageCommits.length;
      }
      continue;
    }

    if (key === 'DOWN') {
      if (pageCommits.length > 0) {
        cursorIndex = (cursorIndex + 1) % pageCommits.length;
      }
      continue;
    }

    // 翻页：上一页 (LEFT, p, a, PAGEUP)
    if (key === 'LEFT' || key === 'p' || key === 'PAGEUP') {
      if (currentPage > 0) {
        currentPage--;
        cursorIndex = 0;
      }
      continue;
    }

    // 翻页：下一页 (RIGHT, n, d, PAGEDOWN)
    if (key === 'RIGHT' || key === 'n' || key === 'PAGEDOWN') {
      if (currentPage < totalPages - 1) {
        currentPage++;
        cursorIndex = 0;
      }
      continue;
    }

    if (key === 'HOME') {
      currentPage = 0;
      cursorIndex = 0;
      continue;
    }

    if (key === 'END') {
      currentPage = totalPages - 1;
      cursorIndex = 0;
      continue;
    }

    // 搜索过滤 (f)
    if (key === 'f') {
      const q = await askQuestion('\n🔍 请输入提交信息搜索关键词 (留空清空): ');
      searchQuery = q.trim();
      currentPage = 0;
      cursorIndex = 0;
      continue;
    }

    // 切换当前分支与全部分支 (a)
    if (key === 'a') {
      filterBranch = filterBranch === 'HEAD' ? '--all' : 'HEAD';
      currentPage = 0;
      cursorIndex = 0;
      continue;
    }

    // 复制当前选中 Commit SHA (c)
    if (key === 'c' && pageCommits[cursorIndex]) {
      const c = pageCommits[cursorIndex];
      copyToClipboard(c.hash);
      console.log(`\n✔ 已复制 SHA [${c.shortHash}] 到剪贴板！`);
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    // 查看拓扑图 (g)
    if (key === 'g') {
      await handleViewGraphHistory();
      continue;
    }

    // 重置过滤条件 (r)
    if (key === 'r') {
      filterBranch = 'HEAD';
      filterAuthor = '';
      searchQuery = '';
      currentPage = 0;
      cursorIndex = 0;
      continue;
    }

    // 回车查看当前 Commit 详情与 Diff
    if (key === 'ENTER' && pageCommits[cursorIndex]) {
      await handleInspectCommit(pageCommits[cursorIndex]);
      continue;
    }
  }
}

// ============================================================================
// 3. 🔀 分支全能管理 (Branch Manager)
// ============================================================================

/**
 * 快速切换分支
 */
async function handleSwitchBranch() {
  const branches = getSortedBranches();
  if (branches.length === 0) {
    console.log('\n❌ 未检测到任何本地分支。\n');
    await getKeyPress('👉 按 [回车] 返回...');
    return;
  }

  let cursorIndex = Math.max(0, branches.findIndex((b) => b.isCurrent));
  const statusShort = git(['status', '-s'], { allowError: true });

  function renderBranchUI(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🔀 Git 交互式分支切换\n';
    out += '+========================================================================+\n\n';

    if (statusShort) {
      out += '+------------------------------------------------------------------------+\n';
      out += '|\t\x1b[1m\x1b[33m⚠️  【注意】：检测到当前工作区有未提交的修改！\x1b[0m\n';
      out += '|\t建议在切换分支前先暂存或提交代码，防止代码冲突。\n';
      out += '+------------------------------------------------------------------------+\n\n';
    }

    out += '📋 本地分支列表：\n\n';

    branches.forEach((b, index) => {
      const isFocused = index === idx;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      let badge = '';
      let recommendTag = '';

      if (b.name === 'new-version') {
        recommendTag = '\t\x1b[1m\x1b[32m★ (推荐主开发分支)\x1b[0m';
      }
      if (b.isCurrent) {
        badge = '\t\x1b[1m\x1b[36m[当前所在分支]\x1b[0m';
      }

      if (isFocused) {
        out += `${pointer}\x1b[1m\x1b[36m${b.name}\x1b[0m${badge}${recommendTag}\n`;
      } else {
        out += `${pointer}\x1b[37m${b.name}\x1b[0m${badge}${recommendTag}\n`;
      }
    });

    out += '\n+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择分支] [\x1b[32m回车\x1b[0m 确认切换] [\x1b[31mESC\x1b[0m 取消返回]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderBranchUI(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + branches.length) % branches.length;
      renderBranchUI(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % branches.length;
      renderBranchUI(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const target = branches[cursorIndex];
      if (target.isCurrent) {
        console.log(`\n💡 您当前已处于分支 \x1b[1m\x1b[36m${target.name}\x1b[0m，无需重复切换。`);
        await new Promise((r) => setTimeout(r, 600));
        return;
      }

      console.log(`\n⏳ 正在切换至分支 \x1b[1m\x1b[32m${target.name}\x1b[0m ...`);
      try {
        const out = git(['checkout', target.name]);
        console.log('\x1b[32m✔ 切换分支成功！\x1b[0m');
        if (out) console.log(out);
      } catch (err) {
        console.log(`\n\x1b[31m❌ 切换分支失败: ${err.message}\x1b[0m`);
      }
      await getKeyPress('\n👉 按 [回车] 返回分支菜单...');
      return;
    }
  }
}

/**
 * 分支全能管理菜单
 */
async function handleBranchManagementMenu() {
  const branchOptions = [
    { id: 'switch', label: '🔀 快速切换分支', desc: '选择已有本地分支并一键切换签出' },
    { id: 'create', label: '🌿 创建并切换新分支', desc: '输入新分支名并基于当前位置创建' },
    { id: 'rename', label: '✏️  重命名分支', desc: '修改当前分支或指定分支的名称' },
    { id: 'delete', label: '🗑️  删除本地分支', desc: '安全删除已合并分支或强制删除指定分支' },
    { id: 'fetch_prune', label: '🔄 抓取远程分支与清理', desc: '同步远程仓库所有最新分支并清理失效引用' },
    { id: 'compare', label: '📊 分支状态与超前/落后对比', desc: '查看各分支与远程对应的 Commit 领先/落后情况' },
    { id: 'back', label: '🔙 返回 Git 主菜单', desc: '返回上一级 Git 控制台' }
  ];

  let cursorIndex = 0;

  while (true) {
    clearScreen();
    const currentBranch = getCurrentBranch();

    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🌿 Git 分支全能管理中心 (Branch Manager)\n';
    out += `|\t📌 当前分支:\t\x1b[1m\x1b[36m${currentBranch}\x1b[0m\n`;
    out += '+========================================================================+\n\n';

    branchOptions.forEach((opt, idx) => {
      const isFocused = idx === cursorIndex;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m \x1b[90m─ ${opt.desc}\x1b[0m\n`;
      } else {
        out += `${pointer}\x1b[37m${opt.label}\x1b[0m \x1b[90m─ ${opt.desc}\x1b[0m\n`;
      }
    });

    out += '\n+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回]\n';

    process.stdout.write(out);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + branchOptions.length) % branchOptions.length;
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % branchOptions.length;
      continue;
    }

    if (key === 'ENTER') {
      const selected = branchOptions[cursorIndex];

      if (selected.id === 'back') {
        return;
      }

      if (selected.id === 'switch') {
        await handleSwitchBranch();
        continue;
      }

      if (selected.id === 'create') {
        const newBranch = await askQuestion('\n👉 请输入新分支名称 (如 feature/user-auth，回车取消): ');
        if (newBranch) {
          try {
            git(['checkout', '-b', newBranch]);
            console.log(`\n\x1b[32m✔ 分支 [${newBranch}] 创建并切换成功！\x1b[0m\n`);
          } catch (err) {
            console.log(`\n\x1b[31m❌ 创建分支失败: ${err.message}\x1b[0m\n`);
          }
          await getKeyPress('👉 按 [回车] 继续...');
        }
        continue;
      }

      if (selected.id === 'rename') {
        const current = getCurrentBranch();
        const newName = await askQuestion(`\n👉 请输入当前分支 [${current}] 的新名称 (回车取消): `);
        if (newName && newName !== current) {
          try {
            git(['branch', '-m', newName]);
            console.log(`\n\x1b[32m✔ 当前分支已成功重命名为: ${newName}\x1b[0m\n`);
          } catch (err) {
            console.log(`\n\x1b[31m❌ 重命名失败: ${err.message}\x1b[0m\n`);
          }
          await getKeyPress('👉 按 [回车] 继续...');
        }
        continue;
      }

      if (selected.id === 'delete') {
        const branches = getSortedBranches().filter((b) => !b.isCurrent);
        if (branches.length === 0) {
          console.log('\n💡 除了当前分支外没有其他可删除的本地分支。\n');
          await getKeyPress('👉 按 [回车] 继续...');
          continue;
        }

        console.log('\n可删除的本地分支列表:');
        branches.forEach((b, i) => console.log(`  [${i + 1}] ${b.name}`));
        const delInput = await askQuestion('\n👉 请输入要删除的分支序号或分支名 (回车取消): ');
        if (!delInput) continue;

        let targetBranch = delInput.trim();
        const idxNum = parseInt(targetBranch, 10);
        if (!isNaN(idxNum) && idxNum >= 1 && idxNum <= branches.length) {
          targetBranch = branches[idxNum - 1].name;
        }

        const confirm = await askQuestion(`⚠️ 确认删除本地分支 [${targetBranch}] 吗？[y/n]: `);
        if (confirm.toLowerCase() === 'y') {
          try {
            git(['branch', '-d', targetBranch]);
            console.log(`\n\x1b[32m✔ 分支 [${targetBranch}] 已安全删除！\x1b[0m\n`);
          } catch (err) {
            console.log(`\n⚠️ 提示: ${err.message}`);
            const forceConfirm = await askQuestion('是否强制删除该分支 (git branch -D)？[y/n]: ');
            if (forceConfirm.toLowerCase() === 'y') {
              try {
                git(['branch', '-D', targetBranch]);
                console.log(`\n\x1b[32m✔ 已强制删除分支 [${targetBranch}]！\x1b[0m\n`);
              } catch (e) {
                console.log(`\n❌ 强制删除失败: ${e.message}\n`);
              }
            }
          }
          await getKeyPress('👉 按 [回车] 继续...');
        }
        continue;
      }

      if (selected.id === 'fetch_prune') {
        console.log('\n⏳ 正在执行 git fetch --all --prune 同步远程分支...');
        try {
          const out = git(['fetch', '--all', '--prune']);
          console.log('\n\x1b[32m✔ 远程分支状态同步与失效引用清理完成！\x1b[0m');
          if (out) console.log(out);
        } catch (err) {
          console.log(`\n❌ 同步失败: ${err.message}`);
        }
        await getKeyPress('\n👉 按 [回车] 继续...');
        continue;
      }

      if (selected.id === 'compare') {
        clearScreen();
        console.log('+========================================================================+');
        console.log('|\t📊 本地所有分支状态与远程追踪对比 (git branch -vv)');
        console.log('+========================================================================+\n');
        const vvOut = git(['branch', '-vv'], { allowError: true });
        console.log(vvOut || '(暂无分支信息)');
        console.log('\n+------------------------------------------------------------------------+');
        await getKeyPress('👉 按 [回车] 返回...');
        continue;
      }
    }
  }
}

// ============================================================================
// 4. 📊 工作区与暂存区治理 (Working Tree & Staging Manager)
// ============================================================================

/**
 * 工作区与暂存区管理菜单
 */
async function handleWorkingTreeMenu() {
  while (true) {
    clearScreen();
    const currentBranch = getCurrentBranch();
    const rawStatus = git(['status', '--porcelain'], { allowError: true });
    const lines = rawStatus ? rawStatus.split('\n').filter(Boolean) : [];

    const staged = [];
    const unstaged = [];
    const untracked = [];

    lines.forEach((line) => {
      const x = line.substring(0, 1);
      const y = line.substring(1, 2);
      const file = line.substring(3).trim();

      if (x === '?' && y === '?') {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') {
          staged.push({ flag: x, file });
        }
        if (y !== ' ' && y !== '?') {
          unstaged.push({ flag: y, file });
        }
      }
    });

    console.log('+========================================================================+');
    console.log('|\t📊 Git 工作区与暂存区实时状态');
    console.log(`|\t📌 当前分支: \x1b[1m\x1b[36m${currentBranch}\x1b[0m  |  📋 变更文件总数: \x1b[1m\x1b[33m${lines.length}\x1b[0m 个`);
    console.log('+========================================================================+\n');

    if (lines.length === 0) {
      console.log('\t\x1b[32m🟢 工作区干净，没有检测到任何未提交的修改或未跟踪文件。\x1b[0m\n');
    } else {
      if (staged.length > 0) {
        console.log(`\x1b[1m\x1b[32m📦 已暂存文件 (Staged Changes - ${staged.length} 个):\x1b[0m`);
        staged.forEach((item) => console.log(`   \x1b[32m✔ [${item.flag}]\t${item.file}\x1b[0m`));
        console.log('');
      }
      if (unstaged.length > 0) {
        console.log(`\x1b[1m\x1b[33m📝 未暂存修改 (Unstaged Changes - ${unstaged.length} 个):\x1b[0m`);
        unstaged.forEach((item) => console.log(`   \x1b[33m● [${item.flag}]\t${item.file}\x1b[0m`));
        console.log('');
      }
      if (untracked.length > 0) {
        console.log(`\x1b[1m\x1b[31m❓ 未跟踪新文件 (Untracked Files - ${untracked.length} 个):\x1b[0m`);
        untracked.forEach((file) => console.log(`   \x1b[31m+ [??]\t${file}\x1b[0m`));
        console.log('');
      }
    }

    console.log('+------------------------------------------------------------------------+');
    console.log('操作选项:');
    console.log('\t\x1b[1m\x1b[36m[1 / d]\x1b[0m\t📋 查看未暂存代码 Diff (git diff)');
    console.log('\t\x1b[1m\x1b[32m[2 / s]\x1b[0m\t📋 查看已暂存代码 Diff (git diff --cached)');
    console.log('\t\x1b[1m\x1b[32m[3 / a]\x1b[0m\t➕ 暂存全部修改文件 (git add -A)');
    console.log('\t\x1b[1m\x1b[33m[4 / u]\x1b[0m\t➖ 取消暂存所有文件 (git restore --staged .)');
    console.log('\t\x1b[1m\x1b[31m[5 / r]\x1b[0m\t🧹 放弃所有未暂存修改 (git restore . 危险操作)');
    console.log('\t\x1b[1m\x1b[31m[6 / c]\x1b[0m\t🗑️ 清理所有未跟踪新文件 (git clean -fd)');
    console.log('\t\x1b[1m\x1b[37m[回车 / ESC / q]\x1b[0m\t🔙 返回 Git 主控制台');
    console.log('+------------------------------------------------------------------------+\n');

    const key = await getKeyPress('👉 请选择操作按键: ');

    if (key === 'ESC' || key === 'q' || key === 'ENTER') {
      return;
    }

    if (key === '1' || key === 'd' || key === 'D') {
      clearScreen();
      console.log('+========================================================================+');
      console.log('|\t📋 工作区未暂存代码改动 Diff (git diff)');
      console.log('+========================================================================+\n');
      const diffOut = git(['diff', '--color=always'], { allowError: true });
      console.log(diffOut || '(无未暂存改动)');
      console.log('\n+------------------------------------------------------------------------+');
      await getKeyPress('👉 按 [回车] 返回工作区菜单...');
      continue;
    }

    if (key === '2' || key === 's' || key === 'S') {
      clearScreen();
      console.log('+========================================================================+');
      console.log('|\t📦 已暂存代码改动 Diff (git diff --cached)');
      console.log('+========================================================================+\n');
      const diffOut = git(['diff', '--cached', '--color=always'], { allowError: true });
      console.log(diffOut || '(无暂存区改动)');
      console.log('\n+------------------------------------------------------------------------+');
      await getKeyPress('👉 按 [回车] 返回工作区菜单...');
      continue;
    }

    if (key === '3' || key === 'a' || key === 'A') {
      git(['add', '-A']);
      console.log('\n\x1b[32m✔ 全部文件已成功暂存 (git add -A)！\x1b[0m');
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (key === '4' || key === 'u' || key === 'U') {
      git(['restore', '--staged', '.']);
      console.log('\n\x1b[32m✔ 已取消所有文件的暂存状态！\x1b[0m');
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (key === '5' || key === 'r' || key === 'R') {
      const confirm = await askQuestion('\n⚠️ 【危险确认】确定要放弃当前工作区所有未暂存的代码改动吗？此操作不可恢复！[y/n]: ');
      if (confirm.toLowerCase() === 'y') {
        git(['restore', '.']);
        console.log('\n\x1b[32m✔ 工作区修改已重置恢复！\x1b[0m');
        await new Promise((r) => setTimeout(r, 600));
      }
      continue;
    }

    if (key === '6' || key === 'c' || key === 'C') {
      const confirm = await askQuestion('\n⚠️ 确定要删除所有未跟踪的新文件与新目录吗？[y/n]: ');
      if (confirm.toLowerCase() === 'y') {
        git(['clean', '-fd']);
        console.log('\n\x1b[32m✔ 未跟踪文件已清理！\x1b[0m');
        await new Promise((r) => setTimeout(r, 600));
      }
      continue;
    }
  }
}

// ============================================================================
// 5. 📦 暂存藏匿管理 (Git Stash Manager)
// ============================================================================

/**
 * 暂存藏匿管理菜单
 */
async function handleStashMenu() {
  while (true) {
    clearScreen();
    const rawList = git(['stash', 'list'], { allowError: true });
    const stashItems = rawList ? rawList.split('\n').filter(Boolean) : [];

    console.log('+========================================================================+');
    console.log('|\t📦 Git 暂存藏匿管理中心 (Stash Manager)');
    console.log(`|\t💾 当前 Stash 记录数:\t\x1b[1m\x1b[33m${stashItems.length}\x1b[0m 个`);
    console.log('+========================================================================+\n');

    if (stashItems.length === 0) {
      console.log('\t(暂无任何 Stash 暂存记录)\n');
    } else {
      console.log('📋 当前暂存藏匿列表:');
      stashItems.forEach((item, idx) => {
        console.log(`\t\x1b[36m[${idx + 1}]\x1b[0m ${item}`);
      });
      console.log('');
    }

    console.log('+------------------------------------------------------------------------+');
    console.log('操作选项:');
    console.log('\t\x1b[1m\x1b[32m[1 / s]\x1b[0m\t📦 藏匿当前未提交改动 (git stash push -m "...")');
    console.log('\t\x1b[1m\x1b[36m[2 / p]\x1b[0m\t📤 恢复并弹出最近的藏匿 (git stash pop)');
    console.log('\t\x1b[1m\x1b[33m[3 / d]\x1b[0m\t🔍 查看最近 Stash 的具体改动 Diff (git stash show -p)');
    console.log('\t\x1b[1m\x1b[31m[4 / c]\x1b[0m\t🗑️ 清空所有藏匿记录 (git stash clear)');
    console.log('\t\x1b[1m\x1b[37m[回车 / ESC / q]\x1b[0m\t🔙 返回 Git 主菜单');
    console.log('+------------------------------------------------------------------------+\n');

    const key = await getKeyPress('👉 请选择操作按键: ');

    if (key === 'ESC' || key === 'q' || key === 'ENTER') {
      return;
    }

    if (key === '1' || key === 's' || key === 'S') {
      const msg = await askQuestion('\n👉 请输入该 Stash 的备注描述 (留空使用默认自动描述): ');
      try {
        const args = ['stash', 'push', '-u'];
        if (msg.trim()) {
          args.push('-m', msg.trim());
        }
        const out = git(args);
        console.log('\n\x1b[32m✔ 工作区改动已安全保存至 Stash！\x1b[0m');
        if (out) console.log(out);
      } catch (err) {
        console.log(`\n❌ Stash 失败: ${err.message}`);
      }
      await getKeyPress('\n👉 按 [回车] 继续...');
      continue;
    }

    if (key === '2' || key === 'p' || key === 'P') {
      if (stashItems.length === 0) {
        console.log('\n💡 暂无任何可弹出的 Stash 记录。\n');
        await getKeyPress('👉 按 [回车] 继续...');
        continue;
      }
      try {
        const out = git(['stash', 'pop']);
        console.log('\n\x1b[32m✔ 已成功恢复并弹出 Stash 改动！\x1b[0m');
        if (out) console.log(out);
      } catch (err) {
        console.log(`\n❌ 弹出 Stash 遇到冲突或错误: ${err.message}`);
      }
      await getKeyPress('\n👉 按 [回车] 继续...');
      continue;
    }

    if (key === '3' || key === 'd' || key === 'D') {
      if (stashItems.length === 0) {
        console.log('\n💡 暂无任何 Stash 记录。\n');
        await getKeyPress('👉 按 [回车] 继续...');
        continue;
      }
      clearScreen();
      console.log('+========================================================================+');
      console.log('|\t🔍 最近一次 Stash 的代码改动详情 (git stash show -p)');
      console.log('+========================================================================+\n');
      const diffOut = git(['stash', 'show', '-p', '--color=always'], { allowError: true });
      console.log(diffOut || '(无改动详情)');
      console.log('\n+------------------------------------------------------------------------+');
      await getKeyPress('👉 按 [回车] 返回...');
      continue;
    }

    if (key === '4' || key === 'c' || key === 'C') {
      const confirm = await askQuestion('\n⚠️ 确定要清空所有 Stash 暂存记录吗？[y/n]: ');
      if (confirm.toLowerCase() === 'y') {
        git(['stash', 'clear']);
        console.log('\n\x1b[32m✔ 所有 Stash 记录已清空！\x1b[0m\n');
        await new Promise((r) => setTimeout(r, 600));
      }
      continue;
    }
  }
}

// ============================================================================
// 6. ⬆️ / ⬇️ 远程同步管理 (Remote Push / Pull / Fetch)
// ============================================================================

/**
 * 推送代码到远程
 */
async function handleGitPush() {
  clearScreen();
  const currentBranch = getCurrentBranch();

  console.log('+========================================================================+');
  console.log('|\t⬆️  Git Push (推送本地提交至 GitHub 远程仓库)');
  console.log(`|\t📌 目标远程分支:\t\x1b[1m\x1b[36morigin/${currentBranch}\x1b[0m`);
  console.log('+========================================================================+\n');

  console.log(`⏳ 正在向 GitHub (origin/${currentBranch}) 推送代码，请稍候...`);

  try {
    const res = spawnSync('git', ['push', '-u', 'origin', currentBranch], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024
    });

    const fullOutput = ((res.stdout || '') + '\n' + (res.stderr || '')).trim();

    if (res.status === 0) {
      console.log('\n\x1b[32m✔ 推送成功！(Push Success)\x1b[0m\n');
      console.log('+------------------------------------------------------------------------+');
      if (fullOutput.includes('Everything up-to-date') || fullOutput.includes('最新')) {
        console.log('|\t💡 远程分支已是最新状态，无需额外推送。');
      } else {
        console.log('|\t🎉 本地所有最新 Commit 已安全推送至 GitHub 远程仓库！');
      }
      console.log('+------------------------------------------------------------------------+');
    } else {
      console.log('\n\x1b[31m✖ 推送遇到问题 (Push Failed)\x1b[0m\n');
      console.log('+------------------------------------------------------------------------+');
      if (fullOutput.includes('non-fast-forward') || fullOutput.includes('fetch first')) {
        console.log('|\t❌ 远程仓库存在您本地没有的更新，请先执行【Git Pull】拉取代码后再推送！');
      } else {
        console.log(`|\t❌ 错误信息:\n${fullOutput}`);
      }
      console.log('+------------------------------------------------------------------------+');
    }
  } catch (err) {
    console.log(`\n❌ 执行异常: ${err.message}`);
  }

  await getKeyPress('\n👉 按 [回车] 返回 Git 菜单...');
}

/**
 * 拉取远程更新并合并
 */
async function handleGitPull() {
  clearScreen();
  const currentBranch = getCurrentBranch();

  console.log('+========================================================================+');
  console.log('|\t⬇️  Git Pull (从 GitHub 拉取远程最新代码)');
  console.log(`|\t📌 来源远程分支:\t\x1b[1m\x1b[36morigin/${currentBranch}\x1b[0m`);
  console.log('+========================================================================+\n');

  console.log(`⏳ 正在从 GitHub 拉取最新更新并尝试与本地合并...`);

  try {
    const res = spawnSync('git', ['pull', 'origin', currentBranch], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024
    });

    const fullOutput = ((res.stdout || '') + '\n' + (res.stderr || '')).trim();

    if (res.status === 0) {
      console.log('\n\x1b[32m✔ 拉取成功！(Pull Success)\x1b[0m\n');
      console.log('+------------------------------------------------------------------------+');
      if (fullOutput.includes('Already up to date') || fullOutput.includes('已经是最新')) {
        console.log('|\t💡 当前本地代码已经是最新版本，没有新的远程改动。');
      } else {
        console.log('|\t🎉 远程最新代码已成功同步并合并到本地分支！');
      }
      console.log('+------------------------------------------------------------------------+');
    } else {
      console.log('\n\x1b[31m✖ 拉取遇到冲突或错误 (Pull Conflict / Failed)\x1b[0m\n');
      console.log('+------------------------------------------------------------------------+');
      if (fullOutput.includes('CONFLICT') || fullOutput.includes('冲突')) {
        console.log('|\t⚠️  检测到代码合并冲突 (Merge Conflict)，请手动解决冲突文件后提交！');
      } else {
        console.log(`|\t❌ 错误详情:\n${fullOutput}`);
      }
      console.log('+------------------------------------------------------------------------+');
    }
  } catch (err) {
    console.log(`\n❌ 执行异常: ${err.message}`);
  }

  await getKeyPress('\n👉 按 [回车] 返回 Git 菜单...');
}

/**
 * 远程同步全能菜单
 */
async function handleRemoteSyncMenu() {
  const syncOptions = [
    { id: 'push', label: '⬆️  Git Push (推送本地提交至远程)', desc: '将当前分支的新提交安全推送至 GitHub' },
    { id: 'pull', label: '⬇️  Git Pull (拉取远程更新并合并)', desc: '获取远程最新改动并自动与当前分支合并' },
    { id: 'fetch', label: '🔄 Git Fetch (仅拉取最新引用)', desc: '抓取远程最新分支和节点，但不自动合并本地代码' },
    { id: 'remote_info', label: '🌐 查看 Remote 远程配置与连通性', desc: '查看远程仓库 URL、分支映射及网络通信状态' },
    { id: 'back', label: '🔙 返回 Git 主菜单', desc: '返回上一级 Git 控制台' }
  ];

  let cursorIndex = 0;

  while (true) {
    clearScreen();
    const currentBranch = getCurrentBranch();

    let out = '';
    out += '+========================================================================+\n';
    out += '|\t📡 Git 远程同步与诊断中心 (Remote Sync Console)\n';
    out += `|\t📌 当前分支:\t\x1b[1m\x1b[36m${currentBranch}\x1b[0m\n`;
    out += '+========================================================================+\n\n';

    syncOptions.forEach((opt, idx) => {
      const isFocused = idx === cursorIndex;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m \x1b[90m─ ${opt.desc}\x1b[0m\n`;
      } else {
        out += `${pointer}\x1b[37m${opt.label}\x1b[0m \x1b[90m─ ${opt.desc}\x1b[0m\n`;
      }
    });

    out += '\n+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回]\n';

    process.stdout.write(out);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + syncOptions.length) % syncOptions.length;
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % syncOptions.length;
      continue;
    }

    if (key === 'ENTER') {
      const selected = syncOptions[cursorIndex];

      if (selected.id === 'back') {
        return;
      }
      if (selected.id === 'push') {
        await handleGitPush();
        continue;
      }
      if (selected.id === 'pull') {
        await handleGitPull();
        continue;
      }
      if (selected.id === 'fetch') {
        console.log('\n⏳ 正在拉取远程最新引用 (git fetch origin)...');
        try {
          const out = git(['fetch', 'origin']);
          console.log('\n\x1b[32m✔ 远程引用抓取成功！\x1b[0m');
          if (out) console.log(out);
        } catch (err) {
          console.log(`\n❌ Fetch 失败: ${err.message}`);
        }
        await getKeyPress('\n👉 按 [回车] 继续...');
        continue;
      }
      if (selected.id === 'remote_info') {
        clearScreen();
        console.log('+========================================================================+');
        console.log('|\t🌐 Git Remote 远程配置详情');
        console.log('+========================================================================+\n');
        const remoteOut = git(['remote', '-v'], { allowError: true });
        console.log(remoteOut || '(未配置任何远程仓库)');
        console.log('\n+------------------------------------------------------------------------+');
        await getKeyPress('👉 按 [回车] 返回...');
        continue;
      }
    }
  }
}

// ============================================================================
// 7. 🏷️ 版本标签管理 (Git Tag Manager)
// ============================================================================

/**
 * 标签管理中心
 */
async function handleTagMenu() {
  while (true) {
    clearScreen();
    const rawTags = git(['tag', '-l', '-n1', '--sort=-v:refname'], { allowError: true });
    const tags = rawTags ? rawTags.split('\n').filter(Boolean) : [];

    console.log('+========================================================================+');
    console.log('|\t🏷️  Git 版本标签管理中心 (Tag Manager)');
    console.log(`|\t📌 现有标签数:\t\x1b[1m\x1b[33m${tags.length}\x1b[0m 个`);
    console.log('+========================================================================+\n');

    if (tags.length === 0) {
      console.log('\t(暂无任何 Git Tag 标签记录)\n');
    } else {
      console.log('📋 现有标签清单 (按版本倒序):');
      tags.slice(0, 15).forEach((t, i) => {
        console.log(`\t\x1b[32m[${i + 1}]\x1b[0m ${t}`);
      });
      if (tags.length > 15) {
        console.log(`\t... (共 ${tags.length} 个标签)`);
      }
      console.log('');
    }

    console.log('+------------------------------------------------------------------------+');
    console.log('操作选项:');
    console.log('\t\x1b[1m\x1b[32m[1 / a]\x1b[0m\t🏷️  创建新附注标签 (git tag -a v1.x -m "...")');
    console.log('\t\x1b[1m\x1b[36m[2 / p]\x1b[0m\t🚀 推送所有标签至 GitHub (git push origin --tags)');
    console.log('\t\x1b[1m\x1b[31m[3 / d]\x1b[0m\t🗑️  删除指定本地标签 (git tag -d)');
    console.log('\t\x1b[1m\x1b[37m[回车 / ESC / q]\x1b[0m\t🔙 返回 Git 主菜单');
    console.log('+------------------------------------------------------------------------+\n');

    const key = await getKeyPress('👉 请选择操作按键: ');

    if (key === 'ESC' || key === 'q' || key === 'ENTER') {
      return;
    }

    if (key === '1' || key === 'a' || key === 'A') {
      const tagName = await askQuestion('\n👉 请输入新 Tag 版本号 (如 v1.0.0，回车取消): ');
      if (tagName) {
        const msg = await askQuestion(`👉 请输入标签 [${tagName}] 的描述信息 (回车使用默认描述): `);
        try {
          git(['tag', '-a', tagName, '-m', msg.trim() || `Release version ${tagName}`]);
          console.log(`\n\x1b[32m✔ 标签 [${tagName}] 创建成功！\x1b[0m\n`);
        } catch (err) {
          console.log(`\n❌ 创建标签失败: ${err.message}\n`);
        }
        await getKeyPress('👉 按 [回车] 继续...');
      }
      continue;
    }

    if (key === '2' || key === 'p' || key === 'P') {
      console.log('\n⏳ 正在推送本地全部标签到 GitHub (git push origin --tags)...');
      try {
        const out = git(['push', 'origin', '--tags']);
        console.log('\n\x1b[32m✔ 全部标签已成功推送到远程仓库！\x1b[0m');
        if (out) console.log(out);
      } catch (err) {
        console.log(`\n❌ 推送标签失败: ${err.message}`);
      }
      await getKeyPress('\n👉 按 [回车] 继续...');
      continue;
    }

    if (key === '3' || key === 'd' || key === 'D') {
      const delTag = await askQuestion('\n👉 请输入要删除的标签名称 (回车取消): ');
      if (delTag) {
        try {
          git(['tag', '-d', delTag]);
          console.log(`\n\x1b[32m✔ 本地标签 [${delTag}] 已成功删除！\x1b[0m\n`);
        } catch (err) {
          console.log(`\n❌ 删除失败: ${err.message}\n`);
        }
        await getKeyPress('👉 按 [回车] 继续...');
      }
      continue;
    }
  }
}

// ============================================================================
// 8. 👤 提交者身份与配置管理 (User Config & Environment)
// ============================================================================

/**
 * 切换 Git 用户名与邮箱配置
 */
async function handleSwitchUserConfig() {
  const options = [
    { id: 'local', label: '修改【当前项目】Git 身份 (推荐，仅对当前项目生效)' },
    { id: 'global', label: '修改【全局系统】Git 身份 (对电脑所有 Git 仓库生效)' },
    { id: 'view_config', label: '查看 Git 核心环境变量与配置清单' },
    { id: 'back', label: '返回上级菜单' }
  ];

  let cursorIndex = 0;

  function renderUserConfigUI(idx) {
    const localName = git(['config', '--local', 'user.name'], { allowError: true }) || '(未单独设置，继承全局)';
    const localEmail = git(['config', '--local', 'user.email'], { allowError: true }) || '(未单独设置，继承全局)';
    const globalName = git(['config', '--global', 'user.name'], { allowError: true }) || '(未设置)';
    const globalEmail = git(['config', '--global', 'user.email'], { allowError: true }) || '(未设置)';
    const effectiveName = git(['config', 'user.name'], { allowError: true }) || '(未设置)';
    const effectiveEmail = git(['config', 'user.email'], { allowError: true }) || '(未设置)';

    let out = '';
    out += '+========================================================================+\n';
    out += '|\t👤 Git 提交者身份配置 (切换用户名与邮箱)\n';
    out += '+========================================================================+\n\n';
    out += '📋 当前 Git 账户信息：\n';
    out += `\t✨ 当前生效身份:\t\x1b[1m\x1b[32m${effectiveName}\x1b[0m <\x1b[1m\x1b[36m${effectiveEmail}\x1b[0m>\n`;
    out += `\t📁 本项目专用配置 (Local):\t${localName} <${localEmail}>\n`;
    out += `\t🌐 系统全局配置 (Global):\t${globalName} <${globalEmail}>\n\n`;
    out += '请选择要执行的操作：\n\n';

    options.forEach((opt, index) => {
      const isFocused = index === idx;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m\n`;
      } else {
        out += `${pointer}\x1b[37m${opt.label}\x1b[0m\n`;
      }
    });

    out += '\n+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderUserConfigUI(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + options.length) % options.length;
      renderUserConfigUI(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % options.length;
      renderUserConfigUI(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = options[cursorIndex];
      if (selected.id === 'back') {
        return;
      }

      if (selected.id === 'view_config') {
        clearScreen();
        console.log('+========================================================================+');
        console.log('|\t⚙️  Git 核心常用配置清单 (git config --list --show-origin)');
        console.log('+========================================================================+\n');
        const cfgOut = git(['config', '--list'], { allowError: true });
        console.log(cfgOut || '(无配置项)');
        console.log('\n+------------------------------------------------------------------------+');
        await getKeyPress('👉 按 [回车] 返回...');
        continue;
      }

      const isGlobal = selected.id === 'global';
      const scopeFlag = isGlobal ? '--global' : '--local';
      const scopeName = isGlobal ? '全局系统 (Global)' : '当前项目 (Local)';
      const effectiveName = git(['config', 'user.name'], { allowError: true }) || '';
      const effectiveEmail = git(['config', 'user.email'], { allowError: true }) || '';

      console.log(`\n✏️  即将设置【${scopeName}】的 Git 提交身份 (输入后按回车确认，直接回车保留原值)：\n`);

      const currentDefaultName = effectiveName === '(未设置)' ? '' : effectiveName;
      const currentDefaultEmail = effectiveEmail === '(未设置)' ? '' : effectiveEmail;

      const newName = await askQuestion(`👉 请输入新的 Git 用户名 (直接回车保留: "${currentDefaultName}"): `);
      const newEmail = await askQuestion(`👉 请输入新的 Git 邮箱地址 (直接回车保留: "${currentDefaultEmail}"): `);

      const finalName = newName.trim() || currentDefaultName;
      const finalEmail = newEmail.trim() || currentDefaultEmail;

      if (finalName) {
        git(['config', scopeFlag, 'user.name', finalName]);
      }
      if (finalEmail) {
        git(['config', scopeFlag, 'user.email', finalEmail]);
      }

      console.log('\n+========================================================================+');
      console.log(`|\t🎉 【${scopeName}】Git 身份已成功更新！`);
      console.log(`|\t👤 用户名:\t\x1b[1m\x1b[32m${finalName}\x1b[0m`);
      console.log(`|\t📧 邮箱:\t\x1b[1m\x1b[36m${finalEmail}\x1b[0m`);
      console.log('+========================================================================+\n');

      await getKeyPress('👉 按 [回车] 返回 Git 菜单...');
      return;
    }
  }
}

// ============================================================================
// 9. 🌿 Git 主控制台交互控制器
// ============================================================================

const GIT_MAIN_OPTIONS = [
  { id: 'log_browser', label: '📜 提交历史翻页浏览器', desc: '支持多页翻页、搜索过滤、查看单条Diff、复制SHA与分支图谱' },
  { id: 'branch_mgr', label: '🔀 分支全能管理中心', desc: '分支切换、新建、重命名、安全删除与远程分支追踪同步' },
  { id: 'working_tree', label: '📊 工作区与暂存区治理', desc: '查看文件增删改、Diff代码改动、暂存/取消暂存与安全重置' },
  { id: 'remote_sync', label: '📡 远程推送与拉取同步', desc: 'Git Push、Git Pull 冲突诊断、Git Fetch 及 Remote 连通性' },
  { id: 'stash_mgr', label: '📦 暂存藏匿管理 (Stash)', desc: '保存当前工作区改动至 Stash、弹出恢复、改动Diff与清空' },
  { id: 'tag_mgr', label: '🏷️  版本标签管理 (Tag)', desc: '创建 Release 版本标签、推送标签至 GitHub 与删除标签' },
  { id: 'user_config', label: '👤 提交身份与环境配置', desc: '切换 Local / Global 用户名与邮箱，查看 Git 核心环境变量' },
  { id: 'back', label: '🔙 返回总控主菜单', desc: '返回上一级高校后勤巡查e速办总控台' }
];

let cachedGitInfo = {
  branch: 'main',
  name: '张天予',
  email: 'zhangtianyu200444@126.com',
  changeCount: 0
};

function refreshCachedGitInfo() {
  const statusOut = git(['status', '--porcelain'], { allowError: true });
  const changes = statusOut ? statusOut.split('\n').filter(Boolean).length : 0;

  cachedGitInfo = {
    branch: getCurrentBranch(),
    name: git(['config', 'user.name'], { allowError: true }) || '(未配置用户名)',
    email: git(['config', 'user.email'], { allowError: true }) || '(未配置邮箱)',
    changeCount: changes
  };
}

/**
 * 纯内存原子化渲染 Git 控制台主菜单
 */
function printGitMainMenu(cursorIndex = 0) {
  const currentBranch = cachedGitInfo.branch;
  const userName = cachedGitInfo.name;
  const userEmail = cachedGitInfo.email;
  const changes = cachedGitInfo.changeCount;

  let out = '';
  out += '+=================================================================================+\n';
  out += `|  🌿 Git 全能运维与版本控制工作台 (Git Operations Console)\n`;
  out += `|  👤 提交身份: \x1b[1m\x1b[32m${userName}\x1b[0m <\x1b[36m${userEmail}\x1b[0m>  |  📌 分支: \x1b[1m\x1b[36m${currentBranch}\x1b[0m` + (currentBranch === 'new-version' ? ' \x1b[32m★(推荐)\x1b[0m' : '') + '\n';
  out += `|  📊 工作区状态: ` + (changes > 0 ? `\x1b[1m\x1b[33m⚠️ 有 ${changes} 个未提交修改文件\x1b[0m` : `\x1b[32m🟢 工作区干净，所有文件已提交\x1b[0m`) + '\n';
  out += '+=================================================================================+\n\n';

  GIT_MAIN_OPTIONS.forEach((opt, idx) => {
    const isFocused = idx === cursorIndex;
    const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';

    if (isFocused) {
      out += `${pointer}\x1b[1m\x1b[36m${padVisual(opt.label, 26)}\x1b[0m \x1b[37m${opt.desc}\x1b[0m\n`;
    } else {
      out += `${pointer}\x1b[37m${padVisual(opt.label, 26)}\x1b[0m \x1b[90m${opt.desc}\x1b[0m\n`;
    }
  });

  out += '\n+---------------------------------------------------------------------------------+\n';
  out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回主菜单]\n';

  process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
}

/**
 * 主循环
 */
async function main() {
  let cursorIndex = 0;
  refreshCachedGitInfo();

  while (true) {
    printGitMainMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      process.exit(0);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + GIT_MAIN_OPTIONS.length) % GIT_MAIN_OPTIONS.length;
      printGitMainMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % GIT_MAIN_OPTIONS.length;
      printGitMainMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = GIT_MAIN_OPTIONS[cursorIndex];

      if (selected.id === 'back') {
        process.exit(0);
      } else if (selected.id === 'log_browser') {
        await handleInteractiveCommitBrowser();
        refreshCachedGitInfo();
      } else if (selected.id === 'branch_mgr') {
        await handleBranchManagementMenu();
        refreshCachedGitInfo();
      } else if (selected.id === 'working_tree') {
        await handleWorkingTreeMenu();
        refreshCachedGitInfo();
      } else if (selected.id === 'remote_sync') {
        await handleRemoteSyncMenu();
        refreshCachedGitInfo();
      } else if (selected.id === 'stash_mgr') {
        await handleStashMenu();
        refreshCachedGitInfo();
      } else if (selected.id === 'tag_mgr') {
        await handleTagMenu();
        refreshCachedGitInfo();
      } else if (selected.id === 'user_config') {
        await handleSwitchUserConfig();
        refreshCachedGitInfo();
      }
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ Git 管理控制台异常:', err);
  process.exit(1);
});
