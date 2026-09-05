/**
 * TOOL_MENU.js
 * 
 * 高校后勤巡查e速办 v4.0 研发运维总控台 (Central Operations & AI Automation Console)
 * 
 * 核心特性：
 *   1. 【AI 状态感知与禁用保护】
 *      - 若初始化跳过了 AI 配置，所有 AI 相关功能自动打上锁定标记并禁用；
 *      - 点击禁用功能时提供一键引导跳转至 [⚙️ AI 接口参数配置]；
 *   2. 【双模自适应排版引擎】
 *      - 宽屏模式 (≥70列)：自适应 2列/3列/4列 GRID 网格卡片布局，全局居中对称留白；
 *      - 极窄模式 (<70列)：自动切换为单列极简轻量单行列表模式，彻底杜绝多层框线拥挤与溢出；
 *   3. 【窗口缩放动态刷新】实时监听 resize 事件，终端拉伸缩放时零延迟自适应重新计算并刷新；
 *   4. 【标准 Unicode 终端字符宽度引擎 (wcwidth)】精准处理 Box Drawing (┌─┐)、箭头 (↑↓←→)、Emoji、全角/半角字符；
 *   5. 【绝对防溢出像素级对齐】顶栏状态框、卡片网格、底栏操作指南三者宽度与边框 100% 锁定对齐；
 *   6. 【4 向无缝全向导航】支持 ↑ / ↓ / ← / → 以及 W/A/S/D、H/J/K/L 盲打网格导航；
 *   7. 【解耦渲染与静默状态更新】纯内存极速界面重绘 (<0.1ms)，后台定时器静默拉取 Git 状态。
 */

import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { isProjectInitialized, getDependencyInstallError, hasValidAiKey, PROJECT_ROOT } from './config_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------- 工具注册表 (通俗易懂精炼主标题) -----------------
const TOOLS_REGISTRY = [
  {
    name: '🚀 AI 智能提交推送',
    file: 'TOOL_AUTO_COMMIT_WITH_AI.js',
    requiresAi: true
  },
  {
    name: '📑 AI 撰写工作报告',
    file: 'TOOL_GENERATE_WORK_REPORT.js',
    requiresAi: true
  },
  {
    name: '🔍 AI 代码智能体解析',
    file: 'TOOL_AI_CODE_ANALYSIS.js',
    requiresAi: true
  },
  {
    name: '📖 AI 编写项目文档',
    file: 'TOOL_UPDATE_README_WITH_AI.js',
    requiresAi: true
  },
  {
    name: '🌿 Git 全能版本控制',
    file: 'TOOL_GIT_MANAGER.js',
    requiresAi: false
  },
  {
    name: '🧹 Git 历史提交重写',
    file: 'TOOL_FIX_GIT_HISTORY.js',
    requiresAi: false
  },
  {
    name: '🌐 打开 GitHub 仓库',
    file: 'TOOL_OPEN_GITHUB_REPO.js',
    requiresAi: false
  },
  {
    name: '🧪 运行全部单元测试',
    file: 'TOOL_RUN_ALL_TESTS.js',
    requiresAi: false
  },
  {
    name: '📊 代码量与行数统计',
    file: 'TOOL_COUNT_CODE_LINES.js',
    requiresAi: false
  },
  {
    name: '🔄 深度重装全部依赖',
    file: 'TOOL_REINSTALL_DEPENDENCIES.js',
    requiresAi: false
  },
  {
    name: '⚙️  AI 接口参数配置',
    file: 'TOOL_API_CONFIG.js',
    requiresAi: false
  },
  {
    name: '🚪 退出工具箱总控台',
    file: '',
    isExit: true
  }
];

const TOTAL_ITEMS = TOOLS_REGISTRY.length;

/**
 * 跨平台终端清屏函数
 */
function clearScreen() {
  try {
    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J');
    console.clear?.();
  } catch {}
}

