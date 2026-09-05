/**
 * TOOL_RUN_ALL_TESTS.js
 * 
 * 高校后勤巡查e速办 v4.0 单元测试回归执行器
 * 
 * 特性：
 *   - 默认静默模式：仅展示实时简洁进度，不打印冗余测试过程；
 *   - 报错精准呈现：仅当用例失败时，精准高亮输出失败文件、报错原因与调用栈；
 *   - 详细模式可选：支持按 [2 / v] 或传参 --verbose 查看全量原始日志。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 测试子模块配置（仅执行 Backend 单元测试）
const SUBPROJECTS = [
  { name: 'Backend (高校后勤巡查后端服务)', dir: 'Backend' },
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

/**
 * 单键即按即响应监听器（无需回车）
 */
function getKeyPress(promptText = '') {
  if (promptText) {
    process.stdout.write(promptText);
  }

  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (chunk) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);

        if (chunk === '\u0003') {
          console.log('\n');
          process.exit(0);
        }

        if (chunk === '\r' || chunk === '\n') {
          resolve('ENTER');
          return;
        }

        if (chunk === '\u001b') {
          resolve('ESC');
          return;
        }

        resolve(chunk.trim());
      };

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
 * 查找可用 Vitest 执行路径
 */
function findVitestPath(subDirAbs) {
  const localVitest = path.join(subDirAbs, 'node_modules', 'vitest', 'vitest.mjs');
  if (fs.existsSync(localVitest)) return localVitest;

  const backendVitest = path.join(PROJECT_ROOT, 'Backend', 'node_modules', 'vitest', 'vitest.mjs');
  if (fs.existsSync(backendVitest)) return backendVitest;

  return null;
}

/**
 * 提取失败日志核心错误信息
 */
function extractFailureSummary(output) {
  const lines = output.split('\n');
  const errorLines = [];
  let capture = false;

  for (const line of lines) {
    if (line.includes('FAIL') || line.includes('Error:') || line.includes('Unhandled Error') || line.includes('AssertionError')) {
      capture = true;
    }
    if (capture) {
      errorLines.push(line);
    }
  }

  if (errorLines.length > 0) {
    return errorLines.slice(0, 40).join('\n');
  }
  return output.slice(-2000);
}

/**
 * 执行单个子项目的测试
 */
