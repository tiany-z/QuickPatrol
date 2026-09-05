/**
 * work_report_agent_engine.js
 * 
 * 高校后勤巡查e速办 v4.0 研发成果与工作报告智能体 (Work Report AI Agent) 核心引擎
 * 
 * 核心特性：
 *   1. 【ReAct 自主推理闭环】基于标准 Function Calling 协议，
 *      支持 Thought -> Tool Call -> Observation -> Reflection 多步自主审计；
 *   2. 【零外部依赖】纯 Node.js 原生 ES Modules 实现；
 *   3. 【Git 事实与工程代码审计工具箱】：
 *      - query_git_commits: 检索指定分支与周期内的提交清单；
 *      - inspect_commit_diff: 深度审查特定 Commit 或指定文件的实际代码变更 Diff；
 *      - view_source_file: 阅读修改涉及的核心工程源码，理解改动意图与技术深度；
 *      - grep_codebase: 检索关联类、接口或调用点，评估改动的系统影响面；
 *      - read_current_draft: 读取当前报告草稿，定位增量精修点。
 *   4. 【多端协同驱动】支持在终端交互与 Web Studio 中驱动，提供多维度实时生命周期回调。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, getAiConfig } from './config_helper.js';

// ----------------- 过滤规则 -----------------
export const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.gitee', '.vscode', 'dist', '.store', '.vite-temp',
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

/**
 * 执行 Git 命令并返回 UTF-8 字符串
 */
function git(args, options = {}) {
  try {
    const res = spawnSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 30 * 1024 * 1024,
      ...options
    });
    return (res.stdout || '').trim();
  } catch {
    return '';
  }
}

// ============================================================================
// 工作报告 Agent 本地工具定义与执行实现
// ============================================================================

