/**
 * TOOL_GENERATE_WORK_REPORT.js
 * 
 * 智能工作报告生成器 (AI Work Report Generator)
 * 
 * 核心特性：
 *   1. 时间跨度灵活选择：
 *      - 本周 (从本周一 00:00:00 至当前时刻，附带本周剩余天数与生成时刻)
 *      - 今天 (从今日 00:00:00 至当前时刻)
 *      - 自定义时间或时间区间 (如: 2026-08-01 ~ 2026-08-31)
 *   2. 分支多选交互界面：
 *      - 上下方向键切换分支，空格键选中/取消选中，a 键全选，回车确认
 *      - 自动置顶并推荐 new-version 主开发分支
 *   3. 自动抓取当前 Git 用户的全量提交记录与代码变更：
 *      - 汇总提交历史、提交信息、代码 Diff 以及涉及的项目源文件内容
 *      - 若无任何提交记录，友好提示并安全退出
 *   4. 调用 AI 大模型深度生成结构严谨、内容翔实的工作总结与周报/日报
 *   5. 自动导出为结构化 Markdown 文档，并在终端提供美观的排版输出与文件路径
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { getAiConfig, hasValidAiKey, tryAutoOpenBrowser } from './config_helper.js';
import { runWorkReportAgent } from './work_report_agent_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(PROJECT_ROOT, 'Docs');

// ----------------- API 与模型配置 -----------------
const aiConfig = getAiConfig();
const OPENAI_API_KEY = aiConfig.apiKey;
const OPENAI_API_BASE = aiConfig.apiBase;
const OPENAI_MODEL = aiConfig.model;

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

/**
 * 格式化日期时间: YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
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
          if (key.name === 'a') return cleanupAndResolve('a');
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
        if (str === 'a' || str === 'A') return cleanupAndResolve('a');
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
 * 选择时间跨度
 */
async function selectTimeRange() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0(周日), 1(周一) ... 6(周六)
  const distToMonday = (dayOfWeek + 6) % 7; // 距离本周一过去的天数

  const monday = new Date(now);
  monday.setDate(now.getDate() - distToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const msLeftInWeek = sunday.getTime() - now.getTime();
  const daysLeftInWeek = (msLeftInWeek / (1000 * 60 * 60 * 24)).toFixed(1);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const timeOptions = [
    {
      id: 'week',
      label: '本周工作总结 (推荐)',
      desc: `时间段: ${formatDateTime(monday)} 至 当前 (${formatDateTime(now)}) (还剩约 ${daysLeftInWeek} 天)`
    },
    {
      id: 'today',
      label: '今日工作总结 (今日日报)',
      desc: `时间段: ${formatDateTime(today)} 至 当前 (${formatDateTime(now)})`
    },
    {
      id: 'custom',
      label: '自定义日期或时间区间',
      desc: '手动指定具体日期 (如: 2026-08-31) 或区间 (如: 2026-08-01 ~ 2026-08-31)'
    }
  ];

  let cursorIndex = 0;

  function renderTimeMenu(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t📅 [步骤 1/3] 选择工作报告的时间跨度\n';
    out += '+========================================================================+\n\n';
    out += '📋 请选择时间区间：\n\n';

    timeOptions.forEach((opt, index) => {
      const isFocused = index === idx;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      if (isFocused) {
        out += `${pointer}\x1b[1m\x1b[36m${opt.label}\x1b[0m\n`;
        out += `\t   └─ \x1b[90m${opt.desc}\x1b[0m\n\n`;
      } else {
        out += `${pointer}\x1b[37m${opt.label}\x1b[0m\n`;
        out += `\t   └─ \x1b[90m${opt.desc}\x1b[0m\n\n`;
      }
    });

    out += '+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 方向键选择] [\x1b[32m回车\x1b[0m 确认操作] [\x1b[31mESC\x1b[0m 取消返回]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderTimeMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return null;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + timeOptions.length) % timeOptions.length;
      renderTimeMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % timeOptions.length;
      renderTimeMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = timeOptions[cursorIndex];

      if (selected.id === 'week') {
        return {
          type: 'week',
          title: '本周工作报告',
          since: monday.toISOString(),
          until: now.toISOString(),
          timeDisplay: `${formatDateTime(monday)} ~ ${formatDateTime(now)}`,
          extraNote: `报告生成于 ${formatDateTime(now)}，本周尚未结束（还剩约 ${daysLeftInWeek} 天）`
        };
      }

      if (selected.id === 'today') {
        return {
          type: 'today',
          title: '今日工作日报',
          since: today.toISOString(),
          until: now.toISOString(),
          timeDisplay: `${formatDateTime(today)} ~ ${formatDateTime(now)}`,
          extraNote: `报告生成于 ${formatDateTime(now)}`
        };
      }

      if (selected.id === 'custom') {
        console.log('\n✏️  请输入自定义时间（支持格式：YYYY-MM-DD 或 YYYY-MM-DD ~ YYYY-MM-DD）：');
        const input = await askQuestion('👉 自定义时间: ');
        if (!input) {
          console.log('\n⚠️ 未输入时间，操作取消。');
          return null;
        }

        let since = '';
        let until = now.toISOString();
        let timeDisplay = input;

        if (input.includes('~') || input.includes('至') || input.includes(',')) {
          const parts = input.split(/[~至,]/).map((s) => s.trim());
          const startDate = new Date(parts[0] + ' 00:00:00');
          const endDate = new Date((parts[1] || parts[0]) + ' 23:59:59');
          if (!isNaN(startDate.getTime())) since = startDate.toISOString();
          if (!isNaN(endDate.getTime())) until = endDate.toISOString();
          timeDisplay = `${formatDateTime(startDate)} ~ ${formatDateTime(endDate)}`;
        } else {
          const d = new Date(input + ' 00:00:00');
          const endD = new Date(input + ' 23:59:59');
          if (!isNaN(d.getTime())) {
            since = d.toISOString();
            until = endD.toISOString();
            timeDisplay = `${formatDateTime(d)} ~ ${formatDateTime(endD)}`;
          } else {
            since = input;
          }
        }

        return {
          type: 'custom',
          title: `工作报告 (${input})`,
          since,
          until,
          timeDisplay,
          extraNote: `报告统计区间: ${timeDisplay}`
        };
      }
    }
  }
}

