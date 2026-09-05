/**
 * TOOL_UPDATE_README_WITH_AI.js
 * 
 * README 文档智能管理与维护控制台
 * 聚合两项核心能力：
 *   1. AI 全量扫描代码与架构，重新生成中英文 README (README.md / README.en.md)
 *   2. 基于用户输入的自定义修改建议，在现有文档基础上定向优化中英文 README
 * 
 * 特性：
 *   - 菜单选项单键即按即响应（无需按回车）
 *   - 建议输入时自动切换为标准行输入模式
 *   - 每次调用 AI 均有二次确认，保护 AI 接口调用额度
 *   - 自动生成符合根目录规范的 README.md (中文版) 与 README.en.md (英文版)
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { getAiConfig, hasValidAiKey, tryAutoOpenBrowser } from './config_helper.js';
import { runReadmeAgent } from './readme_agent_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ----------------- API 与模型配置 -----------------
const aiConfig = getAiConfig();
const OPENAI_API_KEY = aiConfig.apiKey;
const OPENAI_API_BASE = aiConfig.apiBase;
const OPENAI_MODEL = aiConfig.model;

// ----------------- 文件过滤规则 -----------------
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.gitee', '.vscode', 'dist', '.store', '.vite-temp',
  'coverage', 'temp', 'logs', 'build', '.system_generated'
]);

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.bmp',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.tar', '.zip', '.gz',
  '.log', '.lock', '.map', '.min.js', '.min.css'
]);

const IGNORED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'tokenizer.json', 'llama tokenizer.json', 'qwen tokenizer.json'
]);

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
 * 递归构建目录结构树 (ASCII Tree)
 */
function generateDirectoryTree(dir, prefix = '', depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return '';
  let output = '';

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return '';
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const validEntries = entries.filter((entry) => {
    if (entry.isDirectory()) return !IGNORED_DIRS.has(entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    return !IGNORED_EXTENSIONS.has(ext) && !IGNORED_FILES.has(entry.name);
  });

  validEntries.forEach((entry, index) => {
    const isLast = index === validEntries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    output += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

    if (entry.isDirectory()) {
      output += generateDirectoryTree(path.join(dir, entry.name), nextPrefix, depth + 1, maxDepth);
    }
  });

  return output;
}

/**
 * 递归收集所有核心源码与配置并组装为大字符串
 */
function collectCodebase(dir, collected = { files: 0, text: '' }, maxTotalChars = 120000) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (collected.text.length >= maxTotalChars) {
      break;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        collectCodebase(fullPath, collected, maxTotalChars);
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext) || IGNORED_FILES.has(entry.name)) {
        continue;
      }

      try {
        const stats = fs.statSync(fullPath);
        let content = fs.readFileSync(fullPath, 'utf-8');
        if (content.length > 8000) {
          content = content.substring(0, 8000) + '\n... [Content truncated for length]';
        }

        collected.files++;
        collected.text += `\n========================================================================\n`;
        collected.text += `FILE: ${relPath} (${stats.size} bytes)\n`;
        collected.text += `========================================================================\n`;
        collected.text += content + '\n';
      } catch (err) {
        // 忽略单个文件读取异常
      }
    }
  }

  return collected;
}

/**
 * 清洗 AI 返回的 Markdown
 */
