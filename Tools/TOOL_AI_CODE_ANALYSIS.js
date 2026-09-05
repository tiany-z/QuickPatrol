/**
 * TOOL_AI_CODE_ANALYSIS.js
 * 
 * AI 代码与架构智能体深度解析控制台 (AI Code Agent Web Studio)
 * 
 * 核心升级与特性：
 *   1. 【Web 端沉浸式多轮连续问答】
 *      - 启动常驻本地 HTTP + SSE 服务并自动唤起浏览器；
 *      - 用户可在浏览器界面中针对项目代码进行多轮连续提问、深入追问与架构探索；
 *      - 多轮上下文智能管理：保留问答语义记忆，并在每轮提问中开启独立的本地工具检索闭环；
 *   2. 【真实 ReAct 智能体引擎】
 *      - 彻底废除旧版“全量读取 + 粗暴截断首尾拼接”的幼稚做法；
 *      - 接入 code_agent_engine.js，基于 OpenAI / DeepSeek 标准 Function Calling 协议；
 *      - 赋予 Agent 四大代码探查工具：list_directory, get_outline, view_file, grep_search；
 *   3. 【终端 + 浏览器双栏双流式呈现】：
 *      - 网页端左侧展示 Agent 实时思维与工具调用轨迹时间线 (Action Timeline)；
 *      - 网页端中央展示多轮交互气泡、代码高亮渲染、一键复制与 Markdown 导出；
 *      - 终端实时同步打印用户提问与智能体探索日志，按 [ESC] 或 [q] 随时停止服务返回主控台；
 *   4. 【三模无缝统一】：
 *      - 模式一：指定项目目录/模块进行深度架构剖析（进入 Web 后可继续追问）
 *      - 模式二：终端交互式树状目录导航点选
 *      - 模式三：自由提问驱动探索（Web 连续问答工作台模式）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { getAiConfig, hasValidAiKey, tryAutoOpenBrowser } from './config_helper.js';
import { runCodeReadingAgent, IGNORED_DIRS, IGNORED_EXTENSIONS } from './code_agent_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.resolve(PROJECT_ROOT, 'Docs');

/**
 * 获取局域网/本机可访问 IPv4
 */
function getLocalNetworkIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          const ip = iface.address;
          if (ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
            return ip;
          }
        }
      }
    }
  } catch {}
  return '127.0.0.1';
}

/**
 * 终端清屏
 */
function clearScreen() {
  try {
    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J');
    console.clear?.();
  } catch {}
}

readline.emitKeypressEvents(process.stdin);

/**
 * 监听键盘按键
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
        if (str === '\r' || str === '\n') return cleanupAndResolve('ENTER');
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
 * 文本行输入问答
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
 * 端口可用性探测
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(startPort = 3456) {
  let port = startPort;
  while (port < startPort + 100) {
    const ok = await isPortAvailable(port);
    if (ok) return port;
    port++;
  }
  return 0;
}

/**
 * 剪贴板复制
 */
function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      const child = spawnSync('clip', { input: text, encoding: 'utf-8' });
      if (child.status === 0) return true;
      const psChild = spawnSync('powershell', ['-NoProfile', '-Command', '$input | Set-Clipboard'], {
        input: text,
        encoding: 'utf-8'
      });
      return psChild.status === 0;
    } else if (process.platform === 'darwin') {
      const child = spawnSync('pbcopy', { input: text, encoding: 'utf-8' });
      return child.status === 0;
    } else {
      const child = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf-8' });
      return child.status === 0;
    }
  } catch {
    return false;
  }
}

/**
 * 保存分析报告为 Markdown 文件
 */
function saveAnalysisReportFile(reportContent, defaultFileName) {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
  const targetPath = path.join(DOCS_DIR, defaultFileName);
  fs.writeFileSync(targetPath, reportContent, 'utf-8');
  return targetPath;
}

/**
 * 生成具备多轮连续问答 (Web Chat Studio) 功能的现代化网页 HTML
 */