export const WORK_REPORT_TOOLS = {
  /**
   * 工具 1: 检索提交历史列表
   */
  query_git_commits: {
    definition: {
      type: 'function',
      function: {
        name: 'query_git_commits',
        description: '检索指定分支或时间范围内的 Git 提交历史记录，获取 Commit Hash、作者、提交时间与标题。',
        parameters: {
          type: 'object',
          properties: {
            branch: {
              type: 'string',
              description: 'Git 分支名称。例如 "new-version" 或 "main"'
            },
            limit: {
              type: 'number',
              description: '返回的最大提交记录数（默认 20 条）'
            },
            author: {
              type: 'string',
              description: '可选指定过滤的作者姓名或邮箱'
            }
          }
        }
      }
    },
    execute: async ({ branch = 'HEAD', limit = 20, author = '' }) => {
      try {
        const args = ['log', branch, `-n`, String(Math.min(limit || 20, 50)), '--format=%H|%an|%ad|%s', '--date=iso'];
        if (author) {
          args.push(`--author=${author}`);
        }
        const output = git(args);
        if (!output) {
          return `在分支 "${branch}" 上未检索到匹配的提交记录。`;
        }
        const lines = output.split('\n').filter(Boolean);
        const commits = lines.map((l, idx) => {
          const [sha, an, ad, s] = l.split('|');
          return `[${idx + 1}] SHA: ${sha?.substring(0, 8)} | 作者: ${an} | 时间: ${ad?.substring(0, 16)} | 标题: ${s}`;
        });
        return `检索到 ${commits.length} 条提交记录:\n` + commits.join('\n');
      } catch (err) {
        return `执行 query_git_commits 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 2: 深入审查具体 Commit 或特定文件的真实 Diff
   */
  inspect_commit_diff: {
    definition: {
      type: 'function',
      function: {
        name: 'inspect_commit_diff',
        description: '获取指定 Commit 的真实代码 Diff 差异或统计摘要。用于深入核查算法重构、Bug 修复、新增特性等硬核实现细节。',
        parameters: {
          type: 'object',
          properties: {
            commit_sha: {
              type: 'string',
              description: '要审查的 Commit SHA 或短 Hash (如 "a1b2c3d")'
            },
            file_path: {
              type: 'string',
              description: '可选指定只查看该 commit 中特定文件的 diff'
            },
            stat_only: {
              type: 'boolean',
              description: '是否仅返回修改文件统计（如变动行数），默认 false 返回具体差异'
            }
          },
          required: ['commit_sha']
        }
      }
    },
    execute: async ({ commit_sha, file_path = '', stat_only = false }) => {
      try {
        if (!commit_sha) return '错误: 缺少 commit_sha 参数';
        const sha = commit_sha.trim();

        if (stat_only) {
          const statOut = git(['show', '--stat', '--oneline', sha]);
          return `Commit [${sha}] 改动统计:\n${statOut || '无统计输出'}`;
        }

        const args = ['show', '--format=%H (%an - %ad): %s', sha];
        if (file_path) {
          args.push('--', file_path);
        }

        let diff = git(args);
        if (!diff) {
          return `未找到 Commit [${sha}] 的 Diff 内容。`;
        }
        if (diff.length > 8000) {
          diff = diff.substring(0, 8000) + '\n... [Diff 超长已安全截断，已获取前 8000 字符核心改动]';
        }
        return diff;
      } catch (err) {
        return `执行 inspect_commit_diff 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 3: 阅读涉及修改的核心源码文件
   */
  view_source_file: {
    definition: {
      type: 'function',
      function: {
        name: 'view_source_file',
        description: '阅读代码仓库中特定源码文件的内容片段（带行号），理解该模块的设计模式、对外 API 或核心实现逻辑。',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '相对于项目根目录的文件路径。如 "Host/HostApp/src/drivers/..." 或 "Tools/TOOL_RUN_ALL_TESTS.js"'
            },
            start_line: {
              type: 'number',
              description: '起始行号 (默认 1)'
            },
            line_count: {
              type: 'number',
              description: '读取行数 (默认 60 行，最大 150 行)'
            }
          },
          required: ['file_path']
        }
      }
    },
    execute: async ({ file_path, start_line = 1, line_count = 60 }) => {
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
          return `错误: 二进制文件无法直接读取: ${relPath}`;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const total = lines.length;

        const start = Math.max(1, Math.min(start_line || 1, total));
        const count = Math.max(1, Math.min(line_count || 60, 150));
        const end = Math.min(total, start + count - 1);

        const sliced = lines.slice(start - 1, end).map((l, idx) => {
          const lineNum = String(start + idx).padStart(4, ' ');
          return `${lineNum} | ${l}`;
        });

        return `文件 "${relPath}" (总行数: ${total} 行，展示第 ${start} ~ ${end} 行):\n` + sliced.join('\n');
      } catch (err) {
        return `执行 view_source_file 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 4: 跨项目检索代码符号或关联逻辑
   */
  grep_codebase: {
    definition: {
      type: 'function',
      function: {
        name: 'grep_codebase',
        description: '在全项目或指定子目录中检索关键字、类名、函数名或配置项。用于评估改动的系统影响面与调用链。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词。如 "buddy_allocator"、"VirtualChip"、"ReAct"'
            },
            path_prefix: {
              type: 'string',
              description: '可选限定子目录路径。如 "Host" 或 "Backend"'
            }
          },
          required: ['query']
        }
      }
    },
    execute: async ({ query, path_prefix = '' }) => {
      try {
        if (!query || !query.trim()) return '错误: 搜索关键字不能为空';
        const q = query.trim().toLowerCase();
        const { fullPath, relPath } = resolveSafePath(path_prefix || '.');
        const matches = [];
        const maxMatches = 15;

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
          return `未找到包含 "${query}" 的匹配项。`;
        }

        let out = `搜索 "${query}" 匹配到 ${matches.length} 处:\n` + matches.join('\n');
        return out;
      } catch (err) {
        return `执行 grep_codebase 失败: ${err.message}`;
      }
    }
  },

  /**
   * 工具 5: 查看当前工作报告草稿
   */
  read_current_draft: {
    definition: {
      type: 'function',
      function: {
        name: 'read_current_draft',
        description: '在多轮增量精修阶段，读取当前正在审阅的工作报告草稿内容，以便定位需要调整、补充或重写的章节。',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    execute: async () => {
      // 执行时由闭包 context 提供当前草稿
      return `当前报告草稿见上下文。`;
    }
  }
};

/**
 * 获取发送给大模型 API 的 tools 规格数组
 */
export function getWorkReportApiToolsArray() {
  return Object.values(WORK_REPORT_TOOLS).map(t => t.definition);
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
// 工作报告 ReAct Agent 运行调度器
// ============================================================================

/**
 * 运行工作报告专属 ReAct 智能体
 * 
 * @param {Object} options
 * @param {'generate'|'refine'} options.mode - 'generate' 或 'refine'
 * @param {Object} options.reportContext - 统计上下文 { timeRange, userData, selectedBranches }
 * @param {string} options.userSuggestion - 用户修改指令或要求
 * @param {string} options.currentDraft - 当前报告草稿
 * @param {number} options.maxSteps - 最大探索步数 (默认 10 步)
 * @param {AbortSignal} options.signal - 取消信号
 * @param {Function} options.onStep - 步数回调 (step, maxSteps)
 * @param {Function} options.onThought - 思考回调 (thoughtText)
 * @param {Function} options.onToolCall - 工具调用回调 (toolName, toolArgs)
 * @param {Function} options.onToolResult - 工具结果回调 (toolName, summary)
 * @param {Function} options.onFinalAnswer - 最终产物回调 (markdown)
 */
export async function runWorkReportAgent(options) {
  const {
    mode = 'generate',
    reportContext = {},
    userSuggestion = '',
    currentDraft = '',
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

  const { timeRange = {}, userData = {}, selectedBranches = [] } = reportContext;
  const userName = userData.userName || '当前开发者';
  const userEmail = userData.userEmail || '';
  const timeTitle = timeRange.title || '研发工作报告';
  const timeDisplay = timeRange.timeDisplay || '近期';

  const systemPrompt = `你是一位顶级科技大厂的资深技术总监与工程效能专家。
你的任务是为开发者【${userName}】生成一份结构极其严谨、技术亮点鲜明、数据真实、富有工程价值的高水准工作总结报告（Markdown 格式）。

【你的能力与审计工具库】：
你可以自主调用以下工具探查真实工程证据与代码改动：
1. query_git_commits: 检索指定分支与周期内的提交清单；
2. inspect_commit_diff: 查看关键 commit 的具体代码 diff 差异，掌握硬核技术细节；
3. view_source_file: 阅读修改涉及的核心工程源码，理解设计模式与业务流转；
4. grep_codebase: 检索关联类、接口或调用点，评估改动的系统影响面；
5. read_current_draft: 阅读当前报告草稿定位需要调整的内容。

【报告结构规范要求】：
# ${userName} - ${timeTitle}
> 统计周期：${timeDisplay} | 提交者：${userName} (${userEmail}) | 统计分支：${selectedBranches.join(', ')}

## 一、 工作总体概览 (Executive Summary)
- 简明扼要概括本周期的核心产出、技术推进里程碑与重点攻坚领域（150~250字）。
- 提炼关键量化指标（完成 Commit 数、核心模块突破数、修复缺陷数等）。

## 二、 核心功能开发与技术落地 (Key Achievements & Features)
- 结合真实代码与 diff，分模块深度阐述攻坚的技术成果（如 Host 驱动伙伴算法、流水线并发、VirtualChip 仿真、ReAct Agent 架构闭环等）。
- 明确讲清解决的技术痛点、关键设计思想与核心收益。

## 三、 代码重构、修复与质量保证 (Bug Fixes & Refactoring)
- 归纳关键问题定位、逻辑漏洞修复、工程规范化及自动化测试落地。

## 四、 本周期详细提交足迹 (Commit History Timeline)
- 整理出条理清晰的 Commit 时间线表格。

## 五、 后续工作计划与展望 (Next Steps & Plan)
- 针对当前架构现状，规划下一阶段的技术攻坚目标。

【工作准则】：
- 每一个技术亮点的阐述必须有具体的代码或 diff 作为事实支撑，禁止假大空。
- 获取充分证据后，停止调用工具，直接输出完整的 Markdown 报告，不要输出任何多余闲聊。`;

  // 预装入已有提交概要作为基础事实
  const commits = userData.commits || [];
  let commitsBrief = commits.slice(0, 30).map((c, i) =>
    `[${i + 1}] SHA: ${c.shortSha || c.sha?.substring(0, 7)} | 分支: ${c.branch} | 日期: ${c.date?.substring(0, 16)} | 标题: ${c.subject}`
  ).join('\n');

  let initialUserPrompt = '';
  if (mode === 'refine') {
    initialUserPrompt = `【任务目标】：根据用户提出的具体修改建议，精修并重构工作报告。\n\n` +
      `【用户的修改指令与关注点】：\n"${userSuggestion}"\n\n` +
      `【当前报告草稿】：\n\`\`\`markdown\n${(currentDraft || '').substring(0, 12000)}\n\`\`\`\n\n` +
      `【本周期提交列表总览】：\n${commitsBrief || '详见已有提交'}\n\n` +
      `请根据用户建议，必要时使用 inspect_commit_diff 或 view_source_file 工具核实对应的真实代码改动，然后输出优化重构后的完整 Markdown 报告。`;
  } else {
    initialUserPrompt = `【任务目标】：请为开发者【${userName}】生成一份内容翔实、具有技术深度的专业工作报告。\n` +
      `【基本信息】：报告类型: ${timeTitle}，统计时间: ${timeDisplay}，统计分支: ${selectedBranches.join(', ')}。\n\n` +
      `【本周期检索到的提交记录 (${commits.length} 次)】：\n${commitsBrief || '暂无结构化提交记录'}\n\n` +
      `请挑选关键的核心提交，使用 inspect_commit_diff 查看实际代码改动，使用 view_source_file 查验核心设计，然后撰写最终工作报告。`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialUserPrompt }
  ];

  const toolsArray = getWorkReportApiToolsArray();

  let step = 0;
  let finalMarkdown = '';
  const toolExecutions = [];

  while (step < maxSteps) {
    if (signal?.aborted) {
      throw new Error('用户中止了本次工作报告智能体任务。');
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
        throw new Error('用户中止了本次工作报告智能体任务。');
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
      onThought('已掌握充分的研发改动证据，正在生成专业工作报告...');
    }

    messages.push(assistantMsg);

    // 判断模型是否需要调用工具
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const toolCall of assistantMsg.tool_calls) {
        if (signal?.aborted) {
          throw new Error('用户中止了本次工作报告智能体任务。');
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
        if (toolName === 'read_current_draft') {
          toolResult = currentDraft ? currentDraft.substring(0, 8000) : '当前无已有草稿';
        } else {
          const toolDef = WORK_REPORT_TOOLS[toolName];
          if (toolDef) {
            try {
              toolResult = await toolDef.execute(toolArgs);
            } catch (execErr) {
              toolResult = `工具执行报错: ${execErr.message}`;
            }
          } else {
            toolResult = `错误: 未知工具 "${toolName}"`;
          }
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
      // 无工具调用，获得最终报告 Markdown
      finalMarkdown = cleanMarkdownOutput(content);
      onFinalAnswer(finalMarkdown);
      break;
    }
  }

  // 达到步数上限时的兜底总结
  if (!finalMarkdown && step >= maxSteps) {
    onThought('已达到最大探索步数，正在根据已收集的事实整合生成报告...');
    messages.push({
      role: 'user',
      content: '你已完成所有的工具审计，请立即根据已掌握的所有研发改动事实，输出最终完整的 Markdown 工作报告全文。'
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
