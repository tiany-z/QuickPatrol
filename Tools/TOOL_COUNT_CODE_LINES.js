/**
 * TOOL_COUNT_CODE_LINES.js
 * 
 * 全项目代码量与文件规模深度分析工作台 (Codebase Metrics & Lines Counter)
 * 
 * 核心功能：
 *   1. 📊 总体概览与语言分布：
 *      - 统计源码文件总数、总代码行数 (Total Lines)、纯代码行 (Code / SLOC)、注释行 (Comment) 与空白行 (Blank)
 *      - 自动计算项目注释率 (Comment Ratio) 与代码库总存储大小
 *      - 按编程语言 (JS, TS, C/C++, CSS, HTML, SQL, JSON, Markdown, Shell) 分类对比与百分比进度条
 *   2. 📁 子系统与模块分布：
 *      - 自动按 Monorepo 子系统 (UI, Backend, Host, VirtualChip, MockBackend, Log, Tools, Docs) 统计各领域代码规模
 *   3. 🏆 大文件规模排行榜 (Top 25 Largest Files)：
 *      - 实时罗列代码量最大的源文件清单，辅助架构治理与模块拆分
 *   4. 🔍 指定路径深入剖析：
 *      - 支持手工输入任意子目录或文件路径进行单独统计
 *   5. 💾 导出 Markdown 报告：
 *      - 一键将全景统计报告导出为 Markdown 文档并保存至 Docs/ 目录
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.resolve(PROJECT_ROOT, 'Docs');

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
          if (key.name === 'left' || key.name === 'h' || key.name === 'a') return cleanupAndResolve('LEFT');
          if (key.name === 'right' || key.name === 'l' || key.name === 'd') return cleanupAndResolve('RIGHT');
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
 * 计算字符视觉宽度
 */
function getVisualWidth(str) {
  let w = 0;
  const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      w += 1;
    } else {
      w += 2;
    }
  }
  return w;
}

function padVisual(str, targetWidth, alignRight = false) {
  const currentWidth = getVisualWidth(str);
  if (currentWidth >= targetWidth) return str;
  const spaces = ' '.repeat(targetWidth - currentWidth);
  return alignRight ? spaces + str : str + spaces;
}

/**
 * 生成 ASCII 百分比条形图
 */
function renderProgressBar(percentage, totalBars = 14) {
  const filled = Math.min(totalBars, Math.max(0, Math.round((percentage / 100) * totalBars)));
  const empty = totalBars - filled;
  return `\x1b[36m${'█'.repeat(filled)}\x1b[90m${'░'.repeat(empty)}\x1b[0m`;
}

// ----------------- 排除名单与文件类型映射 -----------------

const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  'miniprogram_npm',
  '.git',
  '.agents',
  '.gemini',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  'tmp',
  'temp',
  '.system_generated'
]);

const IGNORE_FILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.DS_Store',
  'Thumbs.db',
  'tokenizer.json'
]);

const LANGUAGE_DEFINITIONS = {
  '.js': { name: 'JavaScript', category: 'code' },
  '.mjs': { name: 'JavaScript', category: 'code' },
  '.cjs': { name: 'JavaScript', category: 'code' },
  '.jsx': { name: 'React JSX', category: 'code' },
  '.ts': { name: 'TypeScript', category: 'code' },
  '.tsx': { name: 'React TSX', category: 'code' },
  '.vue': { name: 'Vue Component', category: 'code' },
  '.wxml': { name: 'WeChat WXML', category: 'markup' },
  '.wxss': { name: 'WeChat WXSS', category: 'style' },
  '.c': { name: 'C Language', category: 'code' },
  '.h': { name: 'C/C++ Header', category: 'code' },
  '.cpp': { name: 'C++', category: 'code' },
  '.hpp': { name: 'C++ Header', category: 'code' },
  '.css': { name: 'CSS', category: 'style' },
  '.scss': { name: 'SCSS', category: 'style' },
  '.less': { name: 'LESS', category: 'style' },
  '.html': { name: 'HTML', category: 'markup' },
  '.htm': { name: 'HTML', category: 'markup' },
  '.sql': { name: 'SQL Script', category: 'data' },
  '.json': { name: 'JSON', category: 'config' },
  '.yaml': { name: 'YAML', category: 'config' },
  '.yml': { name: 'YAML', category: 'config' },
  '.toml': { name: 'TOML', category: 'config' },
  '.md': { name: 'Markdown', category: 'doc' },
  '.sh': { name: 'Shell Script', category: 'script' },
  '.bash': { name: 'Shell Script', category: 'script' },
  '.bat': { name: 'Batch Script', category: 'script' },
  '.ps1': { name: 'PowerShell', category: 'script' },
  '.env': { name: 'Env Config', category: 'config' },
  '.env.example': { name: 'Env Config', category: 'config' }
};