function getWebChatStudioHtml(initialQuery = '', initialTarget = '.') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>高校后勤巡查e速办 v4.0 Code Agent Studio - 代码智能体连续问答工作台</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <link id="hljs-theme" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
  <style>
    /* 暗色主题（默认） */
    :root, [data-theme="dark"] {
      --bg-color: #0b0f17;
      --card-bg: #131924;
      --panel-bg: #18202e;
      --border-color: #243144;
      --border-focus: #388bfd;
      --text-main: #e2e8f0;
      --text-muted: #94a3b8;
      --text-heading: #ffffff;
      --accent-blue: #388bfd;
      --accent-cyan: #22d3ee;
      --accent-purple: #a855f7;
      --accent-green: #22c55e;
      --accent-orange: #f59e0b;
      --accent-red: #ef4444;
      --bubble-user-bg: #1e3a8a;
      --bubble-user-border: #2563eb;
      --bubble-user-text: #f8fafc;
      --code-bg: #06090e;
      --shadow-color: rgba(0, 0, 0, 0.5);
      --timeline-line: #1e2b3c;
      --input-dock-bg: rgba(19, 25, 36, 0.92);
      --sidebar-footer-bg: #0e141f;
      --welcome-bg: linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%);
    }

    /* 浅色主题 */
    [data-theme="light"] {
      --bg-color: #f8fafc;
      --card-bg: #ffffff;
      --panel-bg: #f1f5f9;
      --border-color: #e2e8f0;
      --border-focus: #2563eb;
      --text-main: #1e293b;
      --text-muted: #64748b;
      --text-heading: #0f172a;
      --accent-blue: #2563eb;
      --accent-cyan: #0284c7;
      --accent-purple: #9333ea;
      --accent-green: #16a34a;
      --accent-orange: #d97706;
      --accent-red: #dc2626;
      --bubble-user-bg: #2563eb;
      --bubble-user-border: #1d4ed8;
      --bubble-user-text: #ffffff;
      --code-bg: #f8fafc;
      --shadow-color: rgba(0, 0, 0, 0.08);
      --timeline-line: #e2e8f0;
      --input-dock-bg: rgba(255, 255, 255, 0.94);
      --sidebar-footer-bg: #f8fafc;
      --welcome-bg: linear-gradient(135deg, #eff6ff 0%, #f1f5f9 100%);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: background-color 0.25s ease, color 0.25s ease;
    }

    /* 打字机光标动画 */
    .typewriter-cursor {
      display: inline-block;
      width: 7px;
      height: 15px;
      background: var(--accent-blue);
      vertical-align: middle;
      margin-left: 4px;
      border-radius: 1px;
      animation: blinkCursor 0.75s infinite;
    }
    @keyframes blinkCursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

    /* 顶部导航条 */
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      z-index: 100;
      transition: background-color 0.25s ease, border-color 0.25s ease;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .app-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-heading);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .model-badge {
      font-size: 12px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      padding: 3px 10px;
      border-radius: 20px;
      color: var(--accent-cyan);
      font-family: monospace;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
      background: var(--panel-bg);
      padding: 5px 12px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 8px var(--accent-green);
    }
    .dot.busy {
      background: var(--accent-orange);
      box-shadow: 0 0 8px var(--accent-orange);
      animation: blink 1.2s infinite;
    }
    @keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

    .btn {
      background: var(--panel-bg);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn:hover { background: var(--panel-bg); border-color: var(--accent-blue); filter: brightness(1.08); }
    .btn.primary, .btn-primary { background: var(--accent-blue) !important; color: #fff !important; border-color: var(--accent-blue) !important; }
    .btn.primary:hover, .btn-primary:hover { background: #2563eb !important; }

    /* 主体布局：左侧轨迹，右侧对话流 */
    .app-container {
      flex: 1;
      display: grid;
      grid-template-columns: 380px 1fr;
      overflow: hidden;
      position: relative;
    }
    @media (max-width: 900px) {
      .app-container { grid-template-columns: 1fr; }
      .sidebar { display: none; }
    }

    /* 左侧边栏：Agent 探索轨迹 */
    .sidebar {
      background: var(--card-bg);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-heading);
    }
    .step-tag {
      font-size: 11px;
      background: var(--panel-bg);
      padding: 2px 8px;
      border-radius: 12px;
      color: var(--accent-blue);
      border: 1px solid var(--border-color);
    }
    .timeline-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .timeline-scroll::-webkit-scrollbar { width: 5px; }
    .timeline-scroll::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }

    .timeline-item {
      position: relative;
      padding-left: 18px;
      margin-bottom: 14px;
    }
    .timeline-item::before {
      content: '';
      position: absolute;
      left: 3px;
      top: 6px;
      bottom: -14px;
      width: 2px;
      background: var(--timeline-line);
    }
    .timeline-item:last-child::before { display: none; }
    .t-dot {
      position: absolute;
      left: 0;
      top: 6px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-blue);
    }
    .t-dot.thought { background: var(--accent-purple); }
    .t-dot.tool { background: var(--accent-orange); }
    .t-dot.done { background: var(--accent-green); }

    .t-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-heading);
      margin-bottom: 4px;
    }
    .t-body {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--panel-bg);
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      line-height: 1.5;
      word-break: break-all;
    }

    /* 右侧主聊天工作区 */
    .chat-main {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: var(--bg-color);
      transition: background-color 0.25s ease;
    }
    .messages-viewport {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px 140px 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .messages-viewport::-webkit-scrollbar { width: 6px; }
    .messages-viewport::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }

    /* 欢迎 Banner */
    .welcome-card {
      background: var(--welcome-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: var(--shadow-color);
      transition: background 0.25s ease, border-color 0.25s ease;
    }
    .welcome-card h2 { font-size: 18px; color: var(--text-heading); display: flex; align-items: center; gap: 8px; }
    .welcome-card p { font-size: 13px; color: var(--text-muted); line-height: 1.6; }

    /* 消息气泡 */
    .message-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .message-row.user {
      align-items: flex-end;
    }
    .message-row.user .bubble {
      background: var(--bubble-user-bg);
      border: 1px solid var(--bubble-user-border);
      color: var(--bubble-user-text);
      padding: 12px 18px;
      border-radius: 14px 14px 2px 14px;
      max-width: 80%;
      font-size: 14px;
      line-height: 1.5;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .message-row.agent {
      align-items: flex-start;
      width: 100%;
    }
    .agent-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      width: 100%;
      box-shadow: var(--shadow-color);
      display: flex;
      flex-direction: column;
      gap: 16px;
      transition: background-color 0.25s ease, border-color 0.25s ease;
    }
    .agent-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 12px;
    }
    .agent-tag {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-heading);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tools-pill {
      font-size: 11px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      padding: 3px 8px;
      border-radius: 12px;
      color: var(--accent-orange);
    }
    .agent-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* Markdown 渲染美化 */
    .markdown-body {
      font-size: 14px;
      color: var(--text-main);
      line-height: 1.7;
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 {
      color: var(--text-heading);
      margin: 20px 0 10px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border-color);
    }
    .markdown-body pre {
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      overflow-x: auto;
      margin: 14px 0;
      position: relative;
    }
    .markdown-body code {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12.5px;
    }
    .markdown-body :not(pre) > code {
      background: var(--panel-bg);
      color: var(--accent-blue);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      border: 1px solid var(--border-color);
    }
    .typing-skip-btn {
      font-size: 11px;
      background: var(--panel-bg);
      border: 1px solid var(--accent-blue);
      color: var(--accent-blue);
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .typing-skip-btn:hover {
      background: var(--accent-blue);
      color: #ffffff;
    }
    .markdown-body blockquote {
      border-left: 3px solid var(--accent-blue);
      padding: 6px 14px;
      background: var(--panel-bg);
      color: var(--text-muted);
      margin: 14px 0;
      border-radius: 0 6px 6px 0;
    }
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 13px;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--border-color);
      padding: 8px 12px;
    }
    .markdown-body th { background: var(--panel-bg); color: var(--text-heading); }

    /* 正在思考卡片 */
    .thinking-card {
      background: var(--card-bg);
      border: 1px dashed var(--accent-blue);
      border-radius: 12px;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: var(--shadow-color);
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--border-color);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .thinking-text {
      font-size: 13px;
      color: var(--accent-cyan);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    /* 底部悬浮输入 Dock */
    .input-dock {
      position: absolute;
      bottom: 20px;
      left: 32px;
      right: 32px;
      background: var(--input-dock-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 10px 14px;
      box-shadow: var(--shadow-color);
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.2s, background-color 0.25s ease;
    }
    .input-dock:focus-within {
      border-color: var(--border-focus);
      box-shadow: 0 10px 30px rgba(56, 139, 253, 0.2);
    }
    .input-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
    }
    .chat-textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-main);
      font-size: 14px;
      line-height: 1.5;
      resize: none;
      max-height: 160px;
      min-height: 24px;
      outline: none;
      font-family: inherit;
    }
    .chat-textarea::placeholder { color: var(--text-muted); }
    .dock-buttons {
      display: flex;
      gap: 8px;
    }
    .send-btn {
      background: linear-gradient(135deg, #2563eb 0%, #388bfd 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .send-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .send-btn:active { transform: translateY(0); }
    .send-btn.stop {
      background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
    }

    .input-hint {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      padding: 0 4px;
    }

    #toast {
      position: fixed;
      bottom: 90px;
      right: 32px;
      background: #15803d;
      color: #fff;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 9999;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s;
      pointer-events: none;
    }
    #toast.show { opacity: 1; transform: translateY(0); }

    /* 终端退出后的只读归档状态 */
    body.terminal-exited .app-container {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      flex: 1 !important;
      min-height: 0 !important;
      height: auto !important;
      overflow-y: auto !important;
      padding: 0 !important;
      grid-template-columns: none !important;
    }
    body.terminal-exited .app-container::-webkit-scrollbar {
      width: 7px;
    }
    body.terminal-exited .app-container::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    body.terminal-exited .sidebar {
      display: none !important;
    }
    body.terminal-exited .input-dock {
      display: none !important;
    }
    body.terminal-exited .header-op-btn,
    body.terminal-exited .server-op-btn {
      display: none !important;
    }
    body.terminal-exited .typing-skip-btn {
      display: none !important;
    }
    body.terminal-exited .chat-main {
      width: 100% !important;
      max-width: 960px !important;
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      padding: 24px 20px 60px 20px !important;
      box-sizing: border-box !important;
      margin: 0 auto !important;
    }
    body.terminal-exited .messages-viewport {
      width: 100% !important;
      max-width: 100% !important;
      overflow: visible !important;
      height: auto !important;
      padding: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 24px !important;
    }
    .terminal-exit-banner {
      display: none;
      background: rgba(234, 179, 8, 0.12);
      border: 1px solid rgba(234, 179, 8, 0.35);
      border-radius: 10px;
      padding: 14px 20px;
      margin-bottom: 24px;
      max-width: 960px;
      width: 100%;
      color: var(--text-main);
      box-shadow: 0 4px 14px var(--shadow-color);
      box-sizing: border-box;
    }
    body.terminal-exited .terminal-exit-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      animation: fadeIn 0.3s ease;
    }
    .exit-banner-left {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .exit-banner-icon {
      font-size: 24px;
      line-height: 1;
    }
    .exit-banner-title {
      font-size: 14px;
      font-weight: 700;
      color: #eab308;
      margin-bottom: 4px;
    }
    .exit-banner-desc {
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .exit-banner-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .exit-only-btn {
      display: none !important;
    }
    body.terminal-exited .exit-only-btn {
      display: inline-flex !important;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <div class="app-title">🤖 高校后勤巡查e速办 Code Agent Studio</div>
      <div class="model-badge">deepseek-v4-flash</div>
      <div style="font-size: 12px; color: var(--text-muted);">📂 ${PROJECT_ROOT}</div>
    </div>
    <div class="header-right">
      <div id="statusPill" class="status-pill">
        <div id="statusDot" class="dot"></div>
        <span id="statusLabel">智能体就绪</span>
      </div>
      <button id="themeToggleBtn" class="btn" onclick="toggleTheme()" title="切换明亮/暗黑主题">🌙 暗色模式</button>
      <button class="btn header-op-btn" onclick="clearAllChat()" title="清空全部对话历史">🗑️ 清空对话</button>
      <button class="btn exit-only-btn" onclick="copyAllChatMarkdown()" title="复制全部对话与报告 Markdown">📋 复制全部对白</button>
      <button class="btn btn-primary exit-only-btn" onclick="exportFullChatMarkdown()" title="将全部问答记录导出为完整 Markdown 文档">📥 导出全部对白 (.md)</button>
    </div>
  </header>

  <div class="app-container">
    <!-- 左侧：Agent 行动时间线 -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span>🤖 智能体探索轨迹</span>
        <span id="stepTag" class="step-tag">就绪</span>
      </div>
      <div id="timelineScroll" class="timeline-scroll">
        <div class="timeline-item">
          <div class="t-dot"></div>
          <div class="t-title">🚀 智能体就绪</div>
          <div class="t-body">已配备 list_directory, get_outline, view_file, grep_search 四大代码探查工具。随时等待提问...</div>
        </div>
      </div>
    </div>

    <!-- 右侧：多轮对话主区域 -->
    <div class="chat-main">
      <!-- 终端退出锁定通知条 -->
      <div id="terminalExitNotice" class="terminal-exit-banner">
        <div class="exit-banner-left">
          <span class="exit-banner-icon">⚠️</span>
          <div>
            <div class="exit-banner-title">终端总控台已离开当前功能（服务已断开）</div>
            <div class="exit-banner-desc">检测到您已在终端退出 Code Agent 工作台。当前界面已锁定并进入【只读归档模式】，无法继续进行多轮提问或代码探索。已为您居中保留当前的完整问答与架构报告，您可以通过右上角或下方按钮复制或导出保存。</div>
          </div>
        </div>
        <div class="exit-banner-actions">
          <button class="btn" onclick="copyAllChatMarkdown()">📋 复制全部对白</button>
          <button class="btn btn-primary" onclick="exportFullChatMarkdown()">📥 导出全部对白 (.md)</button>
        </div>
      </div>

      <div id="messagesViewport" class="messages-viewport">
        <div class="welcome-card">
          <h2>🎉 欢迎使用高校后勤巡查e速办代码智能体连续问答工作台</h2>
          <p>
            不同于传统工具将代码机械化首尾拼接的局限，本工作台搭载了真正的 <strong>ReAct 自主代码探索 Agent</strong>。<br/>
            智能体会像资深架构师一样，根据您提出的具体问题或疑难，<strong>自主在代码库中检索、提取接口骨架、精准切片精读源码</strong>，并在右侧生成结构严密的架构解析报告。
          </p>
        </div>
      </div>

      <!-- 底部输入 Dock -->
      <div class="input-dock">
        <div class="input-row">
          <textarea
            id="chatInput"
            class="chat-textarea"
            rows="1"
            placeholder="向 Code Agent 提问任意代码架构、业务时序或跨模块链路... (Enter 发送，Shift+Enter 换行)"
          ></textarea>
          <div class="dock-buttons">
            <button id="actionBtn" class="send-btn" onclick="handleSendClick()">
              <span>🚀 发送</span>
            </button>
          </div>
        </div>
        <div class="input-hint">
          <span>⚡ 基于 ReAct 工具闭环 · 纯真实源码探索 · 支持多轮深度追问</span>
          <span>按 Enter 发送 / Shift + Enter 换行</span>
        </div>
      </div>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    const chatInput = document.getElementById('chatInput');
    const actionBtn = document.getElementById('actionBtn');
    const messagesViewport = document.getElementById('messagesViewport');
    const timelineScroll = document.getElementById('timelineScroll');
    const stepTag = document.getElementById('stepTag');
    const statusDot = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');

    // ===== 深浅色主题模式管理 =====
    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const btn = document.getElementById('themeToggleBtn');
      const hljsTheme = document.getElementById('hljs-theme');
      if (theme === 'light') {
        if (btn) btn.innerHTML = '☀️ 浅色模式';
        if (hljsTheme) hljsTheme.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css';
      } else {
        if (btn) btn.innerHTML = '🌙 暗色模式';
        if (hljsTheme) hljsTheme.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
      }
      try {
        localStorage.setItem('quickpatrol_theme', theme);
      } catch {}
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    // 初始化自动读取偏好主题
    (function initTheme() {
      let saved = null;
      try {
        saved = localStorage.getItem('quickpatrol_theme');
      } catch {}
      if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        saved = 'light';
      }
      applyTheme(saved || 'dark');
    })();

    let isExploring = false;
    let currentAbortController = null;
    // 多轮对话语义历史
    let conversationHistory = [];
    let toolCountThisRound = 0;

    // 打字机流式输出状态控制
    let currentTypewriterTimer = null;
    let currentTypewriterSkip = null;

    function skipCurrentTyping() {
      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }
    }

    function typewriterRenderReport(card, body, reportMarkdown) {
      const skipBtn = card.querySelector('#skipBtn');
      const totalLen = reportMarkdown.length;

      // 动态自适应速度，确保长篇大作（如几千上万字）也能在 2.5 ~ 4.5 秒内极速舒适地打完
      let charsPerTick = 6;
      if (totalLen > 10000) charsPerTick = 65;
      else if (totalLen > 5000) charsPerTick = 40;
      else if (totalLen > 2000) charsPerTick = 20;
      else if (totalLen > 800) charsPerTick = 10;

      let currentIdx = 0;
      let isDone = false;

      function finalize() {
        if (isDone) return;
        isDone = true;
        if (currentTypewriterTimer) {
          clearInterval(currentTypewriterTimer);
          currentTypewriterTimer = null;
        }
        currentTypewriterSkip = null;

        // 全量渲染 Markdown
        body.innerHTML = typeof marked !== 'undefined' ? marked.parse(reportMarkdown) : '<pre>' + escapeHtml(reportMarkdown) + '</pre>';

        // 统一执行代码语法高亮
        if (typeof hljs !== 'undefined') {
          body.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
          });
        }

        // 移除跳过打字按钮
        if (skipBtn) skipBtn.remove();

        // 滚动至最新视口
        messagesViewport.scrollTop = messagesViewport.scrollHeight;
      }

      currentTypewriterSkip = finalize;

      currentTypewriterTimer = setInterval(() => {
        currentIdx += charsPerTick;
        if (currentIdx >= totalLen) {
          finalize();
          return;
        }

        // 截取当前字符切片渲染
        const slice = reportMarkdown.slice(0, currentIdx);
        body.innerHTML = (typeof marked !== 'undefined' ? marked.parse(slice) : escapeHtml(slice)) + '<span class="typewriter-cursor"></span>';

        messagesViewport.scrollTop = messagesViewport.scrollHeight;
      }, 20);
    }

    // 输入框高度自适应
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendClick();
      }
    });

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function appendTimeline(type, title, text) {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      const dotClass = type === 'thought' ? 't-dot thought' : type === 'tool' ? 't-dot tool' : type === 'done' ? 't-dot done' : 't-dot';
      item.innerHTML = '<div class="' + dotClass + '"></div><div class="t-title">' + escapeHtml(title) + '</div><div class="t-body">' + escapeHtml(text) + '</div>';
      timelineScroll.appendChild(item);
      timelineScroll.scrollTop = timelineScroll.scrollHeight;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function appendUserMessage(text) {
      const row = document.createElement('div');
      row.className = 'message-row user';
      row.innerHTML = '<div class="bubble">' + escapeHtml(text).replace(/\\n/g, '<br/>') + '</div>';
      messagesViewport.appendChild(row);
      messagesViewport.scrollTop = messagesViewport.scrollHeight;
    }

    let currentThinkingCard = null;
    function showThinkingCard(initialText = '正在规划代码检索路径...') {
      currentThinkingCard = document.createElement('div');
      currentThinkingCard.className = 'thinking-card';
      currentThinkingCard.innerHTML = '<div class="spinner"></div><div class="thinking-text"><strong id="thinkState">Agent 正在自主探索代码库...</strong><span id="thinkDetail">' + escapeHtml(initialText) + '</span></div>';
      messagesViewport.appendChild(currentThinkingCard);
      messagesViewport.scrollTop = messagesViewport.scrollHeight;
    }

    function updateThinkingCard(stateText, detailText) {
      if (!currentThinkingCard) return;
      if (stateText) document.getElementById('thinkState').innerText = stateText;
      if (detailText) document.getElementById('thinkDetail').innerText = detailText;
    }

    function removeThinkingCard() {
      if (currentThinkingCard) {
        currentThinkingCard.remove();
        currentThinkingCard = null;
      }
    }

    function appendAgentReport(reportMarkdown, toolSummary) {
      removeThinkingCard();

      // 如果上一个打字机还在运行，先立即结束
      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }

      const row = document.createElement('div');
      row.className = 'message-row agent';

      const card = document.createElement('div');
      card.className = 'agent-card';

      const meta = document.createElement('div');
      meta.className = 'agent-meta';
      meta.innerHTML = '<div class="agent-tag"><span>🤖 Code Agent 深度解析报告</span><span class="tools-pill">' + escapeHtml(toolSummary || '已通过多轮代码工具验证') + '</span></div><div class="agent-actions"><button id="skipBtn" class="typing-skip-btn" onclick="skipCurrentTyping()" title="跳过打字动画，立即展现全部内容">⚡ 跳过打字</button><button class="btn" onclick="copyCardContent(this)">📋 复制全文</button><button class="btn server-op-btn" onclick="saveReportToDocs(this)">💾 保存到 Docs</button><button class="btn btn-primary exit-only-btn" onclick="downloadCardMarkdown(this)">💾 下载此篇 (.md)</button></div>';

      const body = document.createElement('div');
      body.className = 'markdown-body';

      card.appendChild(meta);
      card.appendChild(body);
      row.appendChild(card);
      messagesViewport.appendChild(row);
      messagesViewport.scrollTop = messagesViewport.scrollHeight;

      // 存储原始 markdown 供复制或下载
      card.dataset.markdown = reportMarkdown;

      // 启动打字机动态流式渲染
      typewriterRenderReport(card, body, reportMarkdown);
    }

    function copyCardContent(btn) {
      const card = btn.closest('.agent-card');
      const md = card?.dataset?.markdown || '';
      if (!md) return;
      navigator.clipboard.writeText(md).then(() => {
        showToast('✔ 已复制本篇 Markdown 到剪贴板！');
      });
    }

    function downloadCardMarkdown(btn) {
      const card = btn.closest('.agent-card');
      const md = card?.dataset?.markdown || '';
      if (!md) {
        showToast('⚠️ 暂无内容可下载');
        return;
      }
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Code_Agent_Report_' + Date.now() + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✔ 已下载该篇报告 Markdown');
    }

    async function saveReportToDocs(btn) {
      const card = btn.closest('.agent-card');
      const md = card?.dataset?.markdown || '';
      if (!md) return;

      try {
        const res = await fetch('/api/save_report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: md })
        });
        const json = await res.json();
        if (json.success) {
          showToast('✔ 已成功保存至: ' + json.savedPath);
        } else {
          showToast('❌ 保存失败: ' + (json.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 请求保存失败: ' + err.message);
      }
    }

    function setBusyState(busy) {
      isExploring = busy;
      if (busy) {
        statusDot.className = 'dot busy';
        statusLabel.innerText = '正在探索代码库...';
        actionBtn.className = 'send-btn stop';
        actionBtn.innerHTML = '<span>⏹️ 停止探索</span>';
      } else {
        statusDot.className = 'dot';
        statusLabel.innerText = '智能体就绪';
        actionBtn.className = 'send-btn';
        actionBtn.innerHTML = '<span>🚀 发送</span>';
      }
    }

    function askPreset(text) {
      if (isExploring) return;
      chatInput.value = text;
      handleSendClick();
    }

    function clearAllChat() {
      if (isExploring) return;
      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }
      messagesViewport.innerHTML = '<div class="welcome-card"><h2>🎉 欢迎使用高校后勤巡查e速办代码智能体连续问答工作台</h2><p>已重置对话上下文。您可以向智能体提出新的架构疑问或探索目标！</p></div>';
      timelineScroll.innerHTML = '<div class="timeline-item"><div class="t-dot"></div><div class="t-title">🚀 对话已重置</div><div class="t-body">智能体已就绪，随时等待提问...</div></div>';
      conversationHistory = [];
      showToast('✔ 对话记录已清空');
    }

    function getFullChatMarkdown() {
      const lines = [
        '# 高校后勤巡查e速办 Code Agent 连续问答记录',
        '',
        '> 导出时间: ' + new Date().toLocaleString(),
        '',
        '---',
        ''
      ];
      if (conversationHistory.length > 0) {
        conversationHistory.forEach((item) => {
          if (item.role === 'user') {
            lines.push('### 👤 提问：' + item.content, '');
          } else {
            lines.push('### 🤖 Code Agent 回答：', '', item.content, '', '---', '');
          }
        });
      } else {
        const rows = document.querySelectorAll('.message-row');
        rows.forEach(row => {
          if (row.classList.contains('user')) {
            const bubble = row.querySelector('.bubble');
            const txt = bubble ? bubble.innerText.trim() : '';
            if (txt) lines.push('### 👤 提问：' + txt, '');
          } else {
            const card = row.querySelector('.agent-card');
            const md = card?.dataset?.markdown || (row.querySelector('.markdown-body')?.innerText || '').trim();
            if (md) lines.push('### 🤖 Code Agent 回答：', '', md, '', '---', '');
          }
        });
      }
      return lines.join(String.fromCharCode(10));
    }

    function copyAllChatMarkdown() {
      const hasContent = conversationHistory.length > 0 || document.querySelector('.agent-card') || document.querySelector('.message-row.user');
      if (!hasContent) {
        showToast('⚠️ 当前尚无任何对话记录');
        return;
      }
      const md = getFullChatMarkdown();
      navigator.clipboard.writeText(md).then(() => {
        showToast('✔ 已复制全部对话与报告到剪贴板！');
      }).catch(() => {
        showToast('❌ 复制失败，请手动选取内容');
      });
    }

    function exportFullChatMarkdown() {
      const hasContent = conversationHistory.length > 0 || document.querySelector('.agent-card') || document.querySelector('.message-row.user');
      if (!hasContent) {
        showToast('⚠️ 当前尚无任何对话记录');
        return;
      }
      const md = getFullChatMarkdown();
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'QuickPatrol_Agent_Chat_History_' + Date.now() + '.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✔ 已下载全部对白 Markdown 文档！');
    }

    // 终端离开检测与心跳监听
    let terminalExited = false;
    function checkTerminalHeartbeat() {
      if (terminalExited) return;
      fetch('/api/heartbeat', { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then(data => {
          if (data && data.active === false) onTerminalExited();
        })
        .catch(() => {
          onTerminalExited();
        });
    }
    setInterval(checkTerminalHeartbeat, 1000);

    function onTerminalExited() {
      if (terminalExited) return;
      terminalExited = true;
      document.body.classList.add('terminal-exited');
      const statusPill = document.getElementById('statusPill');
      if (statusPill) {
        statusPill.innerHTML = '<div class="dot" style="background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,0.5);"></div><span id="statusLabel" style="color:#ef4444;font-weight:600;">终端已离开 · 只读模式</span>';
      }
      const notice = document.getElementById('terminalExitNotice');
      if (notice) notice.style.display = 'flex';
      showToast('⚠️ 终端已离开当前功能，界面已转为只读模式');
    }

    async function handleSendClick() {
      if (isExploring) {
        // 用户点击停止
        if (currentAbortController) {
          currentAbortController.abort();
        }
        await fetch('/api/stop', { method: 'POST' }).catch(() => {});
        setBusyState(false);
        removeThinkingCard();
        appendTimeline('done', '⏹️ 中止探索', '用户手动停止了当前智能体探索');
        showToast('⏹️ 已停止本次探索');
        return;
      }

      const text = chatInput.value.trim();
      if (!text) return;

      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }

      chatInput.value = '';
      chatInput.style.height = 'auto';

      appendUserMessage(text);
      toolCountThisRound = 0;
      stepTag.innerText = '正在规划...';
      setBusyState(true);
      showThinkingCard('正在分析问题意图并规划代码探查路径...');

      appendTimeline('thought', '🎯 新一轮探查目标', text);

      currentAbortController = new AbortController();

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: conversationHistory
          }),
          signal: currentAbortController.signal
        });

        if (!response.ok) {
          throw new Error('服务返回错误: HTTP ' + response.status);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let finalReportContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('event:')) {
              const eventType = line.substring(6).trim();
              const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
              if (nextLine && nextLine.startsWith('data:')) {
                i++; // 跳过 data 行
                try {
                  const data = JSON.parse(nextLine.substring(5).trim());
                  handleSseEvent(eventType, data);
                  if (eventType === 'report') {
                    finalReportContent = data.markdown;
                  }
                } catch {}
              }
            }
          }
        }

        if (finalReportContent) {
          const summary = '已调用 ' + toolCountThisRound + ' 次本地代码感知工具';
          appendAgentReport(finalReportContent, summary);

          // 推进多轮历史
          conversationHistory.push({ role: 'user', content: text });
          conversationHistory.push({ role: 'assistant', content: finalReportContent });
        } else {
          removeThinkingCard();
          showToast('⚠️ 本次探索未生成有效报告');
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // 用户手动停止
        } else {
          removeThinkingCard();
          showToast('❌ 请求失败: ' + err.message);
          appendTimeline('done', '❌ 探索中断', err.message);
        }
      } finally {
        setBusyState(false);
        currentAbortController = null;
        stepTag.innerText = '就绪';
      }
    }

    function handleSseEvent(type, data) {
      if (type === 'step') {
        stepTag.innerText = '第 ' + data.step + ' / ' + data.maxSteps + ' 步';
        updateThinkingCard('智能体正在执行第 ' + data.step + ' / ' + data.maxSteps + ' 轮代码检索...');
      } else if (type === 'thought') {
        appendTimeline('thought', '💭 智能体思考', data.text);
        updateThinkingCard(null, data.text.substring(0, 80) + '...');
      } else if (type === 'tool_call') {
        toolCountThisRound++;
        const argStr = JSON.stringify(data.args);
        appendTimeline('tool', '🛠️ 调用工具: ' + data.name, argStr);
        updateThinkingCard('正在调用 ' + data.name + ' 探查源码...');
      } else if (type === 'tool_result') {
        appendTimeline('tool', '👀 工具反馈 [' + data.name + ']', data.summary);
      } else if (type === 'report') {
        appendTimeline('done', '🎉 探索完毕', '已完成多维事实求证，完整架构报告已输出');
      }
    }

    // 若有初始提问，自动触发首轮探索
    const initQuery = ${JSON.stringify(initialQuery)};
    if (initQuery && initQuery.trim()) {
      setTimeout(() => {
        askPreset(initQuery);
      }, 300);
    }
  </script>
