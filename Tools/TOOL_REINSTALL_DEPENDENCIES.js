/**
 * TOOL_REINSTALL_DEPENDENCIES.js
 * 
 * 后端服务依赖深度重装工具 (Clean Reinstall Backend Dependencies)
 * 
 * 核心功能：
 *   1. 彻底清空删除 Backend 模块的 node_modules 目录；
 *   2. 自动检测并就绪 cnpm 环境，从高速镜像源重新执行全新无缓存安装；
 *   3. 【纯净依赖运维】：专注后端依赖重装，绝不对根目录 chat_sys_config.json 中的 AI 参数及配置进行任何修改；微信小程序端依赖由微信开发者工具独立管理。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { PROJECT_ROOT } from './config_helper.js';
import { ALL_SUBPROJECTS, installAllSubprojectDependencies } from './TOOL_INITIALIZE_PROJECT.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * 清空后端服务的 node_modules 目录
 */
function cleanAllNodeModules() {
  console.log('+========================================================================+');
  console.log('|\t🗑️  【阶段 1/2：正在清空后端服务的 node_modules 目录】');
  console.log('+========================================================================+\n');

  for (let i = 0; i < ALL_SUBPROJECTS.length; i++) {
    const sub = ALL_SUBPROJECTS[i];
    const nmPath = path.resolve(PROJECT_ROOT, sub.dir, 'node_modules');
    const progressTag = `[${i + 1}/${ALL_SUBPROJECTS.length}]`;

    process.stdout.write(`\t${progressTag} 🗑️  正在清理 \x1b[1m\x1b[36m${sub.name}\x1b[0m/node_modules... `);

    if (fs.existsSync(nmPath)) {
      try {
        fs.rmSync(nmPath, { recursive: true, force: true });
        console.log('\x1b[1m\x1b[32m✔ 已删除\x1b[0m');
      } catch (err) {
        console.log(`\x1b[33m⚠️ 删除受限 (${err.message})\x1b[0m`);
      }
    } else {
      console.log('\x1b[90m(不存在，无需清理)\x1b[0m');
    }
  }

  console.log('\n✔ 阶段 1 完成：所有旧依赖缓存已彻底清除！\n');
}

/**
 * 主流程
 */
async function main() {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🔄 高校后勤巡查e速办 v4.0 后端依赖深度重装工具 (Clean Reinstall)');
  console.log('+========================================================================+\n');

  const options = [
    { id: 'confirm', label: '✔ 确认开始彻底清空并全新安装后端 (Backend) 依赖' },
    { id: 'cancel', label: '🚪 取消并返回主菜单' }
  ];
  let cursorIndex = 0;

  function renderReinstallMenu(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🔄 高校后勤巡查e速办 v4.0 后端依赖深度重装工具 (Clean Reinstall)\n';
    out += '+========================================================================+\n\n';
    out += '⚠️  \x1b[1m\x1b[33m操作说明：\x1b[0m\n';
    out += `\t该操作将彻底删除后端服务 (Backend) 的 \x1b[31mnode_modules\x1b[0m 目录，\n`;
    out += '\t并自动从镜像源重新执行 \x1b[32mcnpm install\x1b[0m 高速全新安装。\n';
    out += '\t\x1b[36m💡 说明：微信小程序的依赖由微信开发者工具自行管理，本工具仅管理 Backend 依赖。\x1b[0m\n';
    out += '\t\x1b[36m💡 注意：该操作纯粹进行依赖重装，不会对 chat_sys_config.json 中的 AI 配置进行任何修改。\x1b[0m\n\n';
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
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderReinstallMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      console.log('\n🚪 已取消操作。\n');
      process.exit(0);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + options.length) % options.length;
      renderReinstallMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % options.length;
      renderReinstallMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      if (options[cursorIndex].id === 'cancel') {
        console.log('\n🚪 已取消操作。\n');
        process.exit(0);
      }
      break;
    }
  }

  // 阶段 1: 清理 node_modules
  cleanAllNodeModules();
  await new Promise((r) => setTimeout(r, 800));

  // 阶段 2: 重新执行 npm install (纯净模式，不触碰或修改根目录任何 AI 配置文件)
  const ok = await installAllSubprojectDependencies({ recordErrorInConfig: false });

  if (!ok) {
    console.log('❌ 后端服务依赖重新安装未成功，请检查网络或依赖安装日志。\n');
    process.exit(1);
  }

  console.log('+========================================================================+');
  console.log('|\t🎉 后端服务 (Backend) 依赖已全部重新安装就绪！');
  console.log('+========================================================================+\n');

  await getKeyPress('👉 按 [回车] 返回主菜单...');
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  main().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ 重新安装依赖时发生未捕获异常:', err);
    process.exit(1);
  });
}