/**
 * 单个文件的纯代码、注释与空行扫描
 */
function analyzeSingleFile(filePath, ext) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let code = 0;
    let comment = 0;
    let blank = 0;
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        blank++;
        continue;
      }

      // C-style comments (JS, TS, C, C++, CSS, WXSS, etc.)
      if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.c', '.h', '.cpp', '.hpp', '.css', '.wxss', '.scss', '.less', '.sql'].includes(ext)) {
        if (inBlockComment) {
          comment++;
          if (line.includes('*/')) {
            inBlockComment = false;
          }
          continue;
        }

        if (line.startsWith('//') || (ext === '.sql' && line.startsWith('--'))) {
          comment++;
          continue;
        }

        if (line.startsWith('/*')) {
          comment++;
          if (!line.includes('*/') || line.indexOf('*/') < line.indexOf('/*') + 2) {
            inBlockComment = true;
          }
          continue;
        }

        code++;
      } else if (['.html', '.htm', '.xml', '.wxml', '.svg'].includes(ext)) {
        if (inBlockComment) {
          comment++;
          if (line.includes('-->')) inBlockComment = false;
          continue;
        }
        if (line.startsWith('<!--')) {
          comment++;
          if (!line.includes('-->')) inBlockComment = true;
          continue;
        }
        code++;
      } else if (['.sh', '.bash', '.ps1', '.bat', '.yaml', '.yml', '.toml', '.env', '.env.example'].includes(ext)) {
        if (line.startsWith('#') || (ext === '.bat' && (line.startsWith('::') || line.toUpperCase().startsWith('REM ')))) {
          comment++;
        } else {
          code++;
        }
      } else {
        // Markdown, JSON 等无标准块注释或结构化文本
        code++;
      }
    }

    const stat = fs.statSync(filePath);

    return {
      total: lines.length,
      code,
      comment,
      blank,
      size: stat.size
    };
  } catch {
    return null;
  }
}

/**
 * 递归扫描全目录收集代码指标
 */
