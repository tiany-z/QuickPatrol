/**
 * TOOL_OPEN_GITHUB_REPO.js
 * 
 * 在默认浏览器中快速打开高校后勤巡查e速办 (QuickPatrol) 的 GitHub 远程仓库主页。
 * 打开前在控制台展示仓库地址与访问确认提示。
 * 
 * 特性：
 *   - 单键即按即响应（按下 1 即刻打开，无需回车）
 *   - 自动动态探测当前 Git Remote 关联的远程仓库地址
 */

import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import readline from 'node:readline';
import { tryAutoOpenBrowser, PROJECT_ROOT } from './config_helper.js';

function getRepoUrl() {
  try {
    const res = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8'
    });
    let raw = (res.stdout || '').trim();
    if (raw) {
      if (raw.startsWith('git@github.com:')) {
        raw = 'https://github.com/' + raw.slice('git@github.com:'.length);
      }
      if (raw.endsWith('.git')) {
        raw = raw.slice(0, -4);
      }
      return raw;
    }
  } catch {}
  return 'https://github.com/tiany-z/QuickPatrol';
}

const REPO_URL = getRepoUrl();

/**
 * 清屏函数 (跨终端兼容)
 */
function clearScreen() {
  try {
    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J');
    console.clear?.();
  } catch {}
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
 * 跨平台调起系统默认浏览器打开 URL
 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd = '';
  let args = [];

  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    // Linux / BSD
    cmd = 'xdg-open';
    args = [url];
  }

  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * 主流程
 */
async function main() {
  const options = [
    { id: 'open', label: '✔ 确认并在默认浏览器中打开该仓库页面' },
    { id: 'cancel', label: '🚪 取消并退出' }
  ];
  let cursorIndex = 0;

  function renderOpenMenu(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🌐 GitHub 远程仓库快速直达工具\n';
    out += '+========================================================================+\n';
    out += `\n\t🔗 目标仓库地址:\t\x1b[1m\x1b[36m${REPO_URL}\x1b[0m\n\n`;

    out += '+------------------------------------------------------------------------+\n';
    out += '|\t\x1b[1m\x1b[33m⚠️  【权限与访问提示】\x1b[0m\n';
    out += '+------------------------------------------------------------------------+\n';
    out += '|\t1. 该仓库为 \x1b[1m\x1b[36m高校后勤巡查e速办 (QuickPatrol)\x1b[0m 关联代码仓库。\n';
    out += '|\t2. 若在浏览器打开后显示 \x1b[1m\x1b[33m404 Not Found\x1b[0m，通常原因如下：\n';
    out += '|\t\t• 浏览器中尚未登录具有该仓库访问权限的 GitHub 账号；\n';
    out += '|\t\t• 仓库权限设置尚未向当前账号开放。\n';
    out += '|\t3. 如遇权限问题，请联系仓库负责人为您添加协作者权限。\n';
    out += '+------------------------------------------------------------------------+\n\n';

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
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 取消退出]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderOpenMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC' || (key === 'ENTER' && options[cursorIndex].id === 'cancel')) {
      console.log('\n🚪 已取消打开操作。\n');
      process.exit(0);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + options.length) % options.length;
      renderOpenMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % options.length;
      renderOpenMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER' && options[cursorIndex].id === 'open') {
      console.log(`\n🔗 GitHub 仓库直达地址:\n\t\x1b[1m\x1b[36m${REPO_URL}\x1b[0m\n`);
      console.log('🚀 正在尝试自动唤起系统浏览器...');
      const opened = tryAutoOpenBrowser(REPO_URL);
      if (opened) {
        console.log('✔ 已向系统发送浏览器打开指令！如未弹出，请直接复制上方链接在浏览器访问。\n');
      } else {
        console.log('💡 当前系统未检测到图形界面或浏览器，请手动复制上方链接在浏览器中访问。\n');
      }
      await getKeyPress('👉 按 [回车] 或 [ESC] 返回主菜单...');
      process.exit(0);
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  main().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ 运行发生异常:', err);
    process.exit(1);
  });
}
