/**
 * readme_agent_engine.js
 * 
 * 高校后勤巡查e速办 v4.0 项目文档与架构维护 Agent 核心引擎
 * 
 * 核心特性：
 *   1. 【ReAct 自主推理闭环】基于标准 Function Calling 协议，
 *      支持 Thought -> Tool Call -> Observation -> Reflection 多步自主探索；
 *   2. 【零外部依赖】纯 Node.js 原生 ES Modules 实现；
 *   3. 【代码与文档感知工具箱】：
 *      - list_directory: 安全探索项目各子领域（Backend, WeChatMiniProgram, Docs, Tools）目录结构；
 *      - view_file: 精准阅读配置文件（package.json、tsconfig等）或核心源码片段；
 *      - get_outline: 秒级提取模块的类、接口、函数签名与类型定义；
 *      - grep_search: 全局检索端口、环境变量、通信协议、脚本入口与服务路由；
 *      - read_existing_readme: 精确读取当前 README.md / README.en.md 内容以评估保留与增量。
 *   4. 【双向驱动】支持在终端交互与 Web Studio 中驱动，并提供多维度生命周期回调。
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
// README Agent 本地工具定义与执行实现
// ============================================================================

export const README_AGENT_TOOLS = {
  /**
   * 工具 1: 列出目录内容
   */
  list_directory: {
    definition: {
      type: 'function',
      function: {
        name: 'list_directory',
        description: '列出项目指定目录下的所有子文件与子文件夹。用于自主探索项目结构和各子系统模块划分。',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '相对于项目根目录的相对路径。如 "Host/HostApp" 或 "."（代表项目根目录）'
            }
          },
          required: ['path']
        }
      }
    },
    execute: async ({ path: targetPath = '.' }) => {
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
              files.push(`[FILE] ${entry.name}`);
            }
          }
        }

        dirs.sort();
        files.sort();

        let out = `目录 "${relPath}" 下的内容 (共 ${dirs.length} 个子目录, ${files.length} 个文件):\n`;
        out += [...dirs, ...files].join('\n');
        return out;
      } catch (err) {
        return `执行 list_directory 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 2: 精准按行阅读源码/配置文件/文档
   */
  view_file: {
    definition: {
      type: 'function',
      function: {
        name: 'view_file',
        description: '按行读取指定文件的代码或配置内容（带行号），支持通过 start_line 和 line_count 进行切片阅读。可用于读取 package.json、CMakeLists.txt、核心服务入口或配置。',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '相对于项目根目录的文件路径。如 "package.json"、"Backend/BackendApp/package.json"、"Tools/TOOL_MENU.js"'
            },
            start_line: {
              type: 'number',
              description: '起始行号 (从 1 开始，默认 1)'
            },
            line_count: {
              type: 'number',
              description: '要读取的行数 (默认 80 行，最大支持 200 行)'
            }
          },
          required: ['file_path']
        }
      }
    },
    execute: async ({ file_path, start_line = 1, line_count = 80 }) => {
      try {
        const { fullPath, relPath } = resolveSafePath(file_path);
        if (!fs.existsSync(fullPath)) {
          return `错误: 文件不存在 "${relPath}"`;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          return `错误: "${relPath}" 是目录不是文件。如需查看目录结构请使用 list_directory 工具。`;
        }

        const ext = path.extname(fullPath).toLowerCase();
        if (IGNORED_EXTENSIONS.has(ext)) {
          return `错误: 二进制文件无法直接查看内容: ${relPath}`;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const total = lines.length;

        const start = Math.max(1, Math.min(start_line || 1, total));
        const count = Math.max(1, Math.min(line_count || 80, 200));
        const end = Math.min(total, start + count - 1);

        const sliced = lines.slice(start - 1, end).map((l, idx) => {
          const lineNum = String(start + idx).padStart(4, ' ');
          return `${lineNum} | ${l}`;
        });

        return `文件 "${relPath}" (总行数: ${total} 行，当前展示第 ${start} ~ ${end} 行):\n` + sliced.join('\n');
      } catch (err) {
        return `执行 view_file 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 3: 提取代码/配置文件骨架
   */
  get_outline: {
    definition: {
      type: 'function',
      function: {
        name: 'get_outline',
        description: '快速提取一个源码文件的结构大纲（提取 import、export、class、interface、function 声明与服务路由）。秒级掌握模块功能与对外接口。',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '相对于项目根目录的文件路径。如 "Backend/BackendApp/src/app.ts"'
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

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const outlineItems = [];
        const outlineRegex = /^\s*(export\s+(default\s+)?(class|interface|type|enum|function|const|let|var|abstract\s+class)|class\s+|interface\s+|type\s+|function\s+|async\s+function|#include|import\s+|app\.(get|post|put|delete|use))/;

        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (outlineRegex.test(trimmed)) {
            const display = trimmed.length > 120 ? trimmed.substring(0, 120) + '...' : trimmed;
            outlineItems.push(`行 ${index + 1}: ${display}`);
          }
        });

        if (outlineItems.length === 0) {
          return `文件 ${relPath} (共 ${lines.length} 行) 未检测到明显的接口或顶层声明，建议使用 view_file 查看。`;
        }

        return `文件 ${relPath} 结构大纲 (总共 ${lines.length} 行，提取关键声明 ${outlineItems.length} 处):\n` + outlineItems.slice(0, 50).join('\n');
      } catch (err) {
        return `执行 get_outline 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 4: 跨项目搜索端口、配置、路由或关键字
   */
  grep_search: {
    definition: {
      type: 'function',
      function: {
        name: 'grep_search',
        description: '在全项目或指定子目录中检索关键字、端口配置、服务名或环境变量（如 "3000"、"VirtualChip"、"POSTGRES" 等）。用于精确定位技术参数。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键字。如 "PORT", "9091", "ReAct", "buddy_alloc"'
            },
            path_prefix: {
              type: 'string',
              description: '可选限定搜索子目录。例如 "Backend" 或 "Host"，留空搜索全项目。'
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
        const maxMatches = 20;

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
                if (fStat.size > 500 * 1024) continue;
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
        return out;
      } catch (err) {
        return `执行 grep_search 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 5: 读取现有 README 现有内容
   */
  read_existing_readme: {
    definition: {
      type: 'function',
      function: {
        name: 'read_existing_readme',
        description: '读取当前项目根目录下的现有 README.md (中文版) 或 README.en.md (英文版)。用于评估已有技术描述、架构图以及哪些内容需要保留或增量修改。',
        parameters: {
          type: 'object',
          properties: {
            lang: {
              type: 'string',
              description: '语言版本: "zh" 表示 README.md，"en" 表示 README.en.md'
            }
          },
          required: ['lang']
        }
      }
    },
    execute: async ({ lang = 'zh' }) => {
      try {
        const fileName = lang === 'en' ? 'README.en.md' : 'README.md';
        const targetPath = path.join(PROJECT_ROOT, fileName);
        if (!fs.existsSync(targetPath)) {
          return `提示: 根目录下当前尚未创建 ${fileName} 文件。`;
        }
        const text = fs.readFileSync(targetPath, 'utf-8');
        if (text.length > 12000) {
          return `【${fileName} 现有内容 (前 12000 字符)】:\n` + text.substring(0, 12000) + '\n... [后续内容已截断]';
        }
        return `【${fileName} 现有内容】:\n` + text;
      } catch (err) {
        return `读取 README 失败: ${err.message}`;
      }
    }
  }
};

/**
 * 获取发送给大模型 API 的 tools 规格数组
 */
export function getReadmeApiToolsArray() {
  return Object.values(README_AGENT_TOOLS).map(t => t.definition);
}

/**
 * 清洗 AI 返回的 Markdown
 */
function cleanMarkdownOutput(raw) {
  let text = (raw || '').trim();
  if (text.startsWith('```markdown') && text.endsWith('```')) {
    text = text.replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim();
  } else if (text.startsWith('```md') && text.endsWith('```')) {
    text = text.replace(/^```md\n?/, '').replace(/\n?```$/, '').trim();
  } else if (text.startsWith('```') && text.endsWith('```')) {
    text = text.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return text;
}

// ============================================================================
// README ReAct Agent 运行调度器
// ============================================================================

/**
 * 运行 README 专属 ReAct 智能体
 * 
 * @param {Object} options
 * @param {'generate'|'refine'} options.mode - 'generate' (全量生成) 或 'refine' (基于建议增量精修)
 * @param {'zh'|'en'} options.lang - 文档语言版本 ('zh' 或 'en')
 * @param {string} options.userSuggestion - 用户修改建议 (用于 refine 或特定定制需求)
 * @param {string} options.currentContent - 当前文档草稿 (用于 refine)
 * @param {number} options.maxSteps - 最大探索步数 (默认 10 步)
 * @param {AbortSignal} options.signal - 取消信号
 * @param {Function} options.onStep - 步数回调 (step, maxSteps)
 * @param {Function} options.onThought - 智能体思考回调 (thoughtText)
 * @param {Function} options.onToolCall - 工具调用回调 (toolName, toolArgs)
 * @param {Function} options.onToolResult - 工具执行结果回调 (toolName, summary)
 * @param {Function} options.onFinalAnswer - 最终产物回调 (markdown)
 */
export async function runReadmeAgent(options) {
  const {
    mode = 'generate',
    lang = 'zh',
    userSuggestion = '',
    currentContent = '',
    maxSteps = 10,
    signal = null,
    onStep = () => {},
    onThought = () => {},
    onToolCall = () => {},
    onToolResult = () => {},
    onFinalAnswer = () => {}
  } = options;

  const aiConfig = getAiConfig();
  if (!aiConfig.apiKey) {
    throw new Error('未配置 AI API Key，请先在配置中心完成设置！');
  }

  const url = aiConfig.apiBase.endsWith('/v1')
    ? `${aiConfig.apiBase}/chat/completions`
    : `${aiConfig.apiBase}/v1/chat/completions`;

  const isZh = lang === 'zh';
  const targetDocName = isZh ? 'README.md (中文技术文档)' : 'README.en.md (English Technical Documentation)';

  const systemPrompt = `你是一个顶级开源软件系统架构师与全栈技术文档专家。
你的任务是为高校后勤巡查e速办 (QuickPatrol) v4.0 打造业内最高水准、内容详实、排版精美的项目主文档 【${targetDocName}】。

【你的能力与工具库】：
你可以自主调用以下工具探查真实工程代码：
1. list_directory: 列出项目目录与子模块，探索整体与局部架构；
2. view_file: 查看核心模块的关键代码、package.json 依赖与启动脚本；
3. get_outline: 提取模块接口与类骨架，秒级掌握系统设计；
4. grep_search: 全局检索端口号、服务路由、通信协议与配置；
5. read_existing_readme: 读取当前项目根目录已有的 README 内容以供参考与对比。

【工作规范与核心要求】：
1. 绝对不要凭空捏造技术细节或参数！通过工具查证真实的子系统结构、端口、依赖与调用链路。
2. 文档需涵盖：
   - 🎯 项目定位与核心技术栈徽标/简介
   - 🏗️ 完整系统架构图（ASCII 架构图 或 Mermaid 流程图，展示 WeChatMiniProgram 微信小程序端、Backend 后端微服务群、MySQL 8.x、Redis、Tools 运维总控台）
   - 📂 目录规范（覆盖 4 大领域：Backend, WeChatMiniProgram, Docs, Tools 目录职能）
   - ⚡ 核心特色技术剖析（微信小程序双身份工单闭环、Express 5 + TypeScript、MySQL 8.x 连接池、单句自动提交补偿回滚引擎、AST 动态查询、WebSocket 实时告警广播）
   - 🚀 快速启动指南与服务端口对照表（后端 3000 端口、环境变量、微信开发者工具启动方式）
   - 🛠️ 运维与测试工具箱介绍（Tools 自动化脚本与 Vitest 40 个单元测试运行）
3. 在获取足够真实代码证据后，停止调用工具，直接输出结构严谨、排版专业的 Markdown 完整正文，不要输出多余的寒暄与闲聊。`;

  let initialUserPrompt = '';
  if (mode === 'refine') {
    initialUserPrompt = `【任务目标】：基于用户提出的具体要求，精准修订并优化项目主文档 【${targetDocName}】。\n\n` +
      `【用户的具体修改要求】：\n"${userSuggestion}"\n\n` +
      `【当前文档草稿内容】：\n\`\`\`markdown\n${(currentContent || '').substring(0, 15000)}\n\`\`\`\n\n` +
      `请结合工具自主核对用户修改建议中涉及的真实源码或配置，确保修订后的技术细节严谨真实，然后输出优化后的完整 Markdown 文档。`;
  } else {
    initialUserPrompt = `【任务目标】：请自主探索高校后勤巡查e速办 (QuickPatrol) 代码库与系统配置，为本项目编写一份极高专业度、格式优雅、覆盖全子系统的完整主文档 【${targetDocName}】。\n` +
      (userSuggestion ? `【额外关注点/用户补充要求】：${userSuggestion}\n` : '') +
      `请先使用 list_directory 和 view_file 等工具探查真实项目结构与核心模块，完成事实求证后输出最终 Markdown 全文。`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialUserPrompt }
  ];

  const toolsArray = getReadmeApiToolsArray();

  let step = 0;
  let finalMarkdown = '';
  const toolExecutions = [];

  while (step < maxSteps) {
    if (signal?.aborted) {
      throw new Error('用户中止了本次 README 智能体任务。');
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
        throw new Error('用户中止了本次 README 智能体任务。');
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

    // 捕获思考链
    const reasoning = assistantMsg.reasoning_content || '';
    const content = assistantMsg.content || '';
    if (reasoning) {
      onThought(reasoning);
    } else if (content && (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0)) {
      onThought('已完成项目证据核实，正在合成规范技术文档...');
    }

    messages.push(assistantMsg);

    // 判断模型是否需要调用工具
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const toolCall of assistantMsg.tool_calls) {
        if (signal?.aborted) {
          throw new Error('用户中止了本次 README 智能体任务。');
        }

        const toolName = toolCall.function?.name;
        let toolArgs = {};
        try {
          toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
        } catch {
          toolArgs = {};
        }

        onToolCall(toolName, toolArgs);

        let toolResult = '';
        const toolDef = README_AGENT_TOOLS[toolName];
        if (toolDef) {
          try {
            toolResult = await toolDef.execute(toolArgs);
          } catch (execErr) {
            toolResult = `工具执行报错: ${execErr.message}`;
          }
        } else {
          toolResult = `错误: 未知工具 "${toolName}"`;
        }

        const summary = typeof toolResult === 'string' && toolResult.length > 300
          ? toolResult.substring(0, 300) + '...'
          : toolResult;

        toolExecutions.push({ name: toolName, args: toolArgs, summary });
        onToolResult(toolName, summary);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        });
      }
    } else {
      // 无工具调用，获得最终正文
      finalMarkdown = cleanMarkdownOutput(content);
      onFinalAnswer(finalMarkdown);
      break;
    }
  }

  // 达到步数上限但未自然收敛时的兜底总结
  if (!finalMarkdown && step >= maxSteps) {
    onThought('已达到最大探索步数，正在根据已掌握的所有工程事实总结生成文档...');
    messages.push({
      role: 'user',
      content: '你已完成所有的工具探索，请立即根据前文收集的所有真实工程信息，输出最终完整的 Markdown 文档正文。'
    });

    const finalRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages,
        temperature: 0.2
      }),
      signal: signal || undefined
    });

    if (finalRes.ok) {
      const json = await finalRes.json();
      finalMarkdown = cleanMarkdownOutput(json.choices?.[0]?.message?.content || '');
      onFinalAnswer(finalMarkdown);
    }
  }

  return {
    markdown: finalMarkdown,
    toolExecutions,
    steps: step
  };
}
