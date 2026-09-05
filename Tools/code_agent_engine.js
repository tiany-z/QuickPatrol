/**
 * code_agent_engine.js
 * 
 * 高校后勤巡查e速办 v4.0 代码智能阅读与架构分析 Agent 核心引擎
 * 
 * 核心特性：
 *   1. 【ReAct 自主闭环】基于标准 OpenAI / DeepSeek Function Calling 协议，
 *      支持 Thought -> Tool Call -> Observation -> Reflection 多步自主探索；
 *   2. 【零外部依赖】纯 Node.js 原生 ES Modules 实现，无需安装任何 npm 包；
 *   3. 【代码感知工具箱】：
 *      - list_directory: 安全目录扫描与结构探索（自动过滤无关依赖与构建缓存）；
 *      - view_file: 文件精准切片阅读（带行号、支持起止行范围，防止单次请求塞爆窗口）；
 *      - grep_search: 全局/局部符号、类名、函数名检索；
 *      - get_outline: 快速抽取文件的类、接口、函数签名与类型定义骨架（无需阅读全部函数体）；
 *   4. 【双流式与事件驱动】提供 onThought、onToolCall、onToolResult、onFinalAnswer 等生命周期回调。
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, getAiConfig } from './config_helper.js';

// ----------------- 过滤规则 -----------------
export const IGNORED_DIRS = new Set([
  'node_modules', 'miniprogram_npm', '.git', '.gitee', '.vscode', 'dist', '.store', '.vite-temp',
  'coverage', 'temp', 'logs', 'build', '.system_generated', 'bin', 'obj'
]);

export const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.bmp',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.tar', '.zip', '.gz',
  '.log', '.lock', '.map', '.min.js', '.min.css'
]);

export const IGNORED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'tokenizer.json', 'llama tokenizer.json', 'qwen tokenizer.json'
]);

/**
 * 安全解析相对路径至项目绝对路径，防止路径遍历越界
 */
function resolveSafePath(relPath = '.') {
  let clean = (relPath || '.').trim().replace(/\\/g, '/');
  clean = clean.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '');
  const fullPath = path.resolve(PROJECT_ROOT, clean);
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    throw new Error(`路径越界非法: ${relPath}`);
  }
  return { fullPath, relPath: path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/') || '.' };
}

// ============================================================================
// 本地工具定义与执行实现
// ============================================================================