async function runTestForSubproject(sub, index, total, isVerbose = false) {
  const startTime = Date.now();
  const subDirAbs = path.join(PROJECT_ROOT, sub.dir);

  process.stdout.write(`\t[${index + 1}/${total}] 正在测试:\t${sub.name} ... `);

  return new Promise((resolve) => {
    const vitestMjsPath = findVitestPath(subDirAbs);
    const nodeExe = process.execPath;
    const args = vitestMjsPath ? [vitestMjsPath, 'run'] : ['./node_modules/vitest/vitest.mjs', 'run'];

    let outputBuffer = '';

    const child = spawn(nodeExe, args, {
      cwd: subDirAbs,
      stdio: isVerbose ? 'inherit' : 'pipe',
      env: { ...process.env, CI: 'true', FORCE_COLOR: '1' },
    });

    if (!isVerbose) {
      child.stdout?.on('data', (d) => {
        outputBuffer += d.toString('utf-8');
      });
      child.stderr?.on('data', (d) => {
        outputBuffer += d.toString('utf-8');
      });
    }

    child.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      if (code === 0) {
        console.log(`\x1b[32m✔ 通过 (${duration}s)\x1b[0m`);
        resolve({
          name: sub.name,
          dir: sub.dir,
          status: 'PASS',
          duration: `${duration}s`,
          errorDetails: null
        });
      } else {
        console.log(`\x1b[31m✖ 失败 (${duration}s, 退出码: ${code})\x1b[0m`);
        const errorDetails = extractFailureSummary(outputBuffer);
        resolve({
          name: sub.name,
          dir: sub.dir,
          status: 'FAIL',
          duration: `${duration}s`,
          errorDetails
        });
      }
    });

    child.on('error', (err) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\x1b[31m✖ 异常 (${err.message})\x1b[0m`);
      resolve({
        name: sub.name,
        dir: sub.dir,
        status: 'ERROR',
        duration: `${duration}s`,
        errorDetails: err.message
      });
    });
  });
}

/**
 * 主流程
 */
async function main() {
  clearScreen();

  const isCliVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  let isVerbose = isCliVerbose;

  // 如果没有 CLI 参数，提供交互式模式选择
  if (!isCliVerbose && process.stdin.isTTY) {
    console.log('+========================================================================+');
    console.log('|\t🧪 高校后勤巡查e速办 v4.0 单元测试运行器');
    console.log('+========================================================================+\n');

    console.log('📋 请选择测试运行模式：\n');
    console.log('\t\x1b[1m\x1b[32m[1 / y / ENTER]\x1b[0m\t⚡ 简洁静默模式 (默认：仅显示进度，失败时才打印错误详情)');
    console.log('\t\x1b[1m\x1b[33m[2 / v]\x1b[0m\t\t🔍 详细输出模式 (实时打印所有通过用例与内部日志)');
    console.log('\t\x1b[1m\x1b[31m[3 / 0 / q / ESC]\x1b[0m\t🚪 取消并返回\n');
    console.log('+------------------------------------------------------------------------+');

    const choiceKey = await getKeyPress('👉 请直接按键选择 [1/2/3]: ');
    console.log(choiceKey);

    if (choiceKey === '3' || choiceKey === '0' || choiceKey.toLowerCase() === 'q' || choiceKey === 'ESC') {
      console.log('\n🚪 已取消测试。');
      process.exit(0);
    }

    if (choiceKey === '2' || choiceKey.toLowerCase() === 'v') {
      isVerbose = true;
    }
  }

  clearScreen();
  console.log('+========================================================================+');
  console.log(`|\t🧪 正在执行全部 ${SUBPROJECTS.length} 个子系统的单元测试 (${isVerbose ? '详细模式' : '简洁静默模式'})...`);
  console.log('+========================================================================+\n');

  const results = [];
  let hasFailure = false;

  for (let i = 0; i < SUBPROJECTS.length; i++) {
    const res = await runTestForSubproject(SUBPROJECTS[i], i, SUBPROJECTS.length, isVerbose);
    results.push(res);
    if (res.status !== 'PASS') {
      hasFailure = true;
    }
  }

  // 如果有失败项且处于简洁模式，展示详细错误信息
  const failedItems = results.filter((r) => r.status !== 'PASS');
  if (failedItems.length > 0 && !isVerbose) {
    console.log('\n+========================================================================+');
    console.log('|\t❌ 以下子项目测试未通过，详细错误原因如下:');
    console.log('+========================================================================+');

    failedItems.forEach((item) => {
      console.log(`\n🔴 【未通过子项目】: ${item.name} (${item.dir})`);
      console.log('-'.repeat(70));
      if (item.errorDetails) {
        console.log(item.errorDetails);
      } else {
        console.log('   (无详细错误堆栈输出)');
      }
      console.log('-'.repeat(70));
    });
  }

  // 输出汇总报告
  console.log('\n+========================================================================+');
  console.log('|\t📊 高校后勤巡查e速办 v4.0 单元测试汇总报告');
  console.log('+========================================================================+');

  results.forEach((r) => {
    const badge = r.status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    console.log(`|\t${badge}\t${r.name}\t(耗时: ${r.duration})`);
  });

  console.log('+========================================================================+');

  const isNonInteractive = process.argv.includes('--ci') || process.argv.includes('--non-interactive') || !process.stdin.isTTY;

  if (hasFailure) {
    console.log('\n⚠️ 部分子项目测试未通过，请根据上方错误详情进行排查！\n');
    if (!isNonInteractive) {
      await getKeyPress('👉 按 [回车] 或 [ESC] 返回主菜单...');
    }
    process.exit(1);
  } else {
    console.log(`\n🎉 恭喜！全部 ${SUBPROJECTS.length} 个子系统单元测试百分之百顺利通过！\n`);
    if (!isNonInteractive) {
      await getKeyPress('👉 按 [回车] 或 [ESC] 返回主菜单...');
    }
    process.exit(0);
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 测试执行异常:', err);
  process.exit(1);
});