function scanCodebaseMetrics(targetDir = PROJECT_ROOT) {
  const filesList = [];
  const languageStats = new Map();
  const moduleStats = new Map();

  let totalFiles = 0;
  let totalLines = 0;
  let totalCode = 0;
  let totalComment = 0;
  let totalBlank = 0;
  let totalSize = 0;

  function processFile(fullPath) {
    const name = path.basename(fullPath);
    if (IGNORE_FILE_NAMES.has(name) || (name.startsWith('.') && !['.env', '.env.example'].includes(name))) {
      return;
    }

    let ext = path.extname(name).toLowerCase();
    if (!ext && (name === '.env' || name === '.env.example')) {
      ext = name;
    }

    const langDef = LANGUAGE_DEFINITIONS[ext];
    if (!langDef) {
      return;
    }

    const analysis = analyzeSingleFile(fullPath, ext);
    if (!analysis) return;

    const relPath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');
    if (relPath.startsWith('Host/Tokenizers/') || relPath === 'Host/Tokenizers') {
      return;
    }

    // 计算所在的主模块名 (如 UI, Backend, Host, Tools 等)
    let topModule = relPath.split('/')[0] || 'Root';
    if (topModule.includes('.')) {
      topModule = 'Root (根配置)';
    }

    const fileRecord = {
      relPath,
      name,
      module: topModule,
      ext,
      lang: langDef.name,
      category: langDef.category,
      ...analysis
    };

    filesList.push(fileRecord);

    totalFiles++;
    totalLines += analysis.total;
    totalCode += analysis.code;
    totalComment += analysis.comment;
    totalBlank += analysis.blank;
    totalSize += analysis.size;

    // 语言分类累加
    const lKey = langDef.name;
    if (!languageStats.has(lKey)) {
      languageStats.set(lKey, { name: lKey, files: 0, total: 0, code: 0, comment: 0, blank: 0, size: 0 });
    }
    const lObj = languageStats.get(lKey);
    lObj.files++;
    lObj.total += analysis.total;
    lObj.code += analysis.code;
    lObj.comment += analysis.comment;
    lObj.blank += analysis.blank;
    lObj.size += analysis.size;

    // 模块分类累加
    if (!moduleStats.has(topModule)) {
      moduleStats.set(topModule, { name: topModule, files: 0, total: 0, code: 0, comment: 0, blank: 0, size: 0 });
    }
    const mObj = moduleStats.get(topModule);
    mObj.files++;
    mObj.total += analysis.total;
    mObj.code += analysis.code;
    mObj.comment += analysis.comment;
    mObj.blank += analysis.blank;
    mObj.size += analysis.size;
  }

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      const fullPath = path.join(currentDir, name);

      if (entry.isDirectory()) {
        const relDir = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');
        if (
          IGNORE_DIR_NAMES.has(name) ||
          name.startsWith('.') ||
          relDir === 'Host/Tokenizers' ||
          relDir.startsWith('Host/Tokenizers/')
        ) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        processFile(fullPath);
      }
    }
  }

  try {
    const rootStat = fs.statSync(targetDir);
    if (rootStat.isFile()) {
      processFile(targetDir);
    } else if (rootStat.isDirectory()) {
      walk(targetDir);
    }
  } catch {}

  // 区分统计程序代码与配置数据
  let programCode = 0;
  let dataLines = 0;
  let docLines = 0;

  filesList.forEach((f) => {
    if (f.category === 'code' || f.category === 'style' || f.category === 'markup' || f.category === 'script' || f.category === 'data') {
      programCode += f.code;
    } else if (f.category === 'config') {
      dataLines += f.code;
    } else if (f.category === 'doc') {
      docLines += f.code;
    }
  });

  // 排序
  const sortedLanguages = Array.from(languageStats.values()).sort((a, b) => b.code - a.code);
  const sortedModules = Array.from(moduleStats.values()).sort((a, b) => b.code - a.code);
  const topLargestFiles = [...filesList].sort((a, b) => b.code - a.code).slice(0, 25);

  const commentRatio = totalLines > 0 ? ((totalComment / totalLines) * 100).toFixed(1) : '0.0';
  const codeRatio = totalLines > 0 ? ((totalCode / totalLines) * 100).toFixed(1) : '0.0';

  return {
    targetDir,
    totalFiles,
    totalLines,
    totalCode,
    totalComment,
    totalBlank,
    totalSize,
    programCode,
    dataLines,
    docLines,
    commentRatio,
    codeRatio,
    languages: sortedLanguages,
    modules: sortedModules,
    topFiles: topLargestFiles,
    allFiles: filesList
  };
}

// ----------------- 视图渲染函数 -----------------

/**
 * 视图 1: 📊 总体概览与语言分布
 */