/**
 * 获取并排序所有本地分支
 */
function getAllBranches() {
  const raw = git(['branch', '--list'], { allowError: true });
  if (!raw) return [];

  const branches = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const isCurrent = line.startsWith('*');
      const name = line.replace(/^\*\s*/, '').trim();
      return { name, isCurrent };
    });

  branches.sort((a, b) => {
    if (a.name === 'new-version') return -1;
    if (b.name === 'new-version') return 1;
    if (a.name === 'main' || a.name === 'master') return -1;
    if (b.name === 'main' || b.name === 'master') return 1;
    return a.name.localeCompare(b.name);
  });

  return branches;
}

/**
 * 交互式多选分支界面 (支持上下箭头移动，空格多选，a全选，回车确认)
 */
async function selectBranchesInteractively(branches) {
  if (branches.length === 0) return [];

  // 默认选中当前分支或 new-version
  const selected = new Set();
  const current = branches.find((b) => b.isCurrent);
  const newVersion = branches.find((b) => b.name === 'new-version');
  if (newVersion) selected.add(newVersion.name);
  else if (current) selected.add(current.name);
  else selected.add(branches[0].name);

  let cursorIndex = 0;

  function renderBranchSelect(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🌿 [步骤 2/3] 选择要统计的工作分支 (多选)\n';
    out += '+========================================================================+\n\n';
    out += '📋 操作提示：[\x1b[36m↑/↓\x1b[0m 移动光标] [\x1b[33m空格\x1b[0m 选中/取消] [\x1b[35ma\x1b[0m 全选/反选] [\x1b[32m回车\x1b[0m 确认] [\x1b[31mESC\x1b[0m 取消]\n\n';

    branches.forEach((b, index) => {
      const isFocused = index === idx;
      const isChecked = selected.has(b.name);

      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
      const checkbox = isChecked ? '\x1b[1m\x1b[32m[✔]\x1b[0m' : '\x1b[90m[ ]\x1b[0m';
      const name = isFocused ? `\x1b[1m\x1b[37m${b.name}\x1b[0m` : b.name;
      const badge = b.name === 'new-version' ? ' \x1b[32m★(推荐开发分支)\x1b[0m' : b.isCurrent ? ' \x1b[36m(当前所在)\x1b[0m' : '';

      out += `${pointer}${checkbox}  ${name}${badge}\n`;
    });

    out += '\n+------------------------------------------------------------------------+\n';
    out += `已选择 \x1b[1m\x1b[32m${selected.size}\x1b[0m 个分支: ${Array.from(selected).join(', ')}\n`;

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
  }

  while (true) {
    renderBranchSelect(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return Array.from(selected);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + branches.length) % branches.length;
      renderBranchSelect(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % branches.length;
      renderBranchSelect(cursorIndex);
      continue;
    }

    if (key === 'SPACE') {
      const item = branches[cursorIndex].name;
      if (selected.has(item)) {
        selected.delete(item);
      } else {
        selected.add(item);
      }
      renderBranchSelect(cursorIndex);
      continue;
    }

    if (key === 'a') {
      if (selected.size === branches.length) {
        selected.clear();
      } else {
        branches.forEach((b) => selected.add(b.name));
      }
      renderBranchSelect(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      if (selected.size === 0) {
        selected.add(branches[cursorIndex].name);
      }
      return Array.from(selected);
    }
  }
}

/**
 * 收集当前用户在指定分支和时间区间内的 commits 与 diff
 */
function collectUserCommitsAndDiffs(selectedBranches, timeRange) {
  const userName = git(['config', 'user.name']) || '';
  const userEmail = git(['config', 'user.email']) || '';

  const allCommits = new Map(); // sha -> commitInfo
  const affectedFilesSet = new Set();

  for (const branch of selectedBranches) {
    const logArgs = [
      'log',
      branch,
      `--since=${timeRange.since}`,
      `--until=${timeRange.until}`,
      '--format=%H|%an|%ae|%ad|%s',
      '--date=iso'
    ];

    if (userEmail) {
      logArgs.push(`--author=${userEmail}`);
    } else if (userName) {
      logArgs.push(`--author=${userName}`);
    }

    const logOutput = git(logArgs, { allowError: true });
    if (!logOutput) continue;

    for (const line of logOutput.split('\n').filter(Boolean)) {
      const [sha, an, ae, ad, subject] = line.split('|');
      if (!allCommits.has(sha)) {
        // 获取此 commit 的改动统计与 diff
        const stat = git(['show', '--stat', '--oneline', sha], { allowError: true });
        let diff = git(['show', '--format=', sha], { allowError: true });
        if (diff.length > 5000) {
          diff = diff.substring(0, 5000) + '\n... [Diff truncated for length]';
        }

        // 获取改动的文件名列表
        const nameOnly = git(['show', '--name-only', '--format=', sha], { allowError: true });
        const files = nameOnly ? nameOnly.split('\n').filter(Boolean) : [];
        files.forEach((f) => affectedFilesSet.add(f.trim()));

        allCommits.set(sha, {
          sha,
          shortSha: sha.substring(0, 7),
          authorName: an,
          authorEmail: ae,
          date: ad,
          subject,
          branch,
          stat,
          diff,
          files
        });
      }
    }
  }

  // 收集涉及的项目源文件内容 (不包含二进制和超大文件)
  const sourceFilesBundle = [];
  for (const relPath of affectedFilesSet) {
    const fullPath = path.resolve(PROJECT_ROOT, relPath);
    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size < 50000) {
          let content = fs.readFileSync(fullPath, 'utf-8');
          if (content.length > 4000) {
            content = content.substring(0, 4000) + '\n... [File content truncated]';
          }
          sourceFilesBundle.push({
            path: relPath.replace(/\\/g, '/'),
            size: stat.size,
            content
          });
        }
      }
    } catch {}
  }

  return {
    userName: userName || '(当前用户)',
    userEmail: userEmail || '',
    commits: Array.from(allCommits.values()),
    affectedFiles: Array.from(affectedFilesSet),
    sourceFilesBundle
  };
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
 * 调用 AI 大模型生成专业工作报告
 */
