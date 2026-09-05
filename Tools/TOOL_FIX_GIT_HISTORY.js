/**
 * TOOL_FIX_GIT_HISTORY.js
 * 
 * Git 历史提交治理与修复控制台 (History Fix Manager)
 * 聚合两项核心历史修复与重写能力：
 *   1. 历史 Commit Title 规范化优化 (调用 AI 大模型批量优化为 Conventional Commits)
 *   2. Git 提交者信息全量规范化 (批量重写历史 Commit 的作者名称与邮箱地址)
 * 
 * 特性：
 *   - 纯内存原子化极速渲染，上下键切换 0 延迟
 *   - ESC / ENTER 点了立即响应
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 子功能注册表
const SUB_TOOLS = [
  {
    name: '历史 Commit Title 智能规范优化',
    file: 'TOOL_OPTIMIZE_COMMIT_TITLES.js',
    icon: '📝',
    desc: '扫描全部分支历史提交，调用 AI 大模型批量优化为标准 Conventional Commits 格式'
  },
  {
    name: '统一修复历史提交作者与邮箱',
    file: 'TOOL_STANDARDIZE_AUTHORS.js',
    icon: '👤',
    desc: '全仓库自动批量统一修改历史 Commit 的作者名称与邮箱地址，并安全同步分支'
  },
  {
    name: '返回总控主菜单',
    file: '',
    icon: '🔙',
    desc: '返回上一级高校后勤巡查e速办总控台',
    isBack: true
  }
];

/**
 * 跨平台终端清屏
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
 * 执行选定子工具脚本
 */
async function runChildScript(tool) {
  clearScreen();
  const scriptPath = path.join(__dirname, tool.file);

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
  }
  process.stdin.pause();

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: process.env
    });

    child.on('close', async (code) => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        } catch {}
      } else {
        process.stdin.resume();
      }

      if (code !== 0) {
        console.log('\n+------------------------------------------------------------------------+');
        console.log(`|\t⚠️  [程序退出]\t${tool.name} (退出状态码: ${code})`);
        console.log('+------------------------------------------------------------------------+');
        await getKeyPress('\n👉 按 [回车] 或 [ESC] 返回历史治理菜单...');
      }
      resolve();
    });

    child.on('error', async (err) => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        } catch {}
      } else {
        process.stdin.resume();
      }

      console.error(`\n❌ [启动失败] 无法启动程序: ${err.message}`);
      await getKeyPress('\n👉 按 [回车] 或 [ESC] 返回历史治理菜单...');
      resolve();
    });
  });
}

/**
 * 纯内存原子化渲染历史治理控制台菜单
 */
function printMenu(cursorIndex = 0) {
  let out = '';
  out += '+========================================================================+\n';
  out += '|\t🧹 Git 历史提交治理与修复控制台 (History Fix Manager)\n';
  out += `|\t📂 项目路径:\t${PROJECT_ROOT}\n`;
  out += '+========================================================================+\n\n';

  SUB_TOOLS.forEach((tool, idx) => {
    const isFocused = idx === cursorIndex;
    const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';

    if (isFocused) {
      out += `${pointer}\x1b[1m\x1b[36m${tool.icon} ${tool.name}\x1b[0m\n`;
      out += `\t   └─ \x1b[90m${tool.desc}\x1b[0m\n\n`;
    } else {
      out += `${pointer}\x1b[37m${tool.icon} ${tool.name}\x1b[0m\n`;
      out += `\t   └─ \x1b[90m${tool.desc}\x1b[0m\n\n`;
    }
  });

  out += '+------------------------------------------------------------------------+\n';
  out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回主菜单]\n';

  process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
}

/**
 * 主循环
 */
async function main() {
  let cursorIndex = 0;

  while (true) {
    printMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      process.exit(0);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + SUB_TOOLS.length) % SUB_TOOLS.length;
      printMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % SUB_TOOLS.length;
      printMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = SUB_TOOLS[cursorIndex];

      if (selected.isBack || !selected.file) {
        process.exit(0);
      }

      await runChildScript(selected);
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 历史治理控制台异常:', err);
  process.exit(1);
});