</body>
</html>`;
}

/**
 * 启动常驻 Web Chat Studio HTTP 服务器
 */
async function startWebChatStudioServer(options = {}) {
  const { initialQuery = '', initialTarget = '.' } = options;
  const port = await findAvailablePort(3456);
  let activeAbortController = null;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');

    // 1. 首页静态页面
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getWebChatStudioHtml(initialQuery, initialTarget));
      return;
    }

    // 2. 状态查询
    if (parsedUrl.pathname === '/api/status') {
      const config = getAiConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: config.model, projectRoot: PROJECT_ROOT }));
      return;
    }

    // 2.1 终端心跳与连接探活
    if (parsedUrl.pathname === '/api/heartbeat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, active: true }));
      return;
    }

    // 3. 停止当前探索
    if (parsedUrl.pathname === '/api/stop' && req.method === 'POST') {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 4. 保存报告到 Docs 目录
    if (parsedUrl.pathname === '/api/save_report' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { markdown } = JSON.parse(body || '{}');
          if (!markdown) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'markdown 内容为空' }));
            return;
          }
          const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
          const fileName = `AI_AGENT_REPORT_${timestamp}.md`;
          const savedPath = saveAnalysisReportFile(markdown, fileName);
          const relPath = path.relative(PROJECT_ROOT, savedPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, savedPath: relPath }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 5. 核心 SSE 对话接口: POST /api/chat
    if (parsedUrl.pathname === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let message = '';
        let history = [];
        try {
          const parsed = JSON.parse(body || '{}');
          message = parsed.message || '';
          history = parsed.history || [];
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON');
          return;
        }

        // 开启 SSE 流
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write(': keepalive\n\n');

        const sendEvent = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        activeAbortController = new AbortController();

        console.log(`\n\x1b[1m\x1b[36m[Web 端新提问]\x1b[0m ${message}`);

        try {
          const report = await runCodeReadingAgent({
            userGoal: message,
            targetRelPath: '.',
            maxSteps: 12,
            conversationHistory: history,
            signal: activeAbortController.signal,
            onStep: (step, maxSteps) => {
              process.stdout.write(`\r   └─ [第 ${step}/${maxSteps} 步] `);
              sendEvent('step', { step, maxSteps });
            },
            onThought: (text) => {
              sendEvent('thought', { text });
            },
            onToolCall: (name, args) => {
              process.stdout.write(`🛠️ ${name} `);
              sendEvent('tool_call', { name, args });
            },
            onToolResult: (name, summary) => {
              sendEvent('tool_result', { name, summary });
            },
            onFinalAnswer: (markdown) => {
              sendEvent('report', { markdown });
            }
          });

          sendEvent('done', {});
          console.log('\n   └─ \x1b[32m✔ 报告已生成并推送给浏览器客户端\x1b[0m\n');
        } catch (err) {
          if (activeAbortController?.signal?.aborted) {
            console.log('\n   └─ \x1b[33m⏹️ 用户在 Web 端中止了探索\x1b[0m\n');
            sendEvent('error', { message: '探索已被用户中止' });
          } else {
            console.error('\n   └─ \x1b[31m❌ 探索异常:\x1b[0m', err.message);
            sendEvent('error', { message: err.message });
          }
        } finally {
          activeAbortController = null;
          res.end();
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));

  const localIp = getLocalNetworkIp();
  const webUrl = `http://${localIp}:${port}/`;

  tryAutoOpenBrowser(webUrl);

  return {
    webUrl,
    localUrl: `http://127.0.0.1:${port}/`,
    port,
    close: () => {
      if (activeAbortController) {
        activeAbortController.abort();
      }
      server.close();
    }
  };
}

/**
 * 运行常驻 Web 智能体连续问答工作台 (模式三 / 自由提问)
 */
async function runWebChatStudioInteractive(initialQuery = '', initialTarget = '.') {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🤖 高校后勤巡查e速办 Code Agent Web 连续问答工作台正在启动...');
  console.log('+========================================================================+\n');

  let serverInstance = null;
  try {
    serverInstance = await startWebChatStudioServer({ initialQuery, initialTarget });
  } catch (err) {
    console.error(`❌ 启动 Web 服务器失败: ${err.message}`);
    await getKeyPress('\n👉 按 [回车] 返回...');
    return;
  }

  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🎉 高校后勤巡查e速办 Code Agent Web 连续问答工作台已就绪！');
  console.log(`|\t🌐 本地直达链接:\t\x1b[1m\x1b[32m${serverInstance.localUrl}\x1b[0m`);
  console.log(`|\t📡 局域网访问:\t\x1b[1m\x1b[36m${serverInstance.webUrl}\x1b[0m`);
  console.log('|\t💬 交互方式:\t\x1b[33m支持在浏览器中无限连续提问、多轮深度追问与全量对白导出\x1b[0m');
  console.log('+========================================================================+\n');
  console.log('💡 系统默认浏览器已自动唤起！');
  console.log('💡 您可以切换至浏览器开始提问。在此终端中按 [\x1b[1m\x1b[31mESC\x1b[0m] 或 [\x1b[1m\x1b[31mq\x1b[0m] 键可随时安全关闭 Web 服务并返回主菜单。\n');
  console.log('--------------------------------------------------------------------------');
  console.log('                      Web 端提问与 Agent 工具同步日志                     ');
  console.log('--------------------------------------------------------------------------\n');

  while (true) {
    const key = await getKeyPress();
    if (key === 'ESC' || key === 'q' || key === 'Q') {
      console.log('\n\n🚪 正在关闭 Web 工作台服务...');
      serverInstance.close();
      console.log('✔ 服务已关闭，返回主控制台。\n');
      await new Promise(r => setTimeout(r, 600));
      break;
    }
  }
}

/**
 * 模式一：指定项目目录/模块进行分析
 */
async function handleTargetDirectoryMode() {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t📝 [模式一] 指定目录/模块代码进行智能体深度解析');
  console.log('+========================================================================+\n');
  console.log('💡 提示：输入项目子模块相对路径 (例如: "Host/HostApp", "Backend/Router")；');
  console.log('💡 启动后会自动打开 Web 连续问答工作台，首轮自动解析该模块，随后支持在网页中持续追问！\n');

  const inputPath = await askQuestion('👉 请输入目标模块路径 (直接回车表示分析根目录整体架构): ');
  const normPath = inputPath ? inputPath.trim().replace(/\\/g, '/').replace(/^\.\//, '') : '.';

  const customGoal = await askQuestion('👉 可选：请输入您的分析重点 (直接回车进行全面架构分析): ');
  const initialPrompt = `深入解析模块【${normPath}】的设计架构、核心类与数据流时序。${customGoal ? '关注点: ' + customGoal : ''}`;

  await runWebChatStudioInteractive(initialPrompt, normPath);
}

/**
 * 模式二：交互式目录树点选
 */
async function handleInteractiveTreeMode() {
  let currentDirRel = '';

  while (true) {
    clearScreen();
    const currentFull = path.resolve(PROJECT_ROOT, currentDirRel || '.');

    let entries = [];
    try {
      entries = fs.readdirSync(currentFull, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const items = [];
    if (currentDirRel) {
      items.push({ name: '.. (返回上级目录)', isDir: true, isParent: true });
    }

    // 优先目录
    entries.filter(e => e.isDirectory() && !IGNORED_DIRS.has(e.name)).forEach(e => {
      items.push({ name: `📁 ${e.name}/`, isDir: true, rawName: e.name });
    });

    // 文件
    entries.filter(e => !e.isDirectory() && !IGNORED_EXTENSIONS.has(path.extname(e.name).toLowerCase())).forEach(e => {
      items.push({ name: `📄 ${e.name}`, isDir: false, rawName: e.name });
    });

    items.push({ name: '⚡ 就地选定当前目录打开 Web 工作台连续探索', isAction: true, id: 'select_current' });
    items.push({ name: '🔙 取消并返回上一级主菜单', isAction: true, id: 'back' });

    let treeCursor = 0;
    while (true) {
      clearScreen();
      console.log('+========================================================================+');
      console.log(`|\t🌳 [模式二] 交互式目录树导航 - 当前位置: ${currentDirRel || '(根目录)'}`);
      console.log('+========================================================================+\n');

      items.forEach((item, idx) => {
        const isFocused = idx === treeCursor;
        const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
        if (isFocused) {
          console.log(`${pointer}\x1b[1m\x1b[32m${item.name}\x1b[0m`);
        } else {
          console.log(`${pointer}\x1b[37m${item.name}\x1b[0m`);
        }
      });

      console.log('\n+------------------------------------------------------------------------+');
      console.log('操作说明: [↑/↓ 选择] [回车 进目录/执行] [空格 立即以当前目录开启 Web 探索] [ESC 返回]\n');

      const key = await getKeyPress();

      if (key === 'ESC') return;

      if (key === 'UP') {
        treeCursor = (treeCursor - 1 + items.length) % items.length;
        continue;
      }
      if (key === 'DOWN') {
        treeCursor = (treeCursor + 1) % items.length;
        continue;
      }
      if (key === 'SPACE') {
        const p = currentDirRel || '.';
        await runWebChatStudioInteractive(`深入解析目录【${p}】的模块结构与实现细节`, p);
        return;
      }

      if (key === 'ENTER') {
        const sel = items[treeCursor];
        if (sel.id === 'back') return;
        if (sel.id === 'select_current') {
          const p = currentDirRel || '.';
          await runWebChatStudioInteractive(`深入解析目录【${p}】的模块结构与实现细节`, p);
          return;
        }
        if (sel.isParent) {
          currentDirRel = path.dirname(currentDirRel);
          if (currentDirRel === '.') currentDirRel = '';
          break;
        }
        if (sel.isDir) {
          currentDirRel = currentDirRel ? path.join(currentDirRel, sel.rawName).replace(/\\/g, '/') : sel.rawName;
          break;
        }
        if (!sel.isDir) {
          const filePath = currentDirRel ? path.join(currentDirRel, sel.rawName).replace(/\\/g, '/') : sel.rawName;
          await runWebChatStudioInteractive(`详细剖析文件【${filePath}】的代码逻辑、核心类与实现职责`, filePath);
          return;
        }
      }
    }
  }
}

// ----------------- 主菜单定义 -----------------
const AGENT_MENU_OPTIONS = [
  { id: 'web_chat', label: '💬 启动 Web 连续问答工作台 (推荐)', desc: '在浏览器中针对全代码库进行多轮自由提问、时序追踪与连续探索' },
  { id: 'target_dir', label: '📁 指定模块/目录深度探查', desc: '输入特定子模块路径，自动在 Web 看板中展开剖析并支持继续追问' },
  { id: 'tree_browse', label: '🌳 交互式目录树导航点选', desc: '在终端可视化目录树中定位文件/目录，一键开启 Web 深度探索' },
  { id: 'back', label: '🔙 返回总控主菜单', desc: '返回上一级高校后勤巡查e速办总控台' }
];

function printAgentMainMenu(cursor = 0) {
  let out = '';
  out += '+========================================================================+\n';
  out += '|\t🔍 AI 代码智能体架构解析控制台 (Code Agent Web Studio)\n';
  out += `|\t📂 当前项目:\t${PROJECT_ROOT}\n`;
  out += '|\t⚡ 核心技术:\tReAct 循环 + 本地四维代码感知 + Web 端多轮连续会话\n';
  out += '+========================================================================+\n\n';
  out += '📋 请选择智能体工作模式：\n\n';

  AGENT_MENU_OPTIONS.forEach((opt, idx) => {
    const isFocused = idx === cursor;
    const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
    if (isFocused) {
      out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m \x1b[90m─ ${opt.desc}\x1b[0m\n`;
    } else {
      out += `${pointer}\x1b[37m${opt.label}\x1b[0m \x1b[90m─ ${opt.desc}\x1b[0m\n`;
    }
  });

  out += '\n+------------------------------------------------------------------------+\n';
  out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 返回主菜单]\n';

  process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
}

async function main() {
  if (!hasValidAiKey()) {
    clearScreen();
    console.log('\n+========================================================================+');
    console.log('|\t⚠️  [AI 未配置] 当前尚未配置 AI API Key，代码智能体暂不可用！');
    console.log('|\t👉 请前往总控台 [⚙️  AI 接口参数配置] 完成设置。');
    console.log('+========================================================================+\n');
    await getKeyPress('👉 按 [回车] 返回主菜单...');
    process.exit(0);
  }

  let cursor = 0;

  while (true) {
    printAgentMainMenu(cursor);

    const key = await getKeyPress();

    if (key === 'ESC') {
      process.exit(0);
    }
    if (key === 'UP') {
      cursor = (cursor - 1 + AGENT_MENU_OPTIONS.length) % AGENT_MENU_OPTIONS.length;
      continue;
    }
    if (key === 'DOWN') {
      cursor = (cursor + 1) % AGENT_MENU_OPTIONS.length;
      continue;
    }
    if (key === 'ENTER') {
      const sel = AGENT_MENU_OPTIONS[cursor];
      if (sel.id === 'back') {
        process.exit(0);
      } else if (sel.id === 'web_chat') {
        await runWebChatStudioInteractive();
      } else if (sel.id === 'target_dir') {
        await handleTargetDirectoryMode();
      } else if (sel.id === 'tree_browse') {
        await handleInteractiveTreeMode();
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ 控制台未捕获异常:', err);
    process.exit(1);
  });
}

export { getWebChatStudioHtml, startWebChatStudioServer };