async function callAiToGenerateReport(reportContext) {
  const { timeRange, userData, selectedBranches } = reportContext;

  let commitsSummaryText = '';
  userData.commits.forEach((c, idx) => {
    commitsSummaryText += `\n【提交 ${idx + 1}】[${c.shortSha}] (${c.date}) 分支: ${c.branch}\n`;
    commitsSummaryText += `  标题: ${c.subject}\n`;
    commitsSummaryText += `  涉及文件: ${c.files.join(', ')}\n`;
    commitsSummaryText += `  代码变更 (Diff):\n${c.diff}\n`;
  });

  let filesBundleText = '';
  userData.sourceFilesBundle.slice(0, 15).forEach((f) => {
    filesBundleText += `\n========================================================================\n`;
    filesBundleText += `文件: ${f.path} (${f.size} bytes)\n`;
    filesBundleText += `========================================================================\n`;
    filesBundleText += f.content + '\n';
  });

  const prompt = `你是一个资深技术总监与高级软件工程架构专家。
请根据下面提供的开发者在当前代码仓库（高校后勤巡查e速办 v4.0）中的真实 Git 提交记录、代码改动 Diff 以及相关核心源文件，为该开发者生成一份结构极其严谨、条理清晰、技术亮点鲜明且高度专业的工作总结报告（Markdown 格式）。

【报告基本信息】：
- 开发者姓名: ${userData.userName}
- 开发者邮箱: ${userData.userEmail}
- 报告类型/标题: ${timeRange.title}
- 统计时间跨度: ${timeRange.timeDisplay}
- 备注说明: ${timeRange.extraNote}
- 统计分支: ${selectedBranches.join(', ')}
- 总提交次数: ${userData.commits.length} 次 Commit
- 涉及修改文件: ${userData.affectedFiles.length} 个文件

【报告内容结构规范】：
# ${userData.userName} - ${timeRange.title}
> 统计周期：${timeRange.timeDisplay} | 提交者：${userData.userName} (${userData.userEmail}) | 生成时间：${formatDateTime(new Date())}

## 一、 工作总体概览 (Executive Summary)
- 简明扼要概括本周期内的核心产出、技术推进里程碑与工作重点（100~200字）。
- 列出核心数据指标（如：完成 Commit 数量、重构/新增模块数量、涉及核心架构等）。

## 二、 核心功能开发与技术落地 (Key Achievements & Features)
- 分模块详细阐述本周期开发的核心功能或架构改进（结合 Host 硬件主控/8线程流水线/VirtualChip 芯片仿真/Backend 微服务/Log 闭环/UI 界面/工程化运维工具箱等真实模块）。
- 说明解决的关键技术难题、设计模式或核心算法应用。

## 三、 代码重构、修复与质量保证 (Bug Fixes & Refactoring)
- 总结在此期间完成的问题修复、性能优化、历史提交规范化或自动化测试建设。

## 四、 本周期详细代码提交足迹 (Commit History Timeline)
- 以时间线或表格形式，整理出规范、清晰的 Commit 明细。

## 五、 后续工作计划与展望 (Next Steps & Plan)
- 根据当前阶段进展与尚未完成的特性，列出下一周期的具体工作规划。

【开发者真实提交与代码 Diff】：
${commitsSummaryText}

【涉及的项目源文件内容概览】：
${filesBundleText}

【输出要求】：
- 语言使用规范、专业的中文；
- 评价客观详实，充分体现工程价值；
- 直接输出完整 Markdown 格式报告文本，不要包含多余闲聊。
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
        { role: 'system', content: 'You are an executive engineering manager and technical writer. Generate comprehensive and structured Markdown work reports.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
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
 * 调用 AI 大模型根据用户建议对工作报告草稿进行增量微调与重构
 */
async function callAiToRefineReport(currentReport, suggestion) {
  const prompt = `
你是一位资深技术总监、工程效能专家与技术文档专家。
用户当前正在审阅一份软件研发工作报告/周报草稿。

【当前工作报告草稿】：
\`\`\`markdown
${currentReport}
\`\`\`

【用户的修改建议与调整指令】：
"${suggestion}"

【处理要求】：
1. 严格遵循用户的修改建议，在保持已有报告核心事实和真实提交数据的基础上，进行针对性的重构、扩充、格式精简或润色；
2. 保持专业、高管视角或严谨工程叙事风格，符合企业级周报/工作汇报规范；
3. 直接输出完整的 Markdown 格式报告文本，不要包含多余闲聊，不要在最外层包裹 markdown 代码块标记。
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
        { role: 'system', content: 'You are an executive engineering manager and technical writer. Refine Markdown work reports based on user feedback.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
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

async function findAvailablePort(startPort = 3470) {
  let port = startPort;
  while (port < startPort + 100) {
    if (await isPortAvailable(port)) return port;
    port++;
  }
  return 3470;
}

/**
 * 生成工作报告 Web 精修与预览工作台 HTML
 */
function getWebWorkReportStudioHtml(initialReport, metadata) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>高校后勤巡查e速办 v4.0 研发成果与工作报告智能工作台</title>
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
      --dock-bg: rgba(19, 25, 36, 0.95);
      --badge-bg: rgba(56, 139, 253, 0.15);
      --badge-text: #58a6ff;
      --card-hover: #1e283a;
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
      --dock-bg: rgba(255, 255, 255, 0.96);
      --badge-bg: rgba(37, 99, 235, 0.1);
      --badge-text: #2563eb;
      --card-hover: #f8fafc;
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
      height: 16px;
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
      box-shadow: 0 2px 10px var(--shadow-color);
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
    .header-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 20px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      font-size: 12px;
      color: var(--text-muted);
    }
    .meta-chip strong {
      color: var(--text-main);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      padding: 7px 15px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background: var(--panel-bg);
      color: var(--text-main);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      user-select: none;
    }
    .btn:hover {
      border-color: var(--border-focus);
      background: var(--card-bg);
    }
    .btn-primary {
      background: linear-gradient(135deg, #16a34a, #15803d);
      border-color: #16a34a;
      color: #ffffff;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(22, 163, 74, 0.35);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #15803d, #166534);
      border-color: #15803d;
      box-shadow: 0 4px 12px rgba(22, 163, 74, 0.45);
    }

    /* 主布局 */
    .studio-main {
      display: flex;
      height: calc(100vh - 61px - 142px);
      overflow: hidden;
      background: var(--bg-color);
    }

    /* 左侧 Git 证据侧边栏 */
    .sidebar {
      width: 330px;
      flex-shrink: 0;
      background: var(--card-bg);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-heading);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--panel-bg);
    }
    .sidebar-count {
      background: var(--badge-bg);
      color: var(--badge-text);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
    }
    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .commit-card {
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .commit-card:hover {
      background: var(--card-hover);
      border-color: var(--border-focus);
    }
    .commit-card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
    }
    .commit-sha {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--accent-cyan);
      font-weight: 600;
    }
    .commit-date {
      color: var(--text-muted);
    }
    .commit-subject {
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-main);
      font-weight: 500;
      word-break: break-all;
    }
    .commit-branch-tag {
      display: inline-block;
      align-self: flex-start;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(34, 211, 238, 0.12);
      color: var(--accent-cyan);
    }
    .commit-files {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* 右侧 Markdown 预览区域 */
    .preview-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-color);
    }
    .preview-toolbar {
      padding: 10px 24px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .doc-meta {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 14px;
      background: rgba(234, 179, 8, 0.15);
      color: #eab308;
      font-weight: 600;
    }
    .status-badge.saved {
      background: rgba(34, 197, 94, 0.15);
      color: var(--accent-green);
    }
    .preview-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 32px 48px 60px;
    }
    .markdown-content {
      max-width: 960px;
      margin: 0 auto;
      line-height: 1.7;
      font-size: 15px;
      color: var(--text-main);
    }
    .markdown-content h1 {
      font-size: 26px;
      font-weight: 800;
      color: var(--text-heading);
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border-color);
    }
    .markdown-content h2 {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-heading);
      margin-top: 28px;
      margin-bottom: 14px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border-color);
    }
    .markdown-content h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-heading);
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .markdown-content p { margin-bottom: 14px; }
    .markdown-content ul, .markdown-content ol { margin-bottom: 14px; padding-left: 24px; }
    .markdown-content li { margin-bottom: 5px; }
    .markdown-content blockquote {
      border-left: 4px solid var(--accent-blue);
      padding: 8px 16px;
      margin: 14px 0;
      background: var(--panel-bg);
      border-radius: 0 6px 6px 0;
      color: var(--text-muted);
    }
    .markdown-content pre {
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px 18px;
      overflow-x: auto;
      margin: 14px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
    }
    .markdown-content code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
      background: var(--panel-bg);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .markdown-content pre code {
      background: transparent;
      padding: 0;
    }
    .markdown-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      border: 1px solid var(--border-color);
    }
    .markdown-content th, .markdown-content td {
      border: 1px solid var(--border-color);
      padding: 8px 14px;
      text-align: left;
    }
    .markdown-content th {
      background: var(--panel-bg);
      font-weight: 600;
      color: var(--text-heading);
    }
    .markdown-content tr:nth-child(even) {
      background: rgba(125, 125, 125, 0.03);
    }

    /* 底部微调输入浮动舱 */
    .dock {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 142px;
      background: var(--dock-bg);
      backdrop-filter: blur(12px);
      border-top: 1px solid var(--border-color);
      padding: 10px 24px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 100;
      box-shadow: 0 -4px 16px var(--shadow-color);
    }
    .dock-chips {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .chip-btn {
      white-space: nowrap;
      padding: 4px 12px;
      border-radius: 16px;
      border: 1px solid var(--border-color);
      background: var(--panel-bg);
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chip-btn:hover {
      border-color: var(--border-focus);
      color: var(--accent-blue);
      background: var(--card-bg);
    }
    .dock-input-box {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      flex: 1;
    }
    .dock-textarea {
      flex: 1;
      height: 60px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--text-main);
      font-size: 13.5px;
      line-height: 1.4;
      resize: none;
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .dock-textarea:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(56, 139, 253, 0.2);
    }
    .dock-send-btn {
      height: 60px;
      padding: 0 24px;
      background: linear-gradient(135deg, var(--accent-blue), #2563eb);
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 3px;
      transition: all 0.2s ease;
      user-select: none;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
    }
    .dock-send-btn:hover {
      opacity: 0.94;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45);
    }
    .dock-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .dock-send-btn small {
      font-size: 10px;
      opacity: 0.8;
      font-weight: 400;
    }

    /* Toast */
    .toast {
      position: fixed;
      top: 75px;
      right: 24px;
      background: var(--card-bg);
      border: 1px solid var(--border-focus);
      color: var(--text-heading);
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      box-shadow: 0 8px 24px var(--shadow-color);
      opacity: 0;
      pointer-events: none;
      transform: translateY(-10px);
      transition: all 0.25s ease;
      z-index: 10000;
    }
    .toast.show {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    /* 终端退出后的只读归档状态 */
    body.terminal-exited .sidebar {
      display: none !important;
    }
    body.terminal-exited .dock {
      display: none !important;
    }
    body.terminal-exited .header-op-btn {
      display: none !important;
    }
    body.terminal-exited #skipBtn {
      display: none !important;
    }
    body.terminal-exited .studio-main {
      flex: 1 !important;
      min-height: 0 !important;
      height: auto !important;
      overflow: hidden !important;
    }
    body.terminal-exited .preview-container {
      width: 100% !important;
      height: 100% !important;
      display: flex !important;
      flex-direction: column !important;
    }
    body.terminal-exited .preview-toolbar {
      width: 100% !important;
      padding: 10px 32px !important;
      box-sizing: border-box !important;
    }
    body.terminal-exited .preview-scroll {
      width: 100% !important;
      flex: 1 !important;
      overflow-y: auto !important;
      padding: 24px 20px 60px 20px !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      box-sizing: border-box !important;
    }
    body.terminal-exited .preview-scroll::-webkit-scrollbar {
      width: 7px;
    }
    body.terminal-exited .preview-scroll::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 4px;
    }
    body.terminal-exited .markdown-content {
      max-width: 960px !important;
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
      <div class="app-title">
        <span>📊</span>
        <span>高校后勤巡查e速办 v4.0 研发成果与工作报告智能工作台</span>
      </div>
      <div class="header-meta">
        <span class="meta-chip">👤 <strong>${metadata.userData.userName || '开发者'}</strong></span>
        <span class="meta-chip">📅 <strong>${metadata.timeRange.timeDisplay}</strong></span>
        <span class="meta-chip">🌿 <strong>${metadata.selectedBranches.join(', ')}</strong></span>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn" id="themeToggleBtn" onclick="toggleTheme()">🌙 暗色模式</button>
      <button class="btn" onclick="copyFullMarkdown()">📋 复制全文</button>
      <button class="btn btn-primary exit-only-btn" onclick="downloadReportMarkdown()">💾 下载工作报告 (.md)</button>
      <button class="btn header-op-btn" onclick="saveAsCustomFile()">📁 另存为...</button>
      <button class="btn primary header-op-btn" id="saveConfirmBtn" onclick="confirmSaveReport()">💾 确认保存至 Docs/</button>
    </div>
  </header>

  <div class="studio-main">
    <!-- 左侧 Git 证据侧边栏 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <span>📦 Git 提交证据链</span>
        <span class="sidebar-count" id="commitCountBadge">${metadata.userData.commitsCount} 次提交</span>
      </div>
      <div class="sidebar-content" id="commitListContainer">
        <!-- 由脚本动态填充 -->
      </div>
    </aside>

    <!-- 右侧 Markdown 实时打字机预览 -->
    <main class="preview-container">
      <div class="preview-toolbar">
        <div class="doc-meta">
          <span class="status-badge" id="saveStatusBadge">💡 草稿预览 (尚未写入磁盘)</span>
          <span style="font-size: 12px; color: var(--text-muted);" id="charCountBadge">统计中...</span>
        </div>
        <button class="btn" id="skipBtn" style="display: none; padding: 4px 10px; font-size: 12px;" onclick="skipCurrentTyping()">⏭️ 跳过打字机动画</button>
      </div>
      <div class="preview-scroll" id="previewScroll">
        <!-- 终端退出锁定通知条 -->
        <div id="terminalExitBanner" class="terminal-exit-banner">
          <div class="exit-banner-left">
            <span class="exit-banner-icon">⚠️</span>
            <div>
              <div class="exit-banner-title">终端总控台已离开当前功能（服务已断开）</div>
              <div class="exit-banner-desc">检测到您已在终端退出工作报告功能。当前界面已锁定并进入【只读归档模式】，无法继续输入提示词进行 AI 微调或直接写入 Docs/ 目录。已为您居中保留当前已生成的完整工作报告，您可以复制全文或下载至本地。</div>
            </div>
          </div>
          <div class="exit-banner-actions">
            <button class="btn" onclick="copyFullMarkdown()">📋 复制全文</button>
            <button class="btn btn-primary" onclick="downloadReportMarkdown()">💾 下载工作报告 (.md)</button>
          </div>
        </div>

        <div class="markdown-content" id="previewBody"></div>
      </div>
    </main>
  </div>

  <!-- 底部微调输入浮动舱 -->
  <div class="dock">
    <div class="dock-chips">
      <button class="chip-btn" onclick="applyChip('🎯 请突出核心架构重构的收益与性能量化数据')">🎯 突出核心工程收益与量化指标</button>
      <button class="chip-btn" onclick="applyChip('👔 请转换为面向技术总监与管理层汇报的简练口吻')">👔 面向管理层汇报口吻</button>
      <button class="chip-btn" onclick="applyChip('📉 请增加技术债务识别与下阶段关键排期风险')">📉 增加技术债与风险分析</button>
      <button class="chip-btn" onclick="applyChip('⚡ 请精简篇幅，去除非必要描述，以条目要点形式呈现')">⚡ 精炼篇幅提炼要点</button>
    </div>
    <div class="dock-input-box">
      <textarea
        id="modInput"
        class="dock-textarea"
        placeholder="输入您的调整建议（例如：'把第二部分关键特性写得更详实，并追加下周计划'），按 Enter 发送微调..."
      ></textarea>
      <button id="sendBtn" class="dock-send-btn" onclick="sendModification()">
        <span>✨ 智能二次微调</span>
        <small>Enter 发送 / Shift+Enter 换行</small>
      </button>
    </div>
  </div>

  <div id="toast" class="toast">✔ 操作已成功！</div>

  <script>
    const initialReport = ${JSON.stringify(initialReport).replace(/<\/script>/gi, '<\\/script>')};
    const metadata = ${JSON.stringify(metadata).replace(/<\/script>/gi, '<\\/script>')};
    let currentReport = initialReport;
    let isSaved = false;
    let savedFilePath = '';

    let currentTypewriterTimer = null;
    let currentTypewriterSkip = null;

    const previewBody = document.getElementById('previewBody');
    const previewScroll = document.getElementById('previewScroll');
    const skipBtn = document.getElementById('skipBtn');
    const modInput = document.getElementById('modInput');
    const sendBtn = document.getElementById('sendBtn');
    const charCountBadge = document.getElementById('charCountBadge');
    const saveStatusBadge = document.getElementById('saveStatusBadge');

    // 填充左侧提交证据链
    (function renderEvidenceSidebar() {
      const container = document.getElementById('commitListContainer');
      const commits = metadata.userData.commits || [];
      if (commits.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 12px; text-align: center;">无提交记录</div>';
        return;
      }
      commits.forEach(c => {
        const card = document.createElement('div');
        card.className = 'commit-card';
        card.innerHTML = \`
          <div class="commit-card-top">
            <span class="commit-sha">#\${c.shortSha}</span>
            <span class="commit-date">\${(c.date || '').slice(0, 16)}</span>
          </div>
          <div class="commit-subject">\${escapeHtml(c.subject)}</div>
          <span class="commit-branch-tag">\${escapeHtml(c.branch)}</span>
          \${c.files && c.files.length > 0 ? \`<div class="commit-files">📄 变更 \${c.files.length} 个文件</div>\` : ''}
        \`;
        container.appendChild(card);
      });
    })();

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 主题切换
    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const hljsTheme = document.getElementById('hljs-theme');
      const toggleBtn = document.getElementById('themeToggleBtn');
      if (theme === 'light') {
        hljsTheme.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css';
        toggleBtn.innerText = '☀️ 浅色模式';
      } else {
        hljsTheme.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
        toggleBtn.innerText = '🌙 暗色模式';
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
      setTimeout(() => toast.classList.remove('show'), 3500);
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
        updateDocMeta();
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

    function updateDocMeta() {
      charCountBadge.innerText = '📊 ' + currentReport.length + ' 字符 (' + (currentReport.length / 1024).toFixed(1) + ' KB)';
      if (isSaved) {
        saveStatusBadge.className = 'status-badge saved';
        saveStatusBadge.innerText = '✔ 已保存: ' + (savedFilePath ? savedFilePath.split(/[/\\\\]/).pop() : 'Docs/ 报告');
      } else {
        saveStatusBadge.className = 'status-badge';
        saveStatusBadge.innerText = '💡 草稿预览 (尚未写入磁盘)';
      }
    }

    function applyChip(text) {
      modInput.value = text;
      modInput.focus();
    }

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
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span>🤖 Agent 正在自主审计 Diff 与微调...</span><small>正在执行 ReAct 闭环</small>';

      try {
        const res = await fetch('/api/refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suggestion: text, currentContent: currentReport })
        });
        const json = await res.json();
        if (json.success && json.updatedMarkdown) {
          currentReport = json.updatedMarkdown;
          isSaved = false;
          const toolCnt = json.toolCount || 0;
          showToast('✔ 工作报告智能体已完成修订 (调用了 ' + toolCnt + ' 次审计工具核实代码)！');
          typewriterRender(currentReport);
        } else {
          showToast('❌ 微调失败: ' + (json.error || '未知错误'));
        }
      } catch (err) {
        showToast('❌ 请求异常: ' + err.message);
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span>✨ 智能二次微调</span><small>Enter 发送 / Shift+Enter 换行</small>';
      }
    }

    async function confirmSaveReport() {
      const saveBtn = document.getElementById('saveConfirmBtn');
      saveBtn.disabled = true;
      saveBtn.innerText = '💾 保存中...';

      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: currentReport, fileName: metadata.defaultFileName })
        });
        const json = await res.json();
        if (json.success) {
          isSaved = true;
          savedFilePath = json.savedPath;
          updateDocMeta();
          showToast('🎉 工作报告已成功保存至: ' + json.savedPath);
        } else {
          showToast('❌ 保存失败: ' + json.error);
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerText = '💾 确认保存至 Docs/';
      }
    }

    async function saveAsCustomFile() {
      const name = prompt('请输入另存为的文件名 (将保存在 Docs/ 目录下):', metadata.defaultFileName);
      if (!name || !name.trim()) return;

      try {
        const res = await fetch('/api/save_custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: currentReport, fileName: name.trim() })
        });
        const json = await res.json();
        if (json.success) {
          isSaved = true;
          savedFilePath = json.savedPath;
          updateDocMeta();
          showToast('✔ 另存成功: ' + json.savedPath);
        } else {
          showToast('❌ 另存失败: ' + json.error);
        }
      } catch (err) {
        showToast('❌ 请求失败: ' + err.message);
      }
    }

    function copyFullMarkdown() {
      navigator.clipboard.writeText(currentReport).then(() => {
        showToast('✔ 已复制 Markdown 全文至剪贴板！');
      }).catch(() => {
        showToast('❌ 复制失败，请手动选取内容');
      });
    }

    function downloadReportMarkdown() {
      const filename = metadata.defaultFileName || ('WorkReport_' + Date.now() + '.md');
      const blob = new Blob([currentReport], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✔ 已下载工作报告 Markdown 文件！');
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
      const saveStatusBadge = document.getElementById('saveStatusBadge');
      if (saveStatusBadge) {
        saveStatusBadge.className = 'status-badge';
        saveStatusBadge.style.color = '#ef4444';
        saveStatusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        saveStatusBadge.innerText = '🔒 终端已离开 · 只读归档模式';
      }
      const banner = document.getElementById('terminalExitBanner');
      if (banner) banner.style.display = 'flex';
      showToast('⚠️ 终端总控台已离开当前功能，界面已锁定为只读模式');
    }

    // 初次加载打字机渲染
    typewriterRender(currentReport);
  </script>
</body>
</html>`;
}