function renderLanguageView(metrics) {
  let out = '';
  out += '+========================================================================================+\n';
  out += `|  📊 全项目代码量与文件规模总览 (Codebase Overview & Language Metrics)\n`;
  out += `|  📂 统计根目录: ${path.relative(PROJECT_ROOT, metrics.targetDir) || '.'}  |  🕒 统计耗时: 实时极速扫描完成\n`;
  out += '+========================================================================================+\n\n';

  out += '【总体指标概览】：\n';
  out += `  📄 源码文件总数: \x1b[1m\x1b[36m${metrics.totalFiles}\x1b[0m 个\t\t📦 代码库总大小: \x1b[1m\x1b[33m${(metrics.totalSize / 1024).toFixed(1)} KB\x1b[0m (${(metrics.totalSize / (1024 * 1024)).toFixed(2)} MB)\n`;
  out += `  📝 全量总行数  : \x1b[1m\x1b[32m${metrics.totalLines.toLocaleString()}\x1b[0m 行\t💡 综合注释率  : \x1b[1m\x1b[36m${metrics.commentRatio}%\x1b[0m (注释: \x1b[36m${metrics.totalComment.toLocaleString()}\x1b[0m 行 | 空行: \x1b[90m${metrics.totalBlank.toLocaleString()}\x1b[0m 行)\n`;
  out += `  💻 核心程序源码: \x1b[1m\x1b[32m${metrics.programCode.toLocaleString()}\x1b[0m 行 (TS/JS/C/TSX/CSS/HTML/Shell)  |  📦 数据/配置: \x1b[33m${metrics.dataLines.toLocaleString()}\x1b[0m 行  |  📖 文档: \x1b[35m${metrics.docLines.toLocaleString()}\x1b[0m 行\n\n`;

  out += '+----------------------------------------------------------------------------------------+\n';
  out += '【按编程语言 / 文件类型分布清单】：\n\n';
  out += `  ${padVisual('语言 / 类型', 16)} ${padVisual('文件数', 8, true)} ${padVisual('纯代码行', 12, true)} ${padVisual('注释行', 10, true)} ${padVisual('总行数', 12, true)}  占比分布\n`;
  out += `  ${'-'.repeat(16)} ${'-'.repeat(8)} ${'-'.repeat(12)} ${'-'.repeat(10)} ${'-'.repeat(12)}  ${'-'.repeat(22)}\n`;

  metrics.languages.forEach((l) => {
    const pct = metrics.totalCode > 0 ? (l.code / metrics.totalCode) * 100 : 0;
    const bar = renderProgressBar(pct, 12);
    const pctStr = padVisual(`${pct.toFixed(1)}%`, 6, true);

    const langCol = padVisual(l.name, 16);
    const filesCol = padVisual(String(l.files), 8, true);
    const codeCol = padVisual(l.code.toLocaleString(), 12, true);
    const commentCol = padVisual(l.comment.toLocaleString(), 10, true);
    const totalCol = padVisual(l.total.toLocaleString(), 12, true);

    out += `  \x1b[1m\x1b[37m${langCol}\x1b[0m \x1b[36m${filesCol}\x1b[0m \x1b[32m${codeCol}\x1b[0m \x1b[90m${commentCol}\x1b[0m \x1b[37m${totalCol}\x1b[0m  ${bar} ${pctStr}\n`;
  });

  return out;
}

/**
 * 视图 2: 📁 子系统与模块分布
 */
function renderModuleView(metrics) {
  let out = '';
  out += '+========================================================================================+\n';
  out += `|  📁 子系统与模块代码规模分布 (Subsystem & Monorepo Modules)\n`;
  out += '+========================================================================================+\n\n';

  out += `  ${padVisual('子系统 / 目录', 18)} ${padVisual('文件数', 8, true)} ${padVisual('纯代码行', 12, true)} ${padVisual('注释行', 10, true)} ${padVisual('总行数', 12, true)} ${padVisual('大小', 10, true)}  占比分布\n`;
  out += `  ${'-'.repeat(18)} ${'-'.repeat(8)} ${'-'.repeat(12)} ${'-'.repeat(10)} ${'-'.repeat(12)} ${'-'.repeat(10)}  ${'-'.repeat(18)}\n`;

  metrics.modules.forEach((m) => {
    const pct = metrics.totalCode > 0 ? (m.code / metrics.totalCode) * 100 : 0;
    const bar = renderProgressBar(pct, 10);
    const pctStr = padVisual(`${pct.toFixed(1)}%`, 6, true);
    const sizeKb = padVisual(`${(m.size / 1024).toFixed(1)}K`, 10, true);

    const modCol = padVisual(m.name, 18);
    const filesCol = padVisual(String(m.files), 8, true);
    const codeCol = padVisual(m.code.toLocaleString(), 12, true);
    const commentCol = padVisual(m.comment.toLocaleString(), 10, true);
    const totalCol = padVisual(m.total.toLocaleString(), 12, true);

    out += `  \x1b[1m\x1b[36m${modCol}\x1b[0m \x1b[37m${filesCol}\x1b[0m \x1b[32m${codeCol}\x1b[0m \x1b[90m${commentCol}\x1b[0m \x1b[37m${totalCol}\x1b[0m \x1b[33m${sizeKb}\x1b[0m  ${bar} ${pctStr}\n`;
  });

  return out;
}

/**
 * 视图 3: 🏆 大文件规模排行榜 Top 25
 */