function cleanMarkdownOutput(raw) {
  let text = raw.trim();
  if (text.startsWith('```markdown') && text.endsWith('```')) {
    text = text.replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim();
  } else if (text.startsWith('```md') && text.endsWith('```')) {
    text = text.replace(/^```md\n?/, '').replace(/\n?```$/, '').trim();
  } else if (text.startsWith('```') && text.endsWith('```')) {
    text = text.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return text;
}

/**
 * 调用 AI 大模型全量生成指定语言的 README 文档
 */
async function callAiToGenerateReadme(treeText, codeContextText, lang = 'zh') {
  const isZh = lang === 'zh';

  const prompt = isZh
    ? `你是一个顶级的开源架构师与全栈技术文档专家。
请根据下面提供的完整项目代码库、目录结构树以及各子模块的源码实现，为本项目（高校后勤巡查e速办 v4.0 / QuickPatrol）编写一份详尽、现代化、结构严谨且具有极高专业度的项目主文档 【README.md】。

【文档结构与内容规范】：
1. 项目标题与徽标/简介：
   - 项目名称：高校后勤巡查e速办 (QuickPatrol) v4.0
   - 包含设计理念、核心技术栈、解决的痛点（校园后勤隐患快速上报、智能流转派单、施工整改追踪、双身份闭环治理）。
2. 系统整体架构图（使用清晰对齐的 ASCII 架构图 或 Mermaid 流程图）：
   - 展示微信小程序前端 (WeChatMiniProgram)、后端高性能微服务 (Backend: Express 5 / TypeScript)、数据存储与缓存 (MySQL 8.x / Redis)、工程化运维工具箱 (Tools)、文档体系 (Docs)。
3. 项目目录结构规范：
   - 必须与项目真实的 4 大主领域（Backend, WeChatMiniProgram, Docs, Tools）完全一致，配以简明的职责说明。
4. 核心子系统与特色技术深度剖析：
   - 微信小程序端 (WeChatMiniProgram)：原生微信小程序框架、双角色权限（普通师生巡查端与后勤维修师傅端）、工单状态机流转。
   - 后端微服务群 (Backend)：TypeScript 5 + Express 5、MySQL 8.x 连接池 (mysql2/promise)、Redis 缓存加速、轻量级单句自动提交补偿回滚引擎 (Compensating Transactions/Saga)、AST 动态 SQL 构建器、WebSocket 双向推送集群。
   - 自动化测试与质量保障：Vitest 自动化测试套件（覆盖 SQL AST、数据流加密、集群 WS、分发路由等核心业务）。
5. 环境要求与快速启动指南：
   - Node.js 18+ / 20+、MySQL 8.x、Redis。
   - 后端启动命令 (cd Backend && npm run dev，默认端口 3000)。
   - 微信小程序启动方式 (使用微信开发者工具打开 WeChatMiniProgram 目录)。
6. 工程化工具箱与测试运行：
   - 介绍 Tools 目录与快捷启动脚本（tools_windows.bat / tools_linux_macos.sh）。
   - 自动化测试执行 (node Tools/TOOL_RUN_ALL_TESTS.js)。
   - 依赖管理 (node Tools/TOOL_INITIALIZE_PROJECT.js, node Tools/TOOL_REINSTALL_DEPENDENCIES.js)。
7. 输出要求：
   - 直接输出完整的 Markdown 文本，排版优美，代码块正确标注高亮语法。不要输出任何额外的废话。

【项目真实目录结构树】：
${treeText}

【项目源码与配置概览（核心文件汇总）】：
${codeContextText}
`
    : `You are a top-tier open-source architect and technical documentation specialist.
Based on the provided full codebase, directory tree, and module implementations, write a comprehensive, modern, highly professional English main documentation for 【README.en.md】 (QuickPatrol v4.0 - Smart Campus Logistics Inspection & Maintenance Platform).

【Documentation Requirements】:
1. Title & High-level Overview of QuickPatrol v4.0 (Smart Campus Logistics Inspection and Maintenance Closed-Loop Management System).
2. Complete System Architecture Diagram (neat ASCII diagram or Mermaid).
3. Monorepo Directory Layout matching the real project structure (Backend, WeChatMiniProgram, Docs, Tools) with concise module descriptions.
4. Core Subsystem & Technical Highlights (WeChat Mini-Program client for students/teachers & maintenance staff, Express 5 + TypeScript backend, MySQL 8.x + Redis, AST SQL query builder, lightweight transaction compensation/undo stack, WebSocket cluster broadcast, Vitest unit testing suite).
5. Prerequisites & Step-by-Step Quick Start Guide (Backend: port 3000, WeChatMiniProgram: WeChat Developer Tools).
6. Engineering Tools & Automated Testing (tools_windows.bat, tools_linux_macos.sh, and TOOL_RUN_ALL_TESTS.js).
7. Output only the pure, well-formatted Markdown text without extra conversational fillers.

【Project Directory Tree】:
${treeText}

【Project Source Code & Configuration Bundle】:
${codeContextText}
`;

  const url = OPENAI_API_BASE.endsWith('/v1')
    ? `${OPENAI_API_BASE}/chat/completions`
    : `${OPENAI_API_BASE}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert technical writer and architect. Output only complete, high quality Markdown documentation.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI API 请求失败 (HTTP ${response.status}): ${errBody}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content || '';
  return cleanMarkdownOutput(rawContent);
}

/**
 * 调用 AI 大模型根据用户建议定向修改 README
 */
async function callAiToEditReadme(originalContent, userSuggestion, lang = 'zh') {
  const isZh = lang === 'zh';

  const prompt = isZh
    ? `你是一个顶级的开源架构师与全栈技术文档专家。
请根据用户提出的【修改建议/需求】，对下面现有的项目文档【README.md】进行精准的更新、补充与结构调整。

【修改原则与规范】：
1. 严格响应用户的修改建议，将新增的内容或修改点自然、优雅地融入现有文档中。
2. 保留现有文档中未涉及修改的优质技术描述、架构图和排版风格。
3. 确保技术细节准确，排版工整，Markdown 格式规范。
4. 只输出修改后的完整 Markdown 文本，不要包含任何多余的前言、结语或解释。

【用户提出的修改建议】：
${userSuggestion}

【当前 README.md 原始内容】：
${originalContent}
`
    : `You are a top-tier open-source architect and technical documentation specialist.
Please update and polish the provided English documentation 【README.en.md】 based on the user's specific modification requirements.

【Modification Principles】:
1. Accurately implement the user's suggestions into the documentation in natural and professional technical English.
2. Preserve existing valid architecture diagrams, descriptions, and high quality structure where unaffected.
3. Output ONLY the updated full Markdown text without conversational filler.

【User Modification Suggestions】:
${userSuggestion}

【Current README.en.md Original Content】:
${originalContent}
`;

  const url = OPENAI_API_BASE.endsWith('/v1')
    ? `${OPENAI_API_BASE}/chat/completions`
    : `${OPENAI_API_BASE}/v1/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert technical documentation editor. Output only the updated Markdown content.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`AI API 请求失败 (HTTP ${response.status}): ${errBody}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content || '';
  return cleanMarkdownOutput(rawContent);
}

/**
 * 获取 README 文件状态信息
 */
function getReadmeFileInfo() {
  const zhPath = path.join(PROJECT_ROOT, 'README.md');
  const enPath = path.join(PROJECT_ROOT, 'README.en.md');

  const zhExists = fs.existsSync(zhPath);
  const enExists = fs.existsSync(enPath);

  const zhSize = zhExists ? (fs.statSync(zhPath).size / 1024).toFixed(1) + ' KB' : '未创建';
  const enSize = enExists ? (fs.statSync(enPath).size / 1024).toFixed(1) + ' KB' : '未创建';

  return {
    zhPath,
    enPath,
    zhExists,
    enExists,
    zhSize,
    enSize
  };
}

/**
 * 功能 1: AI 全量分析代码并重新生成中英文 README
 */
async function handleGenerateFromCodebase() {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🤖 [功能 1] README 智能体自主探索架构并全量生成主文档');
  console.log('+========================================================================+\n');

  console.log('💡 README 智能体将自主调用工具探索 Monorepo 各子系统、探查端口与接口设计，');
  console.log('💡 拒绝粗暴截断拼接，基于真实代码证据生成专业中英文 README。\n');

  const confirmOptions = [
    { id: 'start', label: '✔ 确认启动 README 智能体全量探索生成中英文主文档' },
    { id: 'cancel', label: '🚪 取消并返回' }
  ];
  let confirmCursor = 0;

  while (true) {
    console.log('\n+------------------------------------------------------------------------+');
    console.log('|\t📋 即将由 ReAct 智能体全量探查并生成以下文档:');
    console.log('|\t\t1. README.md    (项目中文技术主文档)');
    console.log('|\t\t2. README.en.md (项目英文技术主文档)');
    console.log('+------------------------------------------------------------------------+\n');

    confirmOptions.forEach((opt, idx) => {
      const isFocused = idx === confirmCursor;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        console.log(`${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m`);
      } else {
        console.log(`${pointer}\x1b[37m${opt.label}\x1b[0m`);
      }
    });

    console.log('\n+------------------------------------------------------------------------+');
    console.log('操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 取消返回]\n');

    const key = await getKeyPress();

    if (key === 'ESC' || (key === 'ENTER' && confirmOptions[confirmCursor].id === 'cancel')) {
      console.log('\n🚪 已取消操作，未消耗任何 AI 额度。\n');
      return;
    }

    if (key === 'UP') {
      confirmCursor = (confirmCursor - 1 + confirmOptions.length) % confirmOptions.length;
      continue;
    }

    if (key === 'DOWN') {
      confirmCursor = (confirmCursor + 1) % confirmOptions.length;
      continue;
    }

    if (key === 'ENTER' && confirmOptions[confirmCursor].id === 'start') {
      break;
    }
  }

  console.log('\n--------------------------------------------------------------------------');
  console.log('🤖 [阶段 1/2] README 智能体正在自主探查代码库并生成 【README.md (中文版)】...');
  console.log('--------------------------------------------------------------------------');
  let zhMarkdown = '';
  try {
    const resZh = await runReadmeAgent({
      mode: 'generate',
      lang: 'zh',
      onStep: (s, max) => process.stdout.write(`\r   └─ [README Agent 步数 ${s}/${max}] `),
      onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
      onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
      onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
    });
    zhMarkdown = resZh.markdown;
    console.log(`\n✔ 中文版初稿生成成功！(大小: ${(zhMarkdown.length / 1024).toFixed(1)} KB，调用工具 ${resZh.toolExecutions.length} 次)`);
  } catch (err) {
    console.error(`\n❌ 生成 README.md 初稿失败: ${err.message}`);
    zhMarkdown = '# 高校后勤巡查e速办 v4.0\n\n> 生成失败，请在工作台中输入修改意见重试。\n';
  }

  console.log('\n--------------------------------------------------------------------------');
  console.log('🤖 [阶段 2/2] README 智能体正在自主探查代码库并生成 【README.en.md (英文版)】...');
  console.log('--------------------------------------------------------------------------');
  let enMarkdown = '';
  try {
    const resEn = await runReadmeAgent({
      mode: 'generate',
      lang: 'en',
      onStep: (s, max) => process.stdout.write(`\r   └─ [README Agent 步数 ${s}/${max}] `),
      onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
      onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
      onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
    });
    enMarkdown = resEn.markdown;
    console.log(`\n✔ 英文版初稿生成成功！(大小: ${(enMarkdown.length / 1024).toFixed(1)} KB，调用工具 ${resEn.toolExecutions.length} 次)`);
  } catch (err) {
    console.error(`\n❌ 生成 README.en.md 初稿失败: ${err.message}`);
    enMarkdown = '# QuickPatrol v4.0\n\n> Generation failed. Please refine in web studio.\n';
  }

  // 启动 Web 交互工作台（草稿未落盘，等待用户在浏览器中预览、多轮微调后确认替换）
  await startReadmeWebStudio(zhMarkdown, enMarkdown);

}

/**
 * 功能 2: 基于自定义建议定向更新中英文 README
 */
async function handleUpdateWithSuggestion() {
  clearScreen();
  const info = getReadmeFileInfo();

  console.log('+========================================================================+');
  console.log('|\t✏️  [功能 2] 基于自定义建议定向优化中英文 README');
  console.log('+========================================================================+\n');

  console.log('请输入您的具体修改建议 (例如: "补充 Host 驱动的伙伴内存分配算法细节与启动端口对照表"):');
  const suggestion = await askQuestion('👉 修改建议: ');

  if (!suggestion.trim()) {
    console.log('\n🚪 未输入任何修改建议，操作已取消。');
    await new Promise((r) => setTimeout(r, 600));
    return;
  }

  const confirmOptions = [
    { id: 'start', label: '✔ 开始调用 AI 大模型定向修改并进入 Web 预览精修' },
    { id: 'cancel', label: '🚪 取消并返回' }
  ];
  let confirmCursor = 0;

  while (true) {
    console.log('\n+------------------------------------------------------------------------+');
    console.log(`|\t💡 输入的修改建议:\t\x1b[1m\x1b[33m"${suggestion}"\x1b[0m`);
    console.log('|\t📋 即将更新文件:\tREADME.md 与 README.en.md (进入 Web 后可继续微调与确认替换)');
    console.log('+------------------------------------------------------------------------+\n');

    confirmOptions.forEach((opt, idx) => {
      const isFocused = idx === confirmCursor;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        console.log(`${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m`);
      } else {
        console.log(`${pointer}\x1b[37m${opt.label}\x1b[0m`);
      }
    });

    console.log('\n+------------------------------------------------------------------------+');
    console.log('操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 取消返回]\n');

    const key = await getKeyPress();

    if (key === 'ESC' || (key === 'ENTER' && confirmOptions[confirmCursor].id === 'cancel')) {
      console.log('\n🚪 已取消操作，未消耗任何 AI 额度。\n');
      return;
    }

    if (key === 'UP') {
      confirmCursor = (confirmCursor - 1 + confirmOptions.length) % confirmOptions.length;
      continue;
    }

    if (key === 'DOWN') {
      confirmCursor = (confirmCursor + 1) % confirmOptions.length;
      continue;
    }

    if (key === 'ENTER' && confirmOptions[confirmCursor].id === 'start') {
      break;
    }
  }

  // 1. 读取现有内容
  const currentZhContent = info.zhExists ? fs.readFileSync(info.zhPath, 'utf-8') : '# 高校后勤巡查e速办 v4.0\n';
  const currentEnContent = info.enExists ? fs.readFileSync(info.enPath, 'utf-8') : '# QuickPatrol v4.0\n';

  // 2. 修改中文版
  console.log('\n--------------------------------------------------------------------------');
  console.log('🤖 [阶段 1/2] README 智能体正在基于建议审计代码并修订 【README.md (中文版)】...');
  console.log('--------------------------------------------------------------------------');
  let updatedZh = '';
  try {
    const resZh = await runReadmeAgent({
      mode: 'refine',
      lang: 'zh',
      userSuggestion: suggestion,
      currentContent: currentZhContent,
      onStep: (s, max) => process.stdout.write(`\r   └─ [README Agent 步数 ${s}/${max}] `),
      onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
      onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
      onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
    });
    updatedZh = resZh.markdown;
    console.log(`\n✔ 中文版修订就绪！(调用工具 ${resZh.toolExecutions.length} 次)`);
  } catch (err) {
    console.error(`\n❌ 修订 README.md 失败: ${err.message}`);
    updatedZh = currentZhContent;
  }

  // 3. 修改英文版
  console.log('\n--------------------------------------------------------------------------');
  console.log('🤖 [阶段 2/2] README 智能体正在基于建议审计代码并修订 【README.en.md (英文版)】...');
  console.log('--------------------------------------------------------------------------');
  let updatedEn = '';
  try {
    const resEn = await runReadmeAgent({
      mode: 'refine',
      lang: 'en',
      userSuggestion: suggestion,
      currentContent: currentEnContent,
      onStep: (s, max) => process.stdout.write(`\r   └─ [README Agent 步数 ${s}/${max}] `),
      onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
      onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
      onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
    });
    updatedEn = resEn.markdown;
    console.log(`\n✔ 英文版修订就绪！(调用工具 ${resEn.toolExecutions.length} 次)`);
  } catch (err) {
    console.error(`\n❌ 修订 README.en.md 失败: ${err.message}`);
    updatedEn = currentEnContent;
  }

  // 启动 Web 交互工作台进行预览与二次微调
  await startReadmeWebStudio(updatedZh, updatedEn);

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

async function findAvailablePort(startPort = 3460) {
  let port = startPort;
  while (port < startPort + 100) {
    if (await isPortAvailable(port)) return port;
    port++;
  }
  return 3460;
}

/**
 * 生成具备双语切换、多轮微调、深浅色模式与打字机效果的 README 交互工作台 HTML
 */
function getWebReadmeStudioHtml(initialZh, initialEn) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>高校后勤巡查e速办 v4.0 README 双语智能精修工作台</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <link id="hljs-theme" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
  <style>
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
      --accent-green: #22c55e;
      --code-bg: #06090e;
      --shadow-color: rgba(0, 0, 0, 0.5);
      --dock-bg: rgba(19, 25, 36, 0.94);
    }
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
      --accent-green: #16a34a;
      --code-bg: #f8fafc;
      --shadow-color: rgba(0, 0, 0, 0.08);
      --dock-bg: rgba(255, 255, 255, 0.95);
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
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border-color);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      z-index: 100;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .app-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-heading);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tabs-group {
      display: flex;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 3px;
      gap: 4px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--accent-blue);
      color: #fff;
      box-shadow: 0 2px 6px rgba(56, 139, 253, 0.3);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
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
    .btn:hover { border-color: var(--accent-blue); filter: brightness(1.08); }
    .btn.primary, .btn-primary { background: #16a34a !important; color: #fff !important; border-color: #16a34a !important; }
    .btn.primary:hover, .btn-primary:hover { background: #15803d !important; }
    .typing-skip-btn {
      font-size: 11px;
      background: var(--panel-bg);
      border: 1px solid var(--accent-blue);
      color: var(--accent-blue);
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      display: none;
    }
    .main-viewport {
      flex: 1;
      overflow-y: auto;
      padding: 28px 48px 140px 48px;
      display: flex;
      justify-content: center;
    }
    .document-card {
      max-width: 980px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 36px 44px;
      box-shadow: var(--shadow-color);
      position: relative;
    }
    .doc-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 14px;
      margin-bottom: 24px;
    }
    .doc-badge {
      font-size: 12px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      padding: 3px 10px;
      border-radius: 14px;
      color: var(--accent-cyan);
    }
    .markdown-body {
      font-size: 14.5px;
      line-height: 1.75;
      color: var(--text-main);
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 {
      color: var(--text-heading);
      margin: 24px 0 12px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }
    .markdown-body pre {
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      margin: 16px 0;
    }
    .markdown-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .markdown-body :not(pre) > code {
      background: var(--panel-bg);
      color: var(--accent-blue);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12.5px;
      border: 1px solid var(--border-color);
    }
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid var(--border-color);
      padding: 10px 14px;
    }
    .markdown-body th { background: var(--panel-bg); color: var(--text-heading); }
    .markdown-body blockquote {
      border-left: 3px solid var(--accent-blue);
      padding: 8px 16px;
      background: var(--panel-bg);
      color: var(--text-muted);
      margin: 16px 0;
      border-radius: 0 6px 6px 0;
    }
    .input-dock {
      position: absolute;
      bottom: 20px;
      left: 48px;
      right: 48px;
      background: var(--dock-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 10px 16px;
      box-shadow: var(--shadow-color);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .input-dock:focus-within {
      border-color: var(--border-focus);
      box-shadow: 0 10px 30px rgba(56, 139, 253, 0.2);
    }
    .dock-row {
      display: flex;
      gap: 12px;
      align-items: flex-end;
    }
    .dock-textarea {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-main);
      font-size: 14px;
      line-height: 1.5;
      resize: none;
      max-height: 140px;
      min-height: 26px;
      outline: none;
      font-family: inherit;
    }
    .dock-textarea::placeholder { color: var(--text-muted); }
    .send-btn {
      background: linear-gradient(135deg, #2563eb 0%, #388bfd 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .send-btn:hover { filter: brightness(1.1); }
    .dock-hint {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }
    #toast {
      position: fixed;
      bottom: 96px;
      right: 48px;
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
    body.terminal-exited .input-dock {
      display: none !important;
    }
    body.terminal-exited .header-op-btn {
      display: none !important;
    }
    body.terminal-exited .typing-skip-btn {
      display: none !important;
    }
    body.terminal-exited .main-viewport {
      padding: 24px 20px 60px 20px !important;
      overflow-y: auto !important;
    }
    body.terminal-exited .main-viewport::-webkit-scrollbar {
      width: 7px;
    }
    body.terminal-exited .main-viewport::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    body.terminal-exited .document-card {
      max-width: 980px !important;
      width: 100% !important;
      margin: 0 auto !important;
    }
    .terminal-exit-banner {
      display: none;
      background: rgba(234, 179, 8, 0.12);
      border: 1px solid rgba(234, 179, 8, 0.35);
      border-radius: 10px;
      padding: 14px 20px;
      margin-bottom: 24px;
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
      <div class="app-title">📖 高校后勤巡查e速办 v4.0 README 双语智能精修工作台</div>
      <div class="tabs-group">
        <button id="tabZhBtn" class="tab-btn active" onclick="switchTab('zh')">🇨🇳 中文版 (README.md)</button>
        <button id="tabEnBtn" class="tab-btn" onclick="switchTab('en')">🇬🇧 英文版 (README.en.md)</button>
      </div>
    </div>
    <div class="header-right">
      <button id="skipBtn" class="typing-skip-btn" onclick="skipCurrentTyping()">⚡ 跳过打字</button>
      <button id="themeToggleBtn" class="btn" onclick="toggleTheme()">🌙 暗色模式</button>
      <button class="btn" onclick="copyCurrentMarkdown()">📋 复制当前 Markdown</button>
      <button class="btn btn-primary exit-only-btn" onclick="downloadCurrentMarkdown()">💾 下载当前版 (.md)</button>
      <button class="btn header-op-btn" onclick="saveAsCustomFile()">📁 另存为文件...</button>
      <button class="btn primary header-op-btn" onclick="confirmSaveReadme()">💾 确认覆盖替换 README.md</button>
    </div>
  </header>

  <div class="main-viewport" id="mainViewport">
    <div class="document-card">
      <!-- 终端退出锁定通知条 -->
      <div id="terminalExitBanner" class="terminal-exit-banner">
        <div class="exit-banner-left">
          <span class="exit-banner-icon">⚠️</span>
          <div>
            <div class="exit-banner-title">终端总控台已离开当前功能（服务已断开）</div>
            <div class="exit-banner-desc">检测到您已在终端退出 README 管理功能。当前界面已锁定并进入【只读归档模式】，无法继续输入建议调用 AI 微调或覆盖磁盘文件。已为您居中保留当前已生成的双语内容，您可通过上方或下方按钮复制或下载保存。</div>
          </div>
        </div>
        <div class="exit-banner-actions">
          <button class="btn" onclick="copyCurrentMarkdown()">📋 复制当前版</button>
          <button class="btn btn-primary" onclick="downloadCurrentMarkdown()">💾 下载当前版 (.md)</button>
          <button class="btn" onclick="downloadBothMarkdown()">📦 下载双语版</button>
        </div>
      </div>

      <div class="doc-meta">
        <div class="doc-badge" id="docBadge">📄 正在加载文档草稿...</div>
        <div id="docStatusHint" style="font-size: 12px; color: var(--text-muted);">草稿尚未落盘，满意后点击右上角绿色按钮确认覆盖</div>
      </div>
      <div id="previewBody" class="markdown-body"></div>
    </div>
  </div>

  <div class="input-dock">
    <div class="dock-row">
      <textarea
        id="modInput"
        class="dock-textarea"
        rows="1"
        placeholder="输入进一步修改意见，如“补充系统部署端口对照表”、“增加系统架构Mermaid时序图”... (Enter 发送)"
      ></textarea>
      <button id="sendBtn" class="send-btn" onclick="sendModification()">
        <span>🚀 提交修改意见</span>
      </button>
    </div>
    <div class="dock-hint">
      <span>⚡ AI 实时增量更新 · 打字机渐进呈现 · 确认满意后再点击上方保存</span>
      <span>按 Enter 提交 / Shift + Enter 换行</span>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    let currentZh = ${JSON.stringify(initialZh)};
    let currentEn = ${JSON.stringify(initialEn)};
    let activeLang = 'zh';

    const previewBody = document.getElementById('previewBody');
    const docBadge = document.getElementById('docBadge');
    const tabZhBtn = document.getElementById('tabZhBtn');
    const tabEnBtn = document.getElementById('tabEnBtn');
    const modInput = document.getElementById('modInput');
    const sendBtn = document.getElementById('sendBtn');
    const skipBtn = document.getElementById('skipBtn');
    const mainViewport = document.getElementById('mainViewport');

    let currentTypewriterTimer = null;
    let currentTypewriterSkip = null;

    // 主题管理
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
      try { localStorage.setItem('quickpatrol_theme', theme); } catch {}
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    (function initTheme() {
      let saved = null;
      try { saved = localStorage.getItem('quickpatrol_theme'); } catch {}
      if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        saved = 'light';
      }
      applyTheme(saved || 'dark');
    })();

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function skipCurrentTyping() {
      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }
    }

    function typewriterRender(markdownText, onComplete) {
      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }

      skipBtn.style.display = 'inline-flex';
      const totalLen = markdownText.length;
      let charsPerTick = 12;
      if (totalLen > 10000) charsPerTick = 65;
      else if (totalLen > 5000) charsPerTick = 40;
      else if (totalLen > 2000) charsPerTick = 20;

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
        skipBtn.style.display = 'none';

        previewBody.innerHTML = typeof marked !== 'undefined' ? marked.parse(markdownText) : markdownText;
        if (typeof hljs !== 'undefined') {
          previewBody.querySelectorAll('pre code').forEach((b) => hljs.highlightElement(b));
        }
        updateDocBadge();
        onComplete?.();
      }

      currentTypewriterSkip = finalize;

      currentTypewriterTimer = setInterval(() => {
        currentIdx += charsPerTick;
        if (currentIdx >= totalLen) {
          finalize();
          return;
        }
        const slice = markdownText.slice(0, currentIdx);
        previewBody.innerHTML = (typeof marked !== 'undefined' ? marked.parse(slice) : slice) + '<span class="typewriter-cursor"></span>';
      }, 20);
    }

    function updateDocBadge() {
      const text = activeLang === 'zh' ? currentZh : currentEn;
      const fileName = activeLang === 'zh' ? 'README.md (中文)' : 'README.en.md (英文)';
      docBadge.innerText = '📄 ' + fileName + ' · ' + text.length + ' 字符 (' + (text.length / 1024).toFixed(1) + ' KB)';
    }

    function switchTab(lang) {
      if (activeLang === lang) return;
      activeLang = lang;
      if (lang === 'zh') {
        tabZhBtn.classList.add('active');
        tabEnBtn.classList.remove('active');
      } else {
        tabEnBtn.classList.add('active');
        tabZhBtn.classList.remove('active');
      }
      typewriterRender(activeLang === 'zh' ? currentZh : currentEn);
    }

    // 输入自适应与回车提交
    modInput.addEventListener('input', () => {
      modInput.style.height = 'auto';
      modInput.style.height = Math.min(modInput.scrollHeight, 140) + 'px';
    });

    modInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendModification();
      }
    });

    async function sendModification() {
      const text = modInput.value.trim();
      if (!text) return;

      modInput.value = '';
      modInput.style.height = 'auto';

      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span>🤖 Agent 正在自主查验代码与微调...</span>';

      try {
        const res = await fetch('/api/refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            suggestion: text,
            lang: activeLang,
            currentContent: activeLang === 'zh' ? currentZh : currentEn
          })
        });

        const json = await res.json();
        if (json.success && json.updatedMarkdown) {
          if (activeLang === 'zh') {
            currentZh = json.updatedMarkdown;
          } else {
            currentEn = json.updatedMarkdown;
          }
          typewriterRender(json.updatedMarkdown);
          const toolCnt = json.toolCount || 0;
          showToast('✔ README 智能体已完成修订 (调用了 ' + toolCnt + ' 次代码工具核实)！');
        } else {
          showToast('❌ 修改失败: ' + (json.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span>🚀 提交修改意见</span>';
      }
    }

    async function confirmSaveReadme() {
      if (typeof currentTypewriterSkip === 'function') {
        currentTypewriterSkip();
      }

      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            zhMarkdown: currentZh,
            enMarkdown: currentEn
          })
        });

        const json = await res.json();
        if (json.success) {
          showToast('🎉 已成功覆盖保存至项目根目录 README.md 与 README.en.md！');
        } else {
          showToast('❌ 保存失败: ' + (json.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 保存请求失败: ' + err.message);
      }
    }

    function copyCurrentMarkdown() {
      const md = activeLang === 'zh' ? currentZh : currentEn;
      navigator.clipboard.writeText(md).then(() => {
        showToast('✔ 已复制当前版 Markdown 全文至剪贴板！');
      });
    }

    async function saveAsCustomFile() {
      const defName = activeLang === 'zh' ? 'README_Custom.md' : 'README.en_Custom.md';
      const name = prompt('请输入另存为的文件名 (保存在 Docs/ 目录下):', defName);
      if (!name || !name.trim()) return;

      const md = activeLang === 'zh' ? currentZh : currentEn;
      try {
        const res = await fetch('/api/save_custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: md, fileName: name.trim() })
        });
        const json = await res.json();
        if (json.success) {
          showToast('✔ 另存成功: ' + json.savedPath);
        } else {
          showToast('❌ 另存失败: ' + json.error);
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      }
    }

    function downloadMarkdownBlob(filename, text) {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function downloadCurrentMarkdown() {
      const isZh = activeLang === 'zh';
      const filename = isZh ? 'README.md' : 'README.en.md';
      const content = isZh ? currentZh : currentEn;
      downloadMarkdownBlob(filename, content);
      showToast('✔ 已下载 ' + filename);
    }

    function downloadBothMarkdown() {
      downloadMarkdownBlob('README.md', currentZh);
      setTimeout(() => {
        downloadMarkdownBlob('README.en.md', currentEn);
      }, 300);
      showToast('✔ 已下载中英文双语 README 文档！');
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
      const docStatusHint = document.getElementById('docStatusHint');
      if (docStatusHint) {
        docStatusHint.innerText = '🔒 终端已离开 · 界面已转为只读模式 (支持自由复制与下载)';
        docStatusHint.style.color = '#ef4444';
        docStatusHint.style.fontWeight = '600';
      }
      const banner = document.getElementById('terminalExitBanner');
      if (banner) banner.style.display = 'flex';
      showToast('⚠️ 终端总控台已离开当前功能，界面已锁定为只读模式');
    }

    // 页面初次渲染
    typewriterRender(currentZh);
  </script>
</body>
</html>`;
}

/**
 * 启动常驻 README 智能双语精修工作台
 */
async function startReadmeWebStudio(initialZh, initialEn) {
  const port = await findAvailablePort(3460);
  let currentZh = initialZh;
  let currentEn = initialEn;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');

    // 1. 首页
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getWebReadmeStudioHtml(currentZh, currentEn));
      return;
    }

    // 2. 状态查询
    if (parsedUrl.pathname === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ zh: currentZh, en: currentEn, model: OPENAI_MODEL }));
      return;
    }

    // 2.1 终端心跳与连接探活
    if (parsedUrl.pathname === '/api/heartbeat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, active: true }));
      return;
    }

    // 3. 多轮微调修改
    if (parsedUrl.pathname === '/api/refine' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { suggestion, lang, currentContent } = JSON.parse(body || '{}');
          if (!suggestion) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '请提供修改建议' }));
            return;
          }
          console.log(`\n🤖 [README Agent Web 任务] 正在基于修改建议审计代码并优化 ${lang === 'zh' ? '中文版' : '英文版'} README: "${suggestion}"`);
          const targetContent = currentContent || (lang === 'zh' ? currentZh : currentEn);
          const agentRes = await runReadmeAgent({
            mode: 'refine',
            lang: lang || 'zh',
            userSuggestion: suggestion,
            currentContent: targetContent,
            onStep: (s, max) => process.stdout.write(`\r   └─ [README Agent 步数 ${s}/${max}] `),
            onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
            onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
            onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
          });
          const updated = agentRes.markdown;
          if (lang === 'zh') {
            currentZh = updated;
          } else {
            currentEn = updated;
          }
          console.log(`\n✔ [Web 响应] ${lang === 'zh' ? '中文版' : '英文版'} README 智能体修订完成！(调用工具 ${agentRes.toolExecutions.length} 次)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            updatedMarkdown: updated,
            toolCount: agentRes.toolExecutions.length
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 4. 确认覆盖替换根目录 README
    if (parsedUrl.pathname === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { zhMarkdown, enMarkdown } = JSON.parse(body || '{}');
          if (zhMarkdown) {
            currentZh = zhMarkdown;
            const zhPath = path.join(PROJECT_ROOT, 'README.md');
            fs.writeFileSync(zhPath, zhMarkdown, 'utf-8');
          }
          if (enMarkdown) {
            currentEn = enMarkdown;
            const enPath = path.join(PROJECT_ROOT, 'README.en.md');
            fs.writeFileSync(enPath, enMarkdown, 'utf-8');
          }
          console.log('\n+========================================================================+');
          console.log('|\t🎉 [用户确认] 已成功覆盖替换项目根目录 README.md 与 README.en.md！');
          console.log('+========================================================================+\n');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: '已成功覆盖保存至项目根目录 README.md 与 README.en.md！' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 5. 另存为自定义文件
    if (parsedUrl.pathname === '/api/save_custom' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { content, fileName } = JSON.parse(body || '{}');
          const safeName = (fileName || `README_Backup_${Date.now()}.md`).replace(/[\\/:*?"<>|]/g, '_');
          const targetDir = path.join(PROJECT_ROOT, 'Docs');
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
          const targetPath = path.join(targetDir, safeName);
          fs.writeFileSync(targetPath, content, 'utf-8');
          console.log(`✔ [另存文件] 已保存至: ${targetPath}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, savedPath: targetPath }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const url = `http://127.0.0.1:${port}`;
      console.log('\n+========================================================================+');
      console.log(`|\t🚀 README 智能双语精修工作台已启动！`);
      console.log(`|\t🌐 浏览器访问: \x1b[1m\x1b[32m${url}\x1b[0m`);
      console.log('|\t💡 提示: 浏览器已自动唤起，草稿尚未写入磁盘；');
      console.log('|\t         您可以在 Web 界面自由预览、输入修改建议进行多轮微调；');
      console.log('|\t         满意后点击右上角【💾 确认覆盖替换 README.md】完成写盘！');
      console.log('+========================================================================+\n');
      tryAutoOpenBrowser(url);
    });

    console.log('👉 在终端按 [ESC] 或 [q] 可安全退出 Web 工作台并返回 README 菜单...\n');
    const checkExit = async () => {
      while (true) {
        const key = await getKeyPress();
        if (key === 'ESC' || key === 'q') {
          server.close();
          console.log('\n🚪 README Web 服务已关闭。\n');
          resolve();
          break;
        }
      }
    };
    checkExit();
  });
}