/**
 * 异步执行 Git 命令并返回输出文本 (不阻塞主线程)
 */
function gitAsync(args) {
  return new Promise((resolve) => {
    try {
      const child = spawn('git', args, {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString('utf-8');
      });
      child.on('close', (code) => {
        resolve(code === 0 ? out.trim() : '');
      });
      child.on('error', () => {
        resolve('');
      });
    } catch {
      resolve('');
    }
  });
}

// ----------------- 异步状态缓存与定时轮询机制 -----------------
let cachedStatus = {
  branch: 'main',
  userName: 'developer',
  userEmail: 'dev@quickpatrol.local',
  summaryText: '⏳ 正在检测 Git 状态...',
  hasChanges: false,
  timeText: ''
};

let isFetchingStatus = false;
let isMenuActive = false;
let currentCursorIndex = 0;

/**
 * 格式化相对时间 (如: 3 分钟前)
 */
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function formatFullDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 异步拉取 Git 状态并更新缓存
 */
async function refreshGitStatusAsync() {
  if (isFetchingStatus) return false;
  isFetchingStatus = true;

  try {
    const [branch, userName, userEmail, statusShort] = await Promise.all([
      gitAsync(['branch', '--show-current']).then((b) => b || 'main'),
      gitAsync(['config', 'user.name']).then((u) => u || 'developer'),
      gitAsync(['config', 'user.email']).then((e) => e || 'dev@quickpatrol.local'),
      gitAsync(['status', '-s'])
    ]);

    const newStatus = {
      branch,
      userName,
      userEmail,
      summaryText: '',
      hasChanges: false,
      timeText: ''
    };

    if (!statusShort) {
      newStatus.summaryText = '\x1b[1m\x1b[32m🟢 工作区干净，所有修改已提交同步\x1b[0m';
      newStatus.hasChanges = false;
    } else {
      const lines = statusShort.split('\n').filter(Boolean);
      newStatus.hasChanges = true;

      let earliestTime = null;
      lines.forEach((line) => {
        const filePath = line.substring(3).trim();
        const fullPath = path.join(PROJECT_ROOT, filePath);
        try {
          if (fs.existsSync(fullPath)) {
            const stat = fs.statSync(fullPath);
            if (!earliestTime || stat.mtime < earliestTime) {
              earliestTime = stat.mtime;
            }
          }
        } catch {}
      });

      let timeDesc = '';
      if (earliestTime) {
        timeDesc = `${formatTimeAgo(earliestTime)}`;
      }

      newStatus.summaryText = `\x1b[1m\x1b[33m⚠️ 有 ${lines.length} 个未提交修改文件\x1b[0m`;
      newStatus.timeText = timeDesc;
    }

    cachedStatus = newStatus;
    return true;
  } catch {
    return false;
  } finally {
    isFetchingStatus = false;
  }
}

/**
 * 启动后台每隔 3 秒自动轮询 Git 状态的定时器
 */
function startStatusPoller() {
  refreshGitStatusAsync().then(() => {
    if (isMenuActive) {
      printMenu(currentCursorIndex);
    }
  });

  setInterval(async () => {
    if (!isMenuActive) return;
    const ok = await refreshGitStatusAsync();
    if (ok && isMenuActive) {
      printMenu(currentCursorIndex);
    }
  }, 3000);
}

readline.emitKeypressEvents(process.stdin);

/**
 * 监听用户键盘按键（双重监听 keypress + data，零延迟即时捕获上下左右按键）
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
 * 运行选定的子工具脚本并透传 stdio (子进程运行期间彻底释放父进程 stdin)
 */
async function runTool(tool) {
  isMenuActive = false;
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
      stdio: 'inherit'
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
        await getKeyPress('\n👉 按 [回车] 返回主菜单...');
      }

      isMenuActive = true;
      await refreshGitStatusAsync();
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
      await getKeyPress('\n👉 按 [回车] 返回主菜单...');
      isMenuActive = true;
      await refreshGitStatusAsync();
      resolve();
    });
  });
}