function renderTopFilesView(metrics) {
  let out = '';
  out += '+========================================================================================+\n';
  out += `|  🏆 代码量 Top 25 大文件排行榜 (Largest Source Code Files)\n`;
  out += '+========================================================================================+\n\n';

  out += `  ${padVisual('排名', 5)} ${padVisual('文件相对路径', 46)} ${padVisual('语言', 12)} ${padVisual('纯代码行', 10, true)} ${padVisual('总行数', 9, true)}\n`;
  out += `  ${'-'.repeat(5)} ${'-'.repeat(46)} ${'-'.repeat(12)} ${'-'.repeat(10)} ${'-'.repeat(9)}\n`;

  metrics.topFiles.forEach((f, idx) => {
    const rankStr = padVisual(`[#${idx + 1}]`, 5);
    let pathDisplay = f.relPath;
    if (getVisualWidth(pathDisplay) > 44) {
      pathDisplay = '...' + pathDisplay.substring(pathDisplay.length - 41);
    }
    const pathCol = padVisual(pathDisplay, 46);
    const langCol = padVisual(f.lang, 12);
    const codeCol = padVisual(f.code.toLocaleString(), 10, true);
    const totalCol = padVisual(f.total.toLocaleString(), 9, true);

    const rankColor = idx < 3 ? '\x1b[1m\x1b[33m' : idx < 10 ? '\x1b[1m\x1b[36m' : '\x1b[90m';
    out += `  ${rankColor}${rankStr}\x1b[0m \x1b[37m${pathCol}\x1b[0m \x1b[90m${langCol}\x1b[0m \x1b[1m\x1b[32m${codeCol}\x1b[0m \x1b[90m${totalCol}\x1b[0m\n`;
  });

  return out;
}

/**
 * 导出全景统计报告为 Markdown 文档
 */
function exportMetricsMarkdown(metrics) {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `QuickPatrol_Code_Statistics_${dateTag}.md`;
  const filePath = path.join(DOCS_DIR, fileName);

  let md = `# 高校后勤巡查e速办 v4.0 全项目代码量与文件规模深度统计报告

> 统计生成时间：${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}  
> 统计范围：高校后勤巡查e速办 v4.0 全项目源代码

---

## 📊 一、 总体核心指标概览 (Executive Metrics)

| 指标维度 | 统计数值 | 说明 |
| :--- | :--- | :--- |
| 📄 **源码文件总数** | **${metrics.totalFiles}** 个 | 排除依赖包与构建产物后的有效源码 |
| 📝 **代码总行数** | **${metrics.totalLines.toLocaleString()}** 行 | 包含纯代码、注释与空行 |
| 💻 **纯代码行数 (SLOC)** | **${metrics.totalCode.toLocaleString()}** 行 (${metrics.codeRatio}%) | 实际可执行有效源码行数 |
| 💬 **注释行数** | **${metrics.totalComment.toLocaleString()}** 行 | 架构说明与注释行 |
| 💡 **项目注释率** | **${metrics.commentRatio}%** | 架构可读性与文档完善度指标 |
| ⚪ **空白行数** | **${metrics.totalBlank.toLocaleString()}** 行 | 代码排版留白 |
| 📦 **源码总存储容量** | **${(metrics.totalSize / 1024).toFixed(1)} KB** (${(metrics.totalSize / (1024 * 1024)).toFixed(2)} MB) | 纯源码文本大小 |

---

## 💻 二、 编程语言与文件类型分布 (Language Breakdown)

| 编程语言 / 文件类型 | 文件数量 | 纯代码行 (SLOC) | 注释行数 | 总行数 | 纯代码占比 |
| :--- | :---: | :---: | :---: | :---: | :---: |
`;

  metrics.languages.forEach((l) => {
    const pct = metrics.totalCode > 0 ? ((l.code / metrics.totalCode) * 100).toFixed(1) : '0.0';
    md += `| **${l.name}** | ${l.files} | ${l.code.toLocaleString()} | ${l.comment.toLocaleString()} | ${l.total.toLocaleString()} | **${pct}%** |\n`;
  });

  md += `
---

## 📁 三、 Monorepo 子系统与领域分布 (Subsystem Breakdown)

| 子系统 / 领域模块 | 涉及文件数 | 纯代码行 (SLOC) | 注释行数 | 总行数 | 占用容量 | 模块代码占比 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  metrics.modules.forEach((m) => {
    const pct = metrics.totalCode > 0 ? ((m.code / metrics.totalCode) * 100).toFixed(1) : '0.0';
    md += `| **${m.name}** | ${m.files} | ${m.code.toLocaleString()} | ${m.comment.toLocaleString()} | ${m.total.toLocaleString()} | ${(m.size / 1024).toFixed(1)} KB | **${pct}%** |\n`;
  });

  md += `
---

## 🏆 四、 代码量 Top 25 大文件排行榜 (Largest Files)

| 排名 | 文件相对路径 | 语言类型 | 纯代码行 (SLOC) | 总行数 | 文件大小 |
| :---: | :--- | :--- | :---: | :---: | :---: |
`;

  metrics.topFiles.forEach((f, idx) => {
    md += `| #${idx + 1} | \`${f.relPath}\` | ${f.lang} | **${f.code.toLocaleString()}** | ${f.total.toLocaleString()} | ${(f.size / 1024).toFixed(1)} KB |\n`;
  });

  md += `
---
*本报告由高校后勤巡查e速办工程化运维工具箱 (TOOL_COUNT_CODE_LINES) 自动分析生成。*
`;

  fs.writeFileSync(filePath, md, 'utf-8');
  return filePath;
}