export const CODE_AGENT_TOOLS = {
  /**
   * 工具 1: 列出目录内容
   */
  list_directory: {
    definition: {
      type: 'function',
      function: {
        name: 'list_directory',
        description: '列出项目指定目录下的所有子文件与子文件夹。用于自主探索项目结构和模块划分。',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '相对于项目根目录的相对路径。如 "Host/HostApp" 或 "."（代表根目录）'
            }
          },
          required: ['path']
        }
      }
    },
    execute: async ({ path: targetPath }) => {
      try {
        const { fullPath, relPath } = resolveSafePath(targetPath);
        if (!fs.existsSync(fullPath)) {
          return `错误: 目录不存在 "${relPath}"`;
        }
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) {
          return `错误: "${relPath}" 是一个文件，不是目录。如需查看内容请使用 view_file 工具。`;
        }

        const entries = fs.readdirSync(fullPath, { withFileTypes: true });
        const dirs = [];
        const files = [];

        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
              dirs.push(`[DIR]  ${entry.name}`);
            }
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (!IGNORED_EXTENSIONS.has(ext) && !IGNORED_FILES.has(entry.name)) {
              try {
                const fStat = fs.statSync(path.join(fullPath, entry.name));
                const sizeKb = (fStat.size / 1024).toFixed(1);
                files.push(`[FILE] ${entry.name} (${sizeKb} KB)`);
              } catch {
                files.push(`[FILE] ${entry.name}`);
              }
            }
          }
        }

        dirs.sort();
        files.sort();
        const total = dirs.length + files.length;
        const result = [
          `目录: ${relPath} (共 ${dirs.length} 个子目录, ${files.length} 个有效代码文件):`,
          ...dirs,
          ...files
        ].join('\n');

        return result || `目录 ${relPath} 下无符合条件的代码文件。`;
      } catch (err) {
        return `执行 list_directory 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 2: 精准切片阅读文件内容
   */
  view_file: {
    definition: {
      type: 'function',
      function: {
        name: 'view_file',
        description: '查看指定代码文件的具体内容（带行号）。建议在已知关键文件后调用，支持通过 start_line 和 end_line 进行分段按需阅读。',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '相对于项目根目录的相对文件路径，例如 "Host/HostApp/src/drivers/new_chip/tx/txWorkerController.ts"'
            },
            start_line: {
              type: 'integer',
              description: '起始行号（从 1 开始，默认 1）'
            },
            end_line: {
              type: 'integer',
              description: '结束行号（默认 150，单次最多阅读 200 行以防止塞爆上下文）'
            }
          },
          required: ['file_path']
        }
      }
    },
    execute: async ({ file_path, start_line = 1, end_line = 150 }) => {
      try {
        const { fullPath, relPath } = resolveSafePath(file_path);
        if (!fs.existsSync(fullPath)) {
          return `错误: 文件不存在 "${relPath}"`;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          return `错误: "${relPath}" 是一个目录，请使用 list_directory 查看。`;
        }

        const ext = path.extname(fullPath).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) {
          return `错误: 不支持阅读二进制或非文本文件: ${relPath}`;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const totalLines = lines.length;

        const start = Math.max(1, parseInt(start_line, 10) || 1);
        let end = Math.max(start, parseInt(end_line, 10) || (start + 150));
        if (end - start > 200) {
          end = start + 200; // 单次硬性保护上限 200 行
        }
        const actualEnd = Math.min(totalLines, end);

        const slice = lines.slice(start - 1, actualEnd);
        const padLen = String(actualEnd).length;
        const formatted = slice.map((line, idx) => {
          const lineNum = String(start + idx).padStart(padLen, ' ');
          return `${lineNum} | ${line}`;
        }).join('\n');

        let summary = `文件: ${relPath} (总行数: ${totalLines} 行，当前展示: 第 ${start} ~ ${actualEnd} 行):\n`;
        summary += formatted;
        if (actualEnd < totalLines) {
          summary += `\n... [剩余 ${totalLines - actualEnd} 行未展示，如需继续请指定 start_line: ${actualEnd + 1}]`;
        }
        return summary;
      } catch (err) {
        return `执行 view_file 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 3: 搜索代码符号、函数名、类名或关键字
   */
  grep_search: {
    definition: {
      type: 'function',
      function: {
        name: 'grep_search',
        description: '在全项目或指定子目录中快速检索关键字、类名、函数名或接口定义。用于跨文件追踪引用、寻找调用方与实现方。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '要搜索的代码关键词、函数名、类型名或符号（如 "txWorkerController"、"onMessage"）'
            },
            path_prefix: {
              type: 'string',
              description: '可选限定搜索子目录。例如 "Host/HostApp" 或留空搜索全项目。'
            }
          },
          required: ['query']
        }
      }
    },
    execute: async ({ query, path_prefix = '' }) => {
      try {
        if (!query || !query.trim()) {
          return '错误: 搜索关键字 query 不能为空';
        }
        const q = query.trim().toLowerCase();
        const { fullPath, relPath } = resolveSafePath(path_prefix || '.');
        const matches = [];
        const maxMatches = 25;

        function searchDir(currentDir) {
          if (matches.length >= maxMatches) return;
          let entries = [];
          try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
          } catch {
            return;
          }

          for (const entry of entries) {
            if (matches.length >= maxMatches) break;
            const curFull = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              if (!IGNORED_DIRS.has(entry.name)) {
                searchDir(curFull);
              }
            } else {
              const ext = path.extname(entry.name).toLowerCase();
              if (IGNORED_EXTENSIONS.has(ext) || IGNORED_FILES.has(entry.name)) continue;

              try {
                const fStat = fs.statSync(curFull);
                if (fStat.size > 500 * 1024) continue; // 跳过 >500KB 巨型文件
                const text = fs.readFileSync(curFull, 'utf-8');
                if (text.toLowerCase().includes(q)) {
                  const lines = text.split(/\r?\n/);
                  const fileRel = path.relative(PROJECT_ROOT, curFull).replace(/\\/g, '/');
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(q)) {
                      matches.push(`${fileRel}:${i + 1}: ${lines[i].trim()}`);
                      if (matches.length >= maxMatches) break;
                    }
                  }
                }
              } catch {}
            }
          }
        }

        searchDir(fullPath);

        if (matches.length === 0) {
          return `在目录 "${relPath}" 下未找到包含 "${query}" 的匹配项。`;
        }

        let out = `搜索 "${query}" 找到 ${matches.length} 处匹配:\n`;
        out += matches.join('\n');
        if (matches.length >= maxMatches) {
          out += '\n... (已达最大匹配展示上限 25 处)';
        }
        return out;
      } catch (err) {
        return `执行 grep_search 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 4: 快速提取代码文件骨架 (Outline)
   */
  get_outline: {
    definition: {
      type: 'function',
      function: {
        name: 'get_outline',
        description: '快速提取一个代码文件的结构大纲（提取 import、export、class、interface、type、function 签名声明）。无需阅读几百行实现即可秒级掌握模块功能与对外接口。',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '相对于项目根目录的文件路径。例如 "Host/HostApp/src/drivers/new_chip/tx/txWorkerController.ts"'
            }
          },
          required: ['file_path']
        }
      }
    },
    execute: async ({ file_path }) => {
      try {
        const { fullPath, relPath } = resolveSafePath(file_path);
        if (!fs.existsSync(fullPath)) {
          return `错误: 文件不存在 "${relPath}"`;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          return `错误: "${relPath}" 是目录，不是文件。`;
        }

        const ext = path.extname(fullPath).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) {
          return `错误: 二进制文件无法提取大纲: ${relPath}`;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const outlineItems = [];

        // 识别特征前缀的轻量骨架匹配
        const outlineRegex = /^\s*(export\s+(default\s+)?(class|interface|type|enum|function|const|let|var|abstract\s+class)|class\s+|interface\s+|type\s+|function\s+|async\s+function|#include|import\s+)/;

        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (outlineRegex.test(trimmed)) {
            const display = trimmed.length > 120 ? trimmed.substring(0, 120) + '...' : trimmed;
            outlineItems.push(`行 ${index + 1}: ${display}`);
          }
        });

        if (outlineItems.length === 0) {
          return `文件 ${relPath} (共 ${lines.length} 行) 未检测到明显的类、接口或顶层函数声明，建议使用 view_file 查看。`;
        }

        return `文件 ${relPath} 结构大纲 (总共 ${lines.length} 行，提取关键声明 ${outlineItems.length} 处):\n` + outlineItems.slice(0, 50).join('\n');
      } catch (err) {
        return `执行 get_outline 失败: ${err.message}`;
      }
    }
  }
};

/**
 * 获取发送给大模型 API 的 tools 规格数组
 */
export function getApiToolsArray() {
  return Object.values(CODE_AGENT_TOOLS).map(t => t.definition);
}

// ============================================================================
// ReAct Agent 运行调度器
// ============================================================================

/**
 * 启动代码阅读 AI Agent 执行循环
 */
export async function runCodeReadingAgent(options) {
  const {
    userGoal,
    targetRelPath = '.',
    maxSteps = 12,
    conversationHistory = [],
    signal = null,
    onThought = () => {},
    onToolCall = () => {},
    onToolResult = () => {},
    onFinalAnswer = () => {},
    onStep = () => {}
  } = options;

  const aiConfig = getAiConfig();
  if (!aiConfig.apiKey) {
    throw new Error('未配置 AI API Key，请先在配置中心完成设置！');
  }

  const url = aiConfig.apiBase.endsWith('/v1')
    ? `${aiConfig.apiBase}/chat/completions`
    : `${aiConfig.apiBase}/v1/chat/completions`;

  const systemPrompt = `你是一个精通全栈工程与分布式架构的顶级代码架构师与技术专家。
当前正在深入探索并解析高校后勤巡查e速办 (QuickPatrol) 代码库。

【你的能力与工具】：
你可以通过调用以下工具自主探索项目源码：
1. list_directory: 列出指定目录结构，探索子模块
2. get_outline: 快速提取代码文件的类型/接口/类/函数大纲骨架
3. view_file: 精准按行阅读核心源码文件
4. grep_search: 在代码库中跨文件搜索函数名、类名、变量名或关键逻辑

【工作原则与策略】：
1. 绝对不要靠猜想或凭空捏造。每一处架构结论必须建立在你通过工具查阅到的真实代码之上！
2. 遵循自顶向下与重点突破：先用 list_directory 了解模块划分，再用 get_outline 快速定位核心类与接口，最后用 view_file 细读关键实现。
3. 当你掌握了充分的真实代码证据后，停止调用工具，直接输出一份高水准、结构严谨、详略得当的 Markdown 架构解析报告。
4. 最终报告需包含：
   - 🎯 模块定位与核心使命
   - 🏗️ 系统架构图（ASCII 或 Mermaid）与分层设计
   - 🔑 核心数据结构、核心类与关键接口清单
   - 🔄 关键执行流程与时序（如调用链路、通信协议、状态流转）
   - 💡 关键代码实现亮点与技术考量（附带真实行号与文件路径引用）`;

  const initialUserPrompt = targetRelPath && targetRelPath !== '.'
    ? `请针对项目子目录/模块【${targetRelPath}】展开深度架构解析。\n【用户具体关注点/目标】：${userGoal || '全面剖析该模块的设计架构、核心类与数据流'}`
    : `【用户具体关注点/目标】：${userGoal || '全面剖析高校后勤巡查e速办整体架构与核心服务交互机制'}`;

  // 提取清洗后的前序多轮历史（保留最近 6 条核心问答，过滤掉中间冗长中间步骤）
  const sanitizedHistory = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-6);
    for (const msg of recent) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const text = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (text) {
          sanitizedHistory.push({
            role: msg.role,
            content: text.length > 4000 ? text.substring(0, 4000) + '\n... [前序总结已截断]' : text
          });
        }
      }
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...sanitizedHistory,
    { role: 'user', content: initialUserPrompt }
  ];

  const toolsArray = getApiToolsArray();

  let step = 0;
  let finalMarkdownReport = '';

  while (step < maxSteps) {
    if (signal?.aborted) {
      throw new Error('用户中止了本次智能体探索。');
    }

    step++;
    onStep(step, maxSteps);

    const requestBody = {
      model: aiConfig.model,
      messages,
      tools: toolsArray,
      tool_choice: 'auto'
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: signal || undefined
      });
    } catch (netErr) {
      if (signal?.aborted) {
        throw new Error('用户中止了本次智能体探索。');
      }
      throw new Error(`网络连接失败: ${netErr.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI 接口返回错误 (HTTP ${response.status}): ${errText}`);
    }

    const responseJson = await response.json();
    const choice = responseJson.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error('AI 接口未返回有效的 choices 结果');
    }

    const assistantMsg = choice.message;

    // 捕获思考链 (DeepSeek reasoning_content 或 message.content)
    const reasoning = assistantMsg.reasoning_content || '';
    const content = assistantMsg.content || '';
    if (reasoning) {
      onThought(reasoning);
    } else if (content && (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0)) {
      // 最终回复内容
    }

    const toolCalls = assistantMsg.tool_calls;

    // 如果模型没有触发工具调用，则说明模型自主认为已经收集充足，直接产出报告！
    if (!toolCalls || toolCalls.length === 0) {
      finalMarkdownReport = cleanMarkdownReport(content || reasoning);
      onFinalAnswer(finalMarkdownReport);
      break;
    }

    // 关键兼容：将 assistant 消息原封不动追加到上下文中 (包含 reasoning_content 与 tool_calls)
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || '',
      ...(assistantMsg.reasoning_content ? { reasoning_content: assistantMsg.reasoning_content } : {}),
      tool_calls: assistantMsg.tool_calls
    });

    // 顺序执行模型请求调用的工具
    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(call.function?.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      onToolCall(fnName, fnArgs);

      const toolImpl = CODE_AGENT_TOOLS[fnName];
      let executionResult = '';

      if (toolImpl && typeof toolImpl.execute === 'function') {
        try {
          executionResult = await toolImpl.execute(fnArgs);
        } catch (execErr) {
          executionResult = `执行工具 ${fnName} 发生异常: ${execErr.message}`;
        }
      } else {
        executionResult = `未找到对应工具: ${fnName}`;
      }

      // 生成简短摘要供控制台打印
      const summaryLine = executionResult.split('\n')[0].substring(0, 100);
      onToolResult(fnName, summaryLine);

      // 将工具执行结果以 role: "tool" 追加回上下文
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: executionResult
      });
    }
  }

  // 如果达到 maxSteps 循环结束但仍未产出最终文本，进行显式终章收束调用
  if (!finalMarkdownReport) {
    onThought('已完成预定深度的多轮代码探索，正在根据所有查阅事实进行架构综合研判与报告撰写...');
    messages.push({
      role: 'user',
      content: '多轮代码检索与符号追踪已全部完成。现在请停止调用任何工具，全面结合上述查阅到的全部真实源码事实、类与方法定义，撰写一份结构严谨、细节详实的 Markdown 架构解析报告。'
    });

    const finalRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages
      }),
      signal: signal || undefined
    });

    if (finalRes.ok) {
      const finalJson = await finalRes.json();
      const rawText = finalJson.choices?.[0]?.message?.content || finalJson.choices?.[0]?.message?.reasoning_content || '未能生成有效报告。';
      finalMarkdownReport = cleanMarkdownReport(rawText);
      onFinalAnswer(finalMarkdownReport);
    }
  }

  return finalMarkdownReport;
}

/**
 * 清理可能遗留的内部工具标签
 */
function cleanMarkdownReport(text) {
  if (!text) return '';
  let cleaned = text.replace(/<｜｜DSML｜｜[\s\S]*?<\/｜｜DSML｜｜invoke>/g, '');
  cleaned = cleaned.replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '');
  cleaned = cleaned.replace(/<｜tool_calls｜>[\s\S]*?<｜\/tool_calls｜>/g, '');
  cleaned = cleaned.replace(/<｜tool_calls｜>[\s\S]*?$/g, '');
  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  return cleaned.trim();
}