/**
 * 弹窗提示未配置 AI 时的引导对话框
 */
async function promptAiDisabledDialog(toolName) {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t⚠️  AI 接口未配置 (AI Features Disabled)');
  console.log('+========================================================================+');
  console.log(`|\t您所选的功能【\x1b[1m\x1b[36m${toolName}\x1b[0m】需要调用 AI 大模型接口。`);
  console.log('|\t由于当前尚未配置 AI API Key，全部 AI 相关功能已处于禁用保护状态。');
  console.log('+------------------------------------------------------------------------+\n');

  const options = [
    { id: 'config', label: '⚙️  立即前往 [AI 接口参数配置] 设置 API Key 并启用全部 AI 功能' },
    { id: 'back', label: '🚪 返回总控控制台' }
  ];
  let cursor = 0;

  while (true) {
    clearScreen();
    console.log('+========================================================================+');
    console.log('|\t⚠️  AI 接口未配置 (AI Features Disabled)');
    console.log('+========================================================================+');
    console.log(`|\t您所选的功能【\x1b[1m\x1b[36m${toolName}\x1b[0m】需要调用 AI 大模型接口。`);
    console.log('|\t由于当前尚未配置 AI API Key，全部 AI 相关功能已处于禁用保护状态。');
    console.log('+------------------------------------------------------------------------+\n');

    options.forEach((opt, idx) => {
      const isFocused = idx === cursor;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        console.log(`${pointer}\x1b[1m\x1b[32m${opt.label}\x1b[0m`);
      } else {
        console.log(`${pointer}\x1b[37m${opt.label}\x1b[0m`);
      }
    });

    console.log('\n+------------------------------------------------------------------------+');
    console.log('操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认] [\x1b[31mESC\x1b[0m 返回]');

    const key = await getKeyPress();
    if (key === 'ESC' || (key === 'ENTER' && options[cursor].id === 'back')) {
      return;
    }
    if (key === 'UP' || key === 'DOWN') {
      cursor = 1 - cursor;
      continue;
    }
    if (key === 'ENTER' && options[cursor].id === 'config') {
      const configTool = TOOLS_REGISTRY.find(t => t.file === 'TOOL_API_CONFIG.js');
      if (configTool) {
        await runTool(configTool);
      }
      return;
    }
  }
}

/**
 * 清除 ANSI 颜色控制字符与 Unicode 变体选择符
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 精准计算单个 Unicode 字符在终端上的视觉列宽 (遵循标准 POSIX wcwidth 规范)
 */
function getCharWidth(code) {
  // 控制字符
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;
  
  // 零宽度修饰符 (Emoji Variation Selectors U+FE00~U+FE0F)
  if (code >= 0xfe00 && code <= 0xfe0f) return 0;
  
  // ASCII 可见字符 (0x20 空格 到 0x7E ~)
  if (code >= 0x20 && code <= 0x7e) return 1;

  // 制表框线与方块符号 (U+2500 ~ U+259F，如 ┌ ─ ┐ │ └ ┘) -> 终端中严格占 1 列宽度
  if (code >= 0x2500 && code <= 0x259f) return 1;

  // 导航箭头符号 (U+2190 ~ U+21FF，如 ← ↑ → ↓) -> 终端中严格占 1 列宽度
  if (code >= 0x2190 && code <= 0x21ff) return 1;

  // 几何图形与杂项符号 (★, ❖ 等占 1 列，双宽符号与 emoji 占 2 列)
  if (
    code === 0x2699 || // ⚙
    code === 0x26a0 || // ⚠️
    code === 0x2705 || // ✅
    code === 0x274c || // ❌
    code === 0x2728 || // ✨
    code === 0x269b || // ⚛
    code === 0x1f512   // 🔒
  ) {
    return 2;
  }
  if (code >= 0x25a0 && code <= 0x27bf) return 1;

  // CJK 汉字、全角标点符号与朝鲜语谚文 -> 严格占 2 列宽度
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2;
  }

  // 现代 Emoji (Supplementary Planes 0x1F000 以上) -> 严格占 2 列宽度
  if (code >= 0x1f000 && code <= 0x1f9ff) return 2;
  if (code >= 0x20000 && code <= 0x3ffff) return 2;

  return 1;
}