// ----------------- 主控制器 -----------------

async function main() {
  if (process.argv.includes('--summary') || !process.stdin.isTTY) {
    const metrics = scanCodebaseMetrics(PROJECT_ROOT);
    process.stdout.write(renderLanguageView(metrics));
    process.stdout.write('\n' + renderModuleView(metrics));
    process.exit(0);
  }

  let currentTargetDir = PROJECT_ROOT;
  let activeTab = 'lang'; // 'lang' | 'module' | 'top'

  while (true) {
    clearScreen();
    const metrics = scanCodebaseMetrics(currentTargetDir);

    let contentOut = '';
    if (activeTab === 'lang') {
      contentOut = renderLanguageView(metrics);
    } else if (activeTab === 'module') {
      contentOut = renderModuleView(metrics);
    } else if (activeTab === 'top') {
      contentOut = renderTopFilesView(metrics);
    }

    let footer = '';
    footer += '\n+----------------------------------------------------------------------------------------+\n';
    footer += '视图切换: [\x1b[1m\x1b[36m1\x1b[0m 语言分布] [\x1b[1m\x1b[32m2\x1b[0m 模块分布] [\x1b[1m\x1b[33m3\x1b[0m 大文件排行] [\x1b[1m\x1b[35m4\x1b[0m 深入子路径] [\x1b[1m\x1b[32m5\x1b[0m 导出MD] [\x1b[31mESC\x1b[0m 返回]\n';

    process.stdout.write(contentOut + footer);

    const key = await getKeyPress();

    if (key === 'ESC' || key === 'q') {
      process.exit(0);
    }

    if (key === '1' || key === 'l' || key === 'L') {
      activeTab = 'lang';
      continue;
    }

    if (key === '2' || key === 'm' || key === 'M') {
      activeTab = 'module';
      continue;
    }

    if (key === '3' || key === 't' || key === 'T') {
      activeTab = 'top';
      continue;
    }

    if (key === '4' || key === 's' || key === 'S') {
      const input = await askQuestion('\n👉 请输入要深入统计的子目录相对路径 (如 Backend 或 WeChatMiniProgram，直接回车重置为全项目): ');
      if (!input.trim()) {
        currentTargetDir = PROJECT_ROOT;
        console.log('\n✔ 已重置为统计全项目！');
      } else {
        const customAbs = path.resolve(PROJECT_ROOT, input.trim().replace(/^['"]|['"]$/g, ''));
        if (fs.existsSync(customAbs)) {
          currentTargetDir = customAbs;
          console.log(`\n✔ 已切换统计目标为: \x1b[36m${path.relative(PROJECT_ROOT, customAbs)}\x1b[0m`);
        } else {
          console.log(`\n❌ 路径不存在: ${input.trim()}`);
        }
      }
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (key === '5' || key === 'e' || key === 'E') {
      const savedPath = exportMetricsMarkdown(metrics);
      const relSaved = path.relative(PROJECT_ROOT, savedPath);
      console.log(`\n✔ 代码量分析报告已成功导出保存至: \x1b[1m\x1b[32m${relSaved}\x1b[0m\n`);

      if (process.platform === 'win32') {
        const openNow = await askQuestion('👉 是否在资源管理器中定位该 Markdown 文件？[y/n] (默认 y): ');
        if (!openNow || openNow.toLowerCase() === 'y') {
          spawn('explorer.exe', [`/select,${savedPath}`], { detached: true });
        }
      } else {
        await getKeyPress('👉 按 [回车] 继续...');
      }
      continue;
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 代码统计控制台异常:', err);
  process.exit(1);
});