const README_MENU_OPTIONS = [
  { id: 'scan', label: '🤖 README 智能体自主探索架构并生成主文档', desc: '基于 ReAct 循环自主探查全项目架构与源码，生成中英文文档' },
  { id: 'custom', label: '✏️  基于修改建议启动智能体审计精修', desc: '输入修改要求，Agent 自主查验相关源码并智能增删改' },
  { id: 'back', label: '🔙 返回总控主菜单', desc: '返回上一级高校后勤巡查e速办总控台' }
];

/**
 * 纯内存原子化渲染 README 管理控制台菜单
 */
function printReadmeMenu(cursorIndex = 0) {
  const info = getReadmeFileInfo();

  let out = '';
  out += '+========================================================================+\n';
  out += '|\t📖 README 文档智能管理与维护控制台 (README Manager)\n';
  out += `|\t📂 项目路径:\t${PROJECT_ROOT}\n`;
  out += `|\t📄 中文文档:\tREADME.md (${info.zhSize})\n`;
  out += `|\t📄 英文文档:\tREADME.en.md (${info.enSize})\n`;
  out += '+========================================================================+\n\n';

  README_MENU_OPTIONS.forEach((opt, idx) => {
    const isFocused = idx === cursorIndex;
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

/**
 * 主循环
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

  let cursorIndex = 0;

  while (true) {
    printReadmeMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      process.exit(0);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + README_MENU_OPTIONS.length) % README_MENU_OPTIONS.length;
      printReadmeMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % README_MENU_OPTIONS.length;
      printReadmeMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = README_MENU_OPTIONS[cursorIndex];

      if (selected.id === 'back') {
        process.exit(0);
      } else if (selected.id === 'scan') {
        await handleGenerateFromCodebase();
      } else if (selected.id === 'custom') {
        await handleUpdateWithSuggestion();
      }
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ README 管理控制台异常:', err);
  process.exit(1);
});