/**
 * 计算字符串的真实终端视觉列宽
 */
function getVisualWidth(str) {
  const clean = stripAnsi(str);
  let w = 0;
  for (const char of clean) {
    w += getCharWidth(char.codePointAt(0));
  }
  return w;
}

/**
 * 视觉对齐填充函数：保证最终渲染的视觉总宽度严格等于 targetWidth
 */
function padVisual(str, targetWidth) {
  const currentWidth = getVisualWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * 渲染单行居中对齐框 (绝对防溢出与换行错位，总宽度严格等于 innerWidth + 4)
 */
function renderBoxRow(leftPad, content, innerWidth, borderColor = '\x1b[90m') {
  const padded = padVisual(content, innerWidth);
  return leftPad + borderColor + '│\x1b[0m ' + padded + ' ' + borderColor + '│\x1b[0m\n';
}

/**
 * 根据当前终端尺寸动态计算排版参数
 */
function calculateGridLayout() {
  const termWidth = Math.max(40, process.stdout.columns || 90);
  const termHeight = process.stdout.rows || 24;

  const isNarrow = termWidth < 70;

  if (isNarrow) {
    // 窄屏极简列表模式 (单列轻量单行显示)
    const panelWidth = Math.max(34, Math.min(46, termWidth - 4));
    const leftOffset = Math.max(0, Math.floor((termWidth - panelWidth) / 2));
    const leftPad = ' '.repeat(leftOffset);
    const totalContentLines = 5 + TOTAL_ITEMS + 3; // 顶栏(5)+项目(12)+底栏(3)
    const topPadLines = Math.max(0, Math.floor((termHeight - totalContentLines) / 2));

    return {
      isNarrow: true,
      termWidth,
      termHeight,
      cols: 1,
      rows: TOTAL_ITEMS,
      gap: 0,
      cardInnerWidth: panelWidth - 4,
      cardOuterWidth: panelWidth,
      panelWidth,
      leftPad,
      topPadLines
    };
  }

  // 宽屏多列网格卡片模式 (2列/3列/4列)
  const cols = termWidth >= 140 ? 4 : termWidth >= 98 ? 3 : 2;
  const cardInnerWidth = cols === 2 ? 28 : 24;
  const gap = cols === 2 ? 3 : 2;
  const cardOuterWidth = cardInnerWidth + 2;
  const rows = Math.ceil(TOTAL_ITEMS / cols);

  const panelWidth = cols * cardOuterWidth + (cols - 1) * gap;
  const leftOffset = Math.max(0, Math.floor((termWidth - panelWidth) / 2));
  const leftPad = ' '.repeat(leftOffset);

  const totalContentLines = 3 + 1 + (rows * 3) + 1 + 3;
  const topPadLines = Math.max(0, Math.floor((termHeight - totalContentLines) / 2));

  return {
    isNarrow: false,
    termWidth,
    termHeight,
    cols,
    rows,
    gap,
    cardInnerWidth,
    cardOuterWidth,
    panelWidth,
    leftPad,
    topPadLines
  };
}

/**
 * 渲染主菜单面板 (窄屏单行列表 / 宽屏网格双模自适应 + AI 禁用状态感知)
 */
function printMenu(cursorIndex = 0) {
  const status = cachedStatus;
  const layout = calculateGridLayout();
  const { isNarrow, cols, rows, gap, cardInnerWidth, cardOuterWidth, panelWidth, leftPad, topPadLines } = layout;

  const aiAvailable = hasValidAiKey();
  const boxInnerWidth = panelWidth - 4; // 框内可用宽度 (左右留 1 个空格内边距)

  let out = '';

  // 1. 垂直居中顶部填充空行
  if (topPadLines > 0) {
    out += '\n'.repeat(topPadLines);
  }

  if (isNarrow) {
    // ----------------- 【极窄模式】精炼竖向多行信息框 + 纯单行上下列表 -----------------
    out += leftPad + `┌${'─'.repeat(panelWidth - 2)}┐\n`;
    out += renderBoxRow(leftPad, ' 🛠️  高校后勤巡查e速办 v4.0 研发运维总控台', boxInnerWidth);
    out += renderBoxRow(leftPad, ` 🌿 分支: \x1b[1m\x1b[36m${status.branch}\x1b[0m`, boxInnerWidth);
    const aiTag = aiAvailable ? '\x1b[32m✔ 已就绪\x1b[0m' : '\x1b[33m⚠️ 未配置(已禁用)\x1b[0m';
    out += renderBoxRow(leftPad, ` 🤖 AI状态: ${aiTag}`, boxInnerWidth);
    out += renderBoxRow(leftPad, ` 📊 工作区: ${status.summaryText}`, boxInnerWidth);
    out += leftPad + `└${'─'.repeat(panelWidth - 2)}┘\n\n`;

    // 纯单行菜单项目列表 (无厚重框线，轻快直观)
    for (let idx = 0; idx < TOTAL_ITEMS; idx++) {
      const tool = TOOLS_REGISTRY[idx];
      const isFocused = idx === cursorIndex;
      const isDisabled = tool.requiresAi && !aiAvailable;

      let displayName = tool.name;
      if (isDisabled) {
        displayName = `${tool.name} \x1b[90m[未配置AI]\x1b[0m`;
      }

      if (isFocused) {
        if (tool.isExit) {
          out += leftPad + `\x1b[1m\x1b[31m 👉 ${displayName}\x1b[0m\n`;
        } else if (isDisabled) {
          out += leftPad + `\x1b[1m\x1b[33m 👉 🔒 ${displayName}\x1b[0m\n`;
        } else {
          out += leftPad + `\x1b[1m\x1b[36m 👉 ${displayName}\x1b[0m\n`;
        }
      } else {
        if (isDisabled) {
          out += leftPad + `    \x1b[90m🔒 ${displayName}\x1b[0m\n`;
        } else {
          const color = tool.isExit ? '\x1b[90m' : '\x1b[37m';
          out += leftPad + `    ${color}${displayName}\x1b[0m\n`;
        }
      }
    }

    // 窄屏底部简明操作提示
    out += '\n' + leftPad + `┌${'─'.repeat(panelWidth - 2)}┐\n`;
    out += renderBoxRow(leftPad, ' [↑/↓ 移动] [回车 进入] [ESC 退出]', boxInnerWidth);
    out += leftPad + `└${'─'.repeat(panelWidth - 2)}┘\n`;
  } else {
    // ----------------- 【宽屏模式】GRID 现代卡片网格布局 -----------------
    out += leftPad + `┌${'─'.repeat(panelWidth - 2)}┐\n`;

    const branchBadge = (status.branch === 'main' || status.branch === 'master') ? ' \x1b[32m★(主分支)\x1b[0m' : '';
    const aiTag = aiAvailable ? '\x1b[32m[AI 就绪]\x1b[0m' : '\x1b[33m[AI 未配置]\x1b[0m';
    
    let h1 = ` 🛠️  高校后勤巡查e速办 v4.0 研发运维总控台  │  🌿 分支: \x1b[1m\x1b[36m${status.branch}\x1b[0m${branchBadge}  │  ${aiTag}  │  👤 \x1b[1m\x1b[32m${status.userName}\x1b[0m <\x1b[36m${status.userEmail}\x1b[0m>`;
    if (getVisualWidth(h1) > boxInnerWidth) {
      h1 = ` 🛠️  高校后勤巡查e速办 v4.0 研发运维总控台  │  🌿 \x1b[1m\x1b[36m${status.branch}\x1b[0m${branchBadge}  │  ${aiTag}  │  👤 \x1b[1m\x1b[32m${status.userName}\x1b[0m`;
    }
    if (getVisualWidth(h1) > boxInnerWidth) {
      h1 = ` 🛠️  高校后勤巡查e速办 v4.0 总控台  │  🌿 \x1b[1m\x1b[36m${status.branch}\x1b[0m  │  ${aiTag}  │  👤 \x1b[1m\x1b[32m${status.userName}\x1b[0m`;
    }
    if (getVisualWidth(h1) > boxInnerWidth) {
      h1 = ` 🛠️  高校后勤巡查e速办  │  🌿 \x1b[1m\x1b[36m${status.branch}\x1b[0m  │  👤 \x1b[1m\x1b[32m${status.userName}\x1b[0m`;
    }
    out += renderBoxRow(leftPad, h1, boxInnerWidth);

    let timeSnippet = (status.hasChanges && status.timeText) ? ` \x1b[90m(${status.timeText})\x1b[0m` : '';
    let h2 = ` 📊 工作区状态: ${status.summaryText}${timeSnippet}`;
    if (getVisualWidth(h2) > boxInnerWidth) {
      h2 = ` 📊 工作区状态: ${status.summaryText}`;
    }
    out += renderBoxRow(leftPad, h2, boxInnerWidth);
    out += leftPad + `└${'─'.repeat(panelWidth - 2)}┘\n\n`;

    // 卡片网格动态渲染
    for (let r = 0; r < rows; r++) {
      let topRow = leftPad;
      let midRow = leftPad;
      let botRow = leftPad;

      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const colGap = c < cols - 1 ? ' '.repeat(gap) : '';

        if (idx >= TOTAL_ITEMS) {
          topRow += ' '.repeat(cardOuterWidth) + colGap;
          midRow += ' '.repeat(cardOuterWidth) + colGap;
          botRow += ' '.repeat(cardOuterWidth) + colGap;
          continue;
        }

        const tool = TOOLS_REGISTRY[idx];
        const isFocused = idx === cursorIndex;
        const isDisabled = tool.requiresAi && !aiAvailable;

        let displayTitle = tool.name;
        if (isDisabled) {
          displayTitle = `🔒 ${tool.name}`;
        }

        if (isFocused) {
          const titleStr = padVisual(` 👉 ${displayTitle}`, cardInnerWidth);
          if (tool.isExit) {
            topRow += `\x1b[1m\x1b[31m┌${'─'.repeat(cardInnerWidth)}┐\x1b[0m${colGap}`;
            midRow += `\x1b[1m\x1b[31m│${titleStr}│\x1b[0m${colGap}`;
            botRow += `\x1b[1m\x1b[31m└${'─'.repeat(cardInnerWidth)}┘\x1b[0m${colGap}`;
          } else if (isDisabled) {
            topRow += `\x1b[1m\x1b[33m┌${'─'.repeat(cardInnerWidth)}┐\x1b[0m${colGap}`;
            midRow += `\x1b[1m\x1b[33m│${titleStr}│\x1b[0m${colGap}`;
            botRow += `\x1b[1m\x1b[33m└${'─'.repeat(cardInnerWidth)}┘\x1b[0m${colGap}`;
          } else {
            topRow += `\x1b[1m\x1b[36m┌${'─'.repeat(cardInnerWidth)}┐\x1b[0m${colGap}`;
            midRow += `\x1b[1m\x1b[36m│${titleStr}│\x1b[0m${colGap}`;
            botRow += `\x1b[1m\x1b[36m└${'─'.repeat(cardInnerWidth)}┘\x1b[0m${colGap}`;
          }
        } else {
          const titleStr = padVisual(`    ${displayTitle}`, cardInnerWidth);
          const borderCol = '\x1b[90m';
          const textCol = isDisabled ? '\x1b[90m' : tool.isExit ? '\x1b[90m' : '\x1b[37m';
          topRow += `${borderCol}┌${'─'.repeat(cardInnerWidth)}┐\x1b[0m${colGap}`;
          midRow += `${borderCol}│\x1b[0m${textCol}${titleStr}\x1b[0m${borderCol}│\x1b[0m${colGap}`;
          botRow += `${borderCol}└${'─'.repeat(cardInnerWidth)}┘\x1b[0m${colGap}`;
        }
      }

      out += topRow + '\n';
      out += midRow + '\n';
      out += botRow + '\n';
    }

    // 宽屏底部操作指引框
    let footer = ' 操作说明: [\x1b[36m↑/↓/←/→\x1b[0m 或 \x1b[36mW/A/S/D\x1b[0m 网格导航] [\x1b[32m回车\x1b[0m 确认进入] [\x1b[31mESC\x1b[0m 退出]';
    if (getVisualWidth(footer) > boxInnerWidth) {
      footer = ' 操作说明: [\x1b[36m↑/↓/←/→\x1b[0m 导航] [\x1b[32m回车\x1b[0m 确认] [\x1b[31mESC\x1b[0m 退出]';
    }
    if (getVisualWidth(footer) > boxInnerWidth) {
      footer = ' [\x1b[36m↑/↓/←/→\x1b[0m 导航] [\x1b[32m回车\x1b[0m 确认] [\x1b[31mESC\x1b[0m 退出]';
    }

    out += '\n' + leftPad + `┌${'─'.repeat(panelWidth - 2)}┐\n`;
    out += renderBoxRow(leftPad, footer, boxInnerWidth);
    out += leftPad + `└${'─'.repeat(panelWidth - 2)}┘\n`;
  }

  process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
}