/**
 * 启动常驻工作报告智能精修 Web 工作台
 */
async function startWorkReportWebStudio({ initialReport, userData, timeRange, selectedBranches, defaultFileName }) {
  const port = await findAvailablePort(3470);
  let currentReport = initialReport;

  const metadata = {
    userData: {
      userName: userData.userName,
      userEmail: userData.userEmail,
      commitsCount: userData.commits.length,
      affectedFilesCount: userData.affectedFiles.length,
      commits: userData.commits.map(c => ({
        sha: c.sha,
        shortSha: c.shortSha,
        date: c.date,
        subject: c.subject,
        branch: c.branch,
        files: c.files || []
      }))
    },
    timeRange,
    selectedBranches,
    defaultFileName
  };

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');

    // 1. 首页
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getWebWorkReportStudioHtml(currentReport, metadata));
      return;
    }

    // 2. 状态查询
    if (parsedUrl.pathname === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ report: currentReport, metadata, model: OPENAI_MODEL }));
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
          const { suggestion, currentContent } = JSON.parse(body || '{}');
          if (!suggestion) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '请提供修改建议或提示词' }));
            return;
          }
          console.log(`\n🤖 [Work Report Agent Web 任务] 正在基于修改建议审计代码并优化报告: "${suggestion}"`);
          const targetContent = currentContent || currentReport;
          const agentRes = await runWorkReportAgent({
            mode: 'refine',
            reportContext: { timeRange, userData, selectedBranches },
            userSuggestion: suggestion,
            currentDraft: targetContent,
            onStep: (s, max) => process.stdout.write(`\r   └─ [Work Report Agent 步数 ${s}/${max}] `),
            onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
            onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
            onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
          });
          currentReport = agentRes.markdown;
          console.log(`\n✔ [Web 响应] 工作报告智能体增量精修完成！(调用审计工具 ${agentRes.toolExecutions.length} 次)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            updatedMarkdown: currentReport,
            toolCount: agentRes.toolExecutions.length
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 4. 确认保存至 Docs/ 目录
    if (parsedUrl.pathname === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { content, fileName } = JSON.parse(body || '{}');
          if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
          const targetName = (fileName || defaultFileName).replace(/[\\/:*?"<>|]/g, '_');
          const targetPath = path.join(DOCS_DIR, targetName);
          currentReport = content || currentReport;
          fs.writeFileSync(targetPath, currentReport, 'utf-8');
          console.log('\n+========================================================================+');
          console.log('|\t🎉 [用户确认] 研发工作报告已成功保存至磁盘！');
          console.log(`|\t📁 保存路径:\t\x1b[1m\x1b[32m${targetPath}\x1b[0m`);
          console.log(`|\t📊 报告大小:\t${(currentReport.length / 1024).toFixed(1)} KB`);
          console.log('+========================================================================+\n');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, savedPath: targetPath }));
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
          if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
          const safeName = (fileName || `Report_Custom_${Date.now()}.md`).replace(/[\\/:*?"<>|]/g, '_');
          const targetPath = path.join(DOCS_DIR, safeName);
          currentReport = content || currentReport;
          fs.writeFileSync(targetPath, currentReport, 'utf-8');
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
      console.log(`|\t🚀 研发工作报告智能工作台已就绪！`);
      console.log(`|\t🌐 浏览器访问: \x1b[1m\x1b[32m${url}\x1b[0m`);
      console.log('|\t💡 提示: 浏览器已自动唤起，初稿尚未写入磁盘；');
      console.log('|\t         您可以在 Web 界面自由审阅证据链、实时打字机预览 Markdown；');
      console.log('|\t         在底部多轮输入提示词进行定向精修；');
      console.log('|\t         满意后点击右上角【💾 确认保存至 Docs/】完成落盘！');
      console.log('+========================================================================+');
      console.log('👉 [在终端按 ESC 或 q 可退出并关闭工作台服务]\n');
      tryAutoOpenBrowser(url);
    });

    const checkExitKey = async () => {
      while (true) {
        const key = await getKeyPress();
        if (key === 'ESC' || key === 'q') {
          console.log('\n🚪 正在关闭工作台服务并返回主菜单...');
          server.close(() => {
            resolve();
          });
          break;
        }
      }
    };
    checkExitKey();
  });
}

/**
 * 弹出 Windows 原生「另存为」文件选择框
 */
function openWindowsSaveFileDialog(defaultFileName, initialDir) {
  if (process.platform !== 'win32') return null;

  try {
    const psScript = `
      [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
      $f = New-Object System.Windows.Forms.SaveFileDialog
      $f.Filter = "Markdown 文档 (*.md)|*.md|所有文件 (*.*)|*.*"
      $f.FileName = "${defaultFileName}"
      $f.InitialDirectory = "${initialDir.replace(/\\/g, '\\\\')}"
      $f.Title = "请选择工作报告保存路径"
      if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $f.FileName
      }
    `;

    const res = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf-8',
      timeout: 30000
    });

    const chosenPath = (res.stdout || '').trim();
    if (chosenPath && fs.existsSync(path.dirname(chosenPath))) {
      return chosenPath;
    }
  } catch {}

  return null;
}

/**
 * 保存工作报告文件
 */
function saveReportFile(reportContent, defaultFileName) {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  let targetPath = null;

  // 尝试唤起系统另存为对话框
  if (process.platform === 'win32') {
    process.stdout.write('\n📂 正在唤起系统「另存为」窗口，请选择保存位置... ');
    targetPath = openWindowsSaveFileDialog(defaultFileName, DOCS_DIR);
    if (targetPath) {
      console.log('✔ 已选定保存路径！');
    } else {
      console.log('💡 (未选择自定义路径，将默认保存在 Docs 目录)');
    }
  }

  // 兜底保存在 Docs/ 目录下
  if (!targetPath) {
    targetPath = path.join(DOCS_DIR, defaultFileName);
  }

  fs.writeFileSync(targetPath, reportContent, 'utf-8');
  return targetPath;
}

/**
 * 主流程
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

  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t📑 高校后勤巡查e速办 v4.0 智能工作报告生成器 (AI Work Report Generator)');
  console.log('+========================================================================+\n');

  // 1. 选择时间范围
  const timeRange = await selectTimeRange();
  if (!timeRange) {
    console.log('\n🚪 已取消生成工作报告。');
    process.exit(0);
  }

  // 2. 选择分支
  const branches = getAllBranches();
  if (branches.length === 0) {
    console.log('\n❌ 未找到任何本地 Git 分支。');
    process.exit(1);
  }

  const selectedBranches = await selectBranchesInteractively(branches);
  if (selectedBranches.length === 0) {
    console.log('\n⚠️ 未选择任何分支，操作已取消。');
    process.exit(0);
  }

  // 3. 收集 Commit 与代码 Diff
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🔍 [步骤 3/3] 正在检索当前用户的提交数据与代码变更...');
  console.log('+========================================================================+\n');

  console.log(`\t📅 统计时间:\t\x1b[1m\x1b[33m${timeRange.timeDisplay}\x1b[0m`);
  console.log(`\t🌿 统计分支:\t\x1b[1m\x1b[36m${selectedBranches.join(', ')}\x1b[0m\n`);

  process.stdout.write('⏳ 正在扫描 Git 提交记录与提取代码变更... ');
  const userData = collectUserCommitsAndDiffs(selectedBranches, timeRange);
  console.log('✔ 完成！\n');

  console.log(`\t👤 识别提交者:\t\x1b[1m\x1b[32m${userData.userName}\x1b[0m <${userData.userEmail}>`);
  console.log(`\t📦 找到 Commit:\t\x1b[1m\x1b[33m${userData.commits.length} 个\x1b[0m`);
  console.log(`\t📄 涉及文件数:\t\x1b[1m\x1b[36m${userData.affectedFiles.length} 个\x1b[0m\n`);

  if (userData.commits.length === 0) {
    console.log('+------------------------------------------------------------------------+');
    console.log('|\t⚠️  在所选时间范围与分支内，未检测到当前用户的任何提交记录！');
    console.log('|\t建议：检查是否切换了正确的用户名/邮箱，或扩大时间范围后重试。');
    console.log('+------------------------------------------------------------------------+\n');
    await getKeyPress('👉 按 [回车] 返回主菜单...');
    process.exit(0);
  }

  console.log('📋 本周期包含的提交摘要:');
  userData.commits.forEach((c, idx) => {
    console.log(`\t[${idx + 1}] \x1b[33m${c.shortSha}\x1b[0m [${c.branch}] (${c.date.substring(0, 16)}) - ${c.subject}`);
  });

  const confirmOptions = [
    { id: 'start', label: '✔ 开始调用 AI 大模型生成专业工作报告' },
    { id: 'cancel', label: '🚪 取消并返回主菜单' }
  ];
  let confirmCursor = 0;

  while (true) {
    console.log('\n+------------------------------------------------------------------------+');
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

    const confirmKey = await getKeyPress();

    if (confirmKey === 'ESC' || (confirmKey === 'ENTER' && confirmOptions[confirmCursor].id === 'cancel')) {
      console.log('\n🚪 已取消操作，未消耗任何 AI 额度。\n');
      process.exit(0);
    }

    if (confirmKey === 'UP') {
      confirmCursor = (confirmCursor - 1 + confirmOptions.length) % confirmOptions.length;
      continue;
    }

    if (confirmKey === 'DOWN') {
      confirmCursor = (confirmCursor + 1) % confirmOptions.length;
      continue;
    }

    if (confirmKey === 'ENTER' && confirmOptions[confirmCursor].id === 'start') {
      break;
    }
  }

  console.log('\n--------------------------------------------------------------------------');
  console.log('🤖 研发报告智能体 (Work Report Agent) 正在基于 ReAct 循环自主审计代码与 Diff...');
  console.log('--------------------------------------------------------------------------');
  let reportContent = '';
  try {
    const agentRes = await runWorkReportAgent({
      mode: 'generate',
      reportContext: { timeRange, userData, selectedBranches },
      onStep: (s, max) => process.stdout.write(`\r   └─ [Work Report Agent 步数 ${s}/${max}] `),
      onThought: (t) => console.log(`\n   💭 [Agent 思考] ${t.substring(0, 100)}...`),
      onToolCall: (name, args) => process.stdout.write(`🛠️ [${name}] `),
      onToolResult: (name, s) => console.log(`👀 [${name} 完成]`)
    });
    reportContent = agentRes.markdown;
    console.log(`\n✔ 智能体工作报告初稿生成成功！(大小: ${(reportContent.length / 1024).toFixed(1)} KB，调用审计工具 ${agentRes.toolExecutions.length} 次)\n`);
  } catch (err) {
    console.error(`\n❌ 智能体生成失败: ${err.message}`);
    process.exit(1);
  }

  // 构造规范文件名
  const safeUserName = (userData.userName || 'developer').replace(/[\\/:*?"<>|]/g, '_');
  const safeEmail = (userData.userEmail || 'user').replace(/[@.]/g, '_').replace(/[\\/:*?"<>|]/g, '_');
  const timeTag = timeRange.type === 'week' ? '本周工作报告' : timeRange.type === 'today' ? '今日工作日报' : '工作报告';
  const dateTag = formatDateTime(new Date()).replace(/[- :]/g, '').slice(0, 14);
  const defaultFileName = `${timeTag}_${safeUserName}_${safeEmail}_${dateTag}.md`;

  // 启动 Web 交互工作台（草稿未落盘，用户在浏览器中审阅证据链、预览 Markdown、多轮微调后点击按钮确认落盘）
  await startWorkReportWebStudio({
    initialReport: reportContent,
    userData,
    timeRange,
    selectedBranches,
    defaultFileName
  });
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 工作报告生成器异常:', err);
  process.exit(1);
});