/**
 * 启动时检查初始化状态与依赖完整性
 */
function ensureProjectInitialized() {
  if (!isProjectInitialized()) {
    console.log('\n+========================================================================+');
    console.log('|\t⚠️  检测到项目尚未完成初始化配置 (chat_sys_config.json 不存在)！');
    console.log('|\t👉 正在自动为您启动 3 步初始化向导 (AI 参数支持自由跳过)...');
    console.log('+========================================================================+\n');

    const initScript = path.join(__dirname, 'TOOL_INITIALIZE_PROJECT.js');
    const child = spawnSync(process.execPath, [initScript], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    if (child.status !== 0 || !isProjectInitialized()) {
      console.log('\n❌ 项目未完成初始化，控制台已退出。\n');
      process.exit(1);
    }
  }

  const depErr = getDependencyInstallError();
  if (depErr) {
    console.log('\n+========================================================================+');
    console.log('|\t⚠️  检测到上次项目依赖安装存在失败记录！');
    console.log(`|\t📦 失败模块: ${depErr.failed_module || '未知'} (记录于: ${depErr.timestamp ? depErr.timestamp.substring(0, 19).replace('T', ' ') : ''})`);
    console.log('|\t⏳ 正在自动为您继续修复并安装全量子项目依赖...');
    console.log('+========================================================================+\n');

    const initScript = path.join(__dirname, 'TOOL_INITIALIZE_PROJECT.js');
    const child = spawnSync(process.execPath, [initScript, '--install-deps-only'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });

    if (child.status !== 0 || getDependencyInstallError()) {
      console.log('\n❌ 依赖自动安装未成功，请检查网络或 Node.js 环境后重试。\n');
      process.exit(1);
    }
    console.log('\n✔ 全量子项目依赖自动修复成功，正在进入控制台...\n');
  }
}

/**
 * 主循环 (响应式 4 向按键 + 回车交互 + 窗口缩放动态监听 + AI 禁用保护拦截)
 */
async function main() {
  ensureProjectInitialized();

  currentCursorIndex = 0;
  isMenuActive = true;
  startStatusPoller();

  // 监听终端窗口尺寸改变事件 (Resize Event)，自适应重绘
  process.stdout.on('resize', () => {
    if (isMenuActive) {
      printMenu(currentCursorIndex);
    }
  });

  printMenu(currentCursorIndex);

  while (true) {
    const key = await getKeyPress();
    const layout = calculateGridLayout();
    const isNarrow = layout.isNarrow;
    const cols = layout.cols;
    const rows = layout.rows;

    if (key === 'ESC') {
      isMenuActive = false;
      clearScreen();
      console.log('\n👋 感谢使用高校后勤巡查e速办工具箱，已安全退出！\n');
      process.exit(0);
    }

    if (key === 'UP') {
      if (isNarrow) {
        currentCursorIndex = (currentCursorIndex - 1 + TOTAL_ITEMS) % TOTAL_ITEMS;
      } else {
        const targetIdx = currentCursorIndex - cols;
        if (targetIdx >= 0) {
          currentCursorIndex = targetIdx;
        } else {
          const colPos = currentCursorIndex % cols;
          const lastRowCandidate = (rows - 1) * cols + colPos;
          currentCursorIndex = lastRowCandidate < TOTAL_ITEMS ? lastRowCandidate : lastRowCandidate - cols;
        }
      }
      printMenu(currentCursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      if (isNarrow) {
        currentCursorIndex = (currentCursorIndex + 1) % TOTAL_ITEMS;
      } else {
        const targetIdx = currentCursorIndex + cols;
        if (targetIdx < TOTAL_ITEMS) {
          currentCursorIndex = targetIdx;
        } else {
          currentCursorIndex = currentCursorIndex % cols;
        }
      }
      printMenu(currentCursorIndex);
      continue;
    }

    if (key === 'LEFT') {
      if (isNarrow) {
        currentCursorIndex = (currentCursorIndex - 1 + TOTAL_ITEMS) % TOTAL_ITEMS;
      } else {
        if (currentCursorIndex % cols === 0) {
          const rowStart = currentCursorIndex;
          const rowEndCandidate = Math.min(TOTAL_ITEMS - 1, rowStart + cols - 1);
          currentCursorIndex = rowEndCandidate;
        } else {
          currentCursorIndex = currentCursorIndex - 1;
        }
      }
      printMenu(currentCursorIndex);
      continue;
    }

    if (key === 'RIGHT') {
      if (isNarrow) {
        currentCursorIndex = (currentCursorIndex + 1) % TOTAL_ITEMS;
      } else {
        if (currentCursorIndex % cols === cols - 1 || currentCursorIndex === TOTAL_ITEMS - 1) {
          const rowStart = currentCursorIndex - (currentCursorIndex % cols);
          currentCursorIndex = rowStart;
        } else {
          currentCursorIndex = currentCursorIndex + 1;
        }
      }
      printMenu(currentCursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = TOOLS_REGISTRY[currentCursorIndex];
      if (selected.isExit) {
        isMenuActive = false;
        clearScreen();
        console.log('\n👋 感谢使用高校后勤巡查e速办工具箱，已安全退出！\n');
        process.exit(0);
      }

      // 如果选中的是 AI 功能且未配置 API Key，触发友好引导弹窗
      if (selected.requiresAi && !hasValidAiKey()) {
        await promptAiDisabledDialog(selected.name);
        isMenuActive = true;
        printMenu(currentCursorIndex);
        continue;
      }

      if (selected.file) {
        await runTool(selected);
        printMenu(currentCursorIndex);
      }
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ 发生未捕获异常:', err);
  process.exit(1);
});
