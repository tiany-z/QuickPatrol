/**
 * TOOL_INITIALIZE_PROJECT.js
 * 
 * 高校后勤巡查e速办 v4.0 项目一键初始化向导 (Interactive Project Initializer)
 * 
 * 核心功能：
 *   1. 【步骤 1/3】：配置 AI 大模型 API 参数 (Key / Base / Model，兼容所有 OpenAI 标准格式) 并进行实时连通性校验；
 *   2. 【步骤 2/3】：交互式配置当前项目的 Git 提交身份（用户名与邮箱）；
 *   3. 【步骤 3/3】：全自动化深度检查并一键安装后端服务 (Backend) 的 npm 依赖包（微信小程序端依赖由微信开发者工具独立管理）；
 *   4. 【配置持久化】：将配置写入根目录的 chat_sys_config.json，并更新 Git 配置。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import {
  PROJECT_ROOT,
  CONFIG_FILE_PATH,
  saveAiConfig,
  getAiConfig,
  setDependencyInstallError,
  clearDependencyInstallError
} from './config_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目核心子模块列表（仅管理 Backend 依赖；微信小程序端依赖由微信开发者工具自行管理）
export const ALL_SUBPROJECTS = [
  { name: 'Backend (高校后勤巡查后端服务)', dir: 'Backend' }
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
 * 执行 Git 命令获取配置
 */
function getGitConfig(key) {
  try {
    const res = spawnSync('git', ['config', key], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8'
    });
    return (res.stdout || '').trim();
  } catch {
    return '';
  }
}

/**
 * 执行 Git 命令设置配置
 */
function setGitConfig(key, value) {
  try {
    spawnSync('git', ['config', key, value], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8'
    });
    return true;
  } catch {
    return false;
  }
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
 * 掩码格式化 API Key
 */
function maskApiKey(key) {
  if (!key) return '\x1b[31m(尚未配置 - 必填)\x1b[0m';
  if (key.length <= 10) return '******';
  return key.substring(0, 7) + '****' + key.substring(key.length - 4);
}

/**
 * 步骤 1/3: 交互式配置 AI 大模型 API 三项核心参数
 */
async function configureAiStep() {
  const currentConfig = getAiConfig();
  let apiKey = currentConfig.apiKey;
  let apiBase = currentConfig.apiBase;
  let model = currentConfig.model;

  let cursorIndex = 0;

  function renderAiStep(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🚀 高校后勤巡查e速办 v4.0 项目一键初始化向导 (Project Initializer)\n';
    out += '|\t📂 项目根目录:\t' + PROJECT_ROOT + '\n';
    out += '+========================================================================+\n\n';
    out += '📋 【步骤 1/3：配置 AI 大模型 API 参数】\n';
    out += '💡 平台对应提示：模型名称必须与 API Base 所选平台支持的模型一致（兼容任意 OpenAI 标准接口格式服务商）。\n\n';

    const menuItems = [
      {
        id: 'key',
        label: '1. AI API Key (接口访问密钥)',
        val: maskApiKey(apiKey),
        desc: '用于调用大模型接口进行代码分析、自动提交、周报生成'
      },
      {
        id: 'base',
        label: '2. AI API Base URL (接口基地址)',
        val: `\x1b[33m${apiBase}\x1b[0m`,
        desc: '默认: https://api.deepseek.com (支持自定义服务商或代理中转)'
      },
      {
        id: 'model',
        label: '3. Model Name (模型名称)',
        val: `\x1b[32m${model}\x1b[0m`,
        desc: '默认: deepseek-v4-flash (请与当前 API Base 平台保持匹配)'
      },
      {
        id: 'next',
        label: '✔ 确认 AI 配置，立即测试连通性并进入第二步',
        isAction: true,
        desc: '向模型接口发送测试请求，验证通过后自动进入 Git 身份配置'
      },
      {
        id: 'skip',
        label: '⏭️ 暂不配置 AI Key (跳过此步，禁用 AI 功能进入第二步)',
        isAction: true,
        desc: '跳过 AI 模型配置。进入控制台后 AI 功能将自动禁用，可随时在配置中心启用'
      },
      {
        id: 'exit',
        label: '🚪 退出初始化向导',
        isAction: true,
        desc: '取消本次初始化并退出'
      }
    ];

    menuItems.forEach((item, index) => {
      const isFocused = index === idx;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';

      if (item.isAction) {
        if (isFocused) {
          out += `${pointer}\x1b[1m\x1b[32m${item.label}\x1b[0m\n`;
        } else {
          out += `${pointer}\x1b[37m${item.label}\x1b[0m\n`;
        }
        out += `\t   └─ \x1b[90m${item.desc}\x1b[0m\n\n`;
      } else {
        if (isFocused) {
          out += `${pointer}\x1b[1m\x1b[36m${item.label}\x1b[0m: ${item.val}\n`;
        } else {
          out += `${pointer}\x1b[37m${item.label}\x1b[0m: ${item.val}\n`;
        }
        out += `\t   └─ \x1b[90m${item.desc}\x1b[0m\n\n`;
      }
    });

    out += '+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 移动光标] [\x1b[32m回车\x1b[0m 编辑当前项或执行操作] [\x1b[31mESC\x1b[0m 退出]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
    return menuItems;
  }

  while (true) {
    const menuItems = renderAiStep(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return null;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + menuItems.length) % menuItems.length;
      renderAiStep(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % menuItems.length;
      renderAiStep(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = menuItems[cursorIndex];

      if (selected.id === 'exit') {
        return null;
      }

      if (selected.id === 'key') {
        console.log(`\n当前 API Key: ${maskApiKey(apiKey)}`);
        const input = await askQuestion('👉 请输入新的 API Key (直接回车保留原值): ');
        if (input.trim()) apiKey = input.trim();
        continue;
      }

      if (selected.id === 'base') {
        console.log(`\n当前 API Base URL: ${apiBase}`);
        console.log('💡 提示：若更换为第三方服务商，请同时更换对应的 API Key 和可用 Model 名称。');
        const input = await askQuestion('👉 请输入新的 API Base URL (直接回车保留原值): ');
        if (input.trim()) apiBase = input.trim();
        continue;
      }

      if (selected.id === 'model') {
        console.log(`\n当前 Model 名称: ${model}`);
        console.log('💡 提示：请确保模型名称为所选 Base URL 平台支持的模型 (如 deepseek-chat, gpt-4o, qwen-plus 等)。');
        const input = await askQuestion('👉 请输入新的 Model 名称 (直接回车保留原值): ');
        if (input.trim()) model = input.trim();
        continue;
      }

      if (selected.id === 'next') {
        if (!apiKey || apiKey.trim().length === 0) {
          console.log('\n\x1b[31m⚠️ 错误：API Key 为必填项，请输入后再继续！\x1b[0m');
          cursorIndex = 0;
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }

        const testConfig = { apiKey: apiKey.trim(), apiBase: apiBase.trim(), model: model.trim() };
        const isConnected = await testApiConnectivity(testConfig);
        if (!isConnected) {
          const retryOptions = [
            { id: 'retry', label: '🔄 重新修改 AI 参数' },
            { id: 'exit', label: '🚪 退出向导' }
          ];
          let retryCursor = 0;

          while (true) {
            console.log('请选择处理方式：\n');
            retryOptions.forEach((opt, idx) => {
              const isFocused = idx === retryCursor;
              const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';
              console.log(`${pointer}${opt.label}`);
            });
            console.log('\n操作说明: [↑/↓ 方向键选择] [回车 确认] [ESC 退出]\n');
            const rKey = await getKeyPress();
            if (rKey === 'ESC' || (rKey === 'ENTER' && retryOptions[retryCursor].id === 'exit')) {
              return null;
            }
            if (rKey === 'UP' || rKey === 'DOWN') {
              retryCursor = 1 - retryCursor;
              continue;
            }
            if (rKey === 'ENTER' && retryOptions[retryCursor].id === 'retry') {
              break;
            }
          }
          continue;
        }

        await new Promise((r) => setTimeout(r, 600));
        return testConfig;
      }

      if (selected.id === 'skip') {
        console.log('\n\x1b[33m💡 已跳过 AI 大模型接口配置。\x1b[0m');
        console.log('💡 提示：进入工具箱后所有 AI 相关功能将处于禁用状态，您可随时在 [⚙️ AI 接口参数配置] 中配置启用。\n');
        await new Promise((r) => setTimeout(r, 1200));
        return { apiKey: '', apiBase: apiBase.trim(), model: model.trim(), skipped: true, initialized: true };
      }
    }
  }
}

/**
 * 步骤 2/3: 交互式配置 Git 提交者身份 (用户名与邮箱)
 */
async function configureGitUserStep() {
  let gitUserName = getGitConfig('user.name') || '';
  let gitUserEmail = getGitConfig('user.email') || '';

  let cursorIndex = 0;

  function renderGitStep(idx) {
    let out = '';
    out += '+========================================================================+\n';
    out += '|\t🚀 高校后勤巡查e速办 v4.0 项目一键初始化向导 (Project Initializer)\n';
    out += '|\t📂 项目根目录:\t' + PROJECT_ROOT + '\n';
    out += '+========================================================================+\n\n';
    out += '📋 【步骤 2/3：配置 Git 开发者身份信息】\n\n';

    const fields = [
      {
        id: 'git_name',
        label: '1. Git 提交者用户名 (user.name)',
        val: gitUserName ? `\x1b[1m\x1b[32m${gitUserName}\x1b[0m` : '\x1b[31m(未配置)\x1b[0m',
        desc: '用于标识 Git 代码提交的作者姓名'
      },
      {
        id: 'git_email',
        label: '2. Git 提交者邮箱地址 (user.email)',
        val: gitUserEmail ? `\x1b[1m\x1b[36m${gitUserEmail}\x1b[0m` : '\x1b[31m(未配置)\x1b[0m',
        desc: '用于关联 Git 提交记录与 GitHub 账户'
      },
      {
        id: 'next',
        label: '✔ 确认 Git 身份，进入第三步 (安装全项目依赖)',
        isAction: true,
        desc: '保存当前身份配置并开始全工程依赖批量安装'
      },
      {
        id: 'back',
        label: '🔙 返回上一步 (修改 AI 接口配置)',
        isAction: true,
        desc: '回到第一步重新调整 API 密钥或模型'
      },
      {
        id: 'exit',
        label: '🚪 退出初始化向导',
        isAction: true,
        desc: '取消本次初始化并退出'
      }
    ];

    fields.forEach((item, index) => {
      const isFocused = index === idx;
      const pointer = isFocused ? '\x1b[1m\x1b[36m👉 \x1b[0m' : '   ';

      if (item.isAction) {
        if (isFocused) {
          out += `${pointer}\x1b[1m\x1b[32m${item.label}\x1b[0m\n`;
        } else {
          out += `${pointer}\x1b[37m${item.label}\x1b[0m\n`;
        }
        out += `\t   └─ \x1b[90m${item.desc}\x1b[0m\n\n`;
      } else {
        if (isFocused) {
          out += `${pointer}\x1b[1m\x1b[36m${item.label}\x1b[0m: ${item.val}\n`;
        } else {
          out += `${pointer}\x1b[37m${item.label}\x1b[0m: ${item.val}\n`;
        }
        out += `\t   └─ \x1b[90m${item.desc}\x1b[0m\n\n`;
      }
    });

    out += '+------------------------------------------------------------------------+\n';
    out += '操作说明: [\x1b[36m↑/↓\x1b[0m 移动光标] [\x1b[32m回车\x1b[0m 编辑当前项或执行操作] [\x1b[31mESC\x1b[0m 退出]\n';

    process.stdout.write('\x1B[2J\x1B[0f\x1B[3J' + out);
    return fields;
  }

  while (true) {
    const fields = renderGitStep(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      return null;
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + fields.length) % fields.length;
      renderGitStep(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % fields.length;
      renderGitStep(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = fields[cursorIndex];

      if (selected.id === 'exit') {
        return null;
      }

      if (selected.id === 'back') {
        return '__BACK__';
      }

      if (selected.id === 'git_name') {
        console.log(`\n当前 Git 用户名: ${gitUserName || '(空)'}`);
        const input = await askQuestion('👉 请输入新的 Git 用户名 (直接回车保留原值): ');
        if (input.trim()) {
          gitUserName = input.trim();
          setGitConfig('user.name', gitUserName);
          console.log(`✔ Git 用户名已更新为: ${gitUserName}`);
          await new Promise((r) => setTimeout(r, 500));
        }
        continue;
      }

      if (selected.id === 'git_email') {
        console.log(`\n当前 Git 邮箱地址: ${gitUserEmail || '(空)'}`);
        const input = await askQuestion('👉 请输入新的 Git 邮箱地址 (直接回车保留原值): ');
        if (input.trim()) {
          gitUserEmail = input.trim();
          setGitConfig('user.email', gitUserEmail);
          console.log(`✔ Git 邮箱地址已更新为: ${gitUserEmail}`);
          await new Promise((r) => setTimeout(r, 500));
        }
        continue;
      }

      if (selected.id === 'next') {
        return { gitUserName, gitUserEmail };
      }
    }
  }
}

/**
 * 验证 AI 大模型 API 连通性
 */
async function testApiConnectivity(config) {
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t🧪 【第一步验证】正在测试 AI 接口连通性...');
  console.log('+========================================================================+\n');

  console.log(`\t🔑 API Key:\t${maskApiKey(config.apiKey)}`);
  console.log(`\t🌐 API Base:\t${config.apiBase}`);
  console.log(`\t🤖 Model:\t${config.model}\n`);

  process.stdout.write('⏳ 正在向服务商发送测试请求 (验证 API Key 与地址有效性)... ');

  const startTime = Date.now();
  const url = config.apiBase.endsWith('/v1')
    ? `${config.apiBase}/chat/completions`
    : `${config.apiBase}/v1/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are an API connectivity tester.' },
          { role: 'user', content: 'Ping' }
        ],
        max_tokens: 20
      })
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!res.ok) {
      const errBody = await res.text();
      console.log('\x1b[31m✖ 连通失败\x1b[0m\n');
      console.log('+------------------------------------------------------------------------+');
      console.log(`|\t❌ HTTP 状态异常: ${res.status} ${res.statusText}`);
      console.log(`|\t⏱️ 耗时: ${duration}s`);
      console.log('+------------------------------------------------------------------------+');
      console.log(`\n服务端返回错误信息:\n${errBody}\n`);
      return false;
    }

    const data = await res.json();
    console.log('\x1b[32m✔ 连通成功！\x1b[0m\n');
    console.log('+========================================================================+');
    console.log('|\t🎉 AI 接口握手成功！');
    console.log(`|\t⏱️ 往返耗时 (Latency):\t\x1b[1m\x1b[32m${duration} 秒\x1b[0m`);
    console.log(`|\t🤖 响应模型 (Model):\t\x1b[1m\x1b[36m${data.model || config.model}\x1b[0m`);
    console.log('+========================================================================+\n');
    return true;
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\x1b[31m✖ 网络请求异常\x1b[0m\n');
    console.log('+------------------------------------------------------------------------+');
    console.log(`|\t❌ 异常原因: ${err.message}`);
    console.log(`|\t⏱️ 耗时: ${duration}s`);
    console.log('+------------------------------------------------------------------------+');
    return false;
  }
}

/**
 * 寻找系统中可用的 cnpm 可执行文件路径
 */
export function findCnpmExecutable() {
  const isWindows = process.platform === 'win32';
  const directCmd = isWindows ? 'cnpm.cmd' : 'cnpm';

  // 1. 尝试直接执行
  try {
    const res = spawnSync(directCmd, ['-v'], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000
    });
    if (res.status === 0) {
      return directCmd;
    }
  } catch {}

  // 2. Windows 平台下检索常见的全局 npm 安装路径 (如 %APPDATA%\npm\cnpm.cmd)
  if (isWindows) {
    const appData = process.env.APPDATA || '';
    const userProfile = process.env.USERPROFILE || '';
    const candidates = [
      path.join(appData, 'npm', 'cnpm.cmd'),
      path.join(userProfile, 'AppData', 'Roaming', 'npm', 'cnpm.cmd'),
      path.join(userProfile, 'AppData', 'Local', 'npm', 'cnpm.cmd'),
      'C:\\nvm4w\\nodejs\\cnpm.cmd'
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          const res = spawnSync(`"${cand}"`, ['-v'], {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000
          });
          if (res.status === 0) {
            return `"${cand}"`;
          }
        } catch {}
      }
    }
  } else {
    // Unix / Linux / macOS 候选路径检索
    const home = process.env.HOME || '/root';
    const candidates = [
      path.join(home, '.nvm/versions/node', process.version, 'bin/cnpm'),
      path.join(home, '.npm-global/bin/cnpm'),
      '/usr/local/bin/cnpm',
      '/usr/bin/cnpm'
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          const res = spawnSync(cand, ['-v'], {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000
          });
          if (res.status === 0) {
            return cand;
          }
        } catch {}
      }
    }
  }

  return null;
}

/**
 * 检测当前环境是否存在 cnpm，若不存在则自动通过 npm i -g cnpm 进行全局安装
 */
export async function ensureCnpmInstalled() {
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  // 1. 探测 cnpm 是否已就绪
  let cnpmExe = findCnpmExecutable();
  if (cnpmExe) {
    return { ok: true, cmd: cnpmExe };
  }

  // 2. cnpm 未检测到，自动执行全局安装
  console.log('+========================================================================+');
  console.log('|\t🔍 检测到当前系统尚未安装 cnpm (国内 npm 镜像加速包管理器)');
  console.log('|\t⚡ 正在自动执行 npm i -g cnpm 进行全局安装，请稍候...');
  console.log('+========================================================================+\n');

  const runInstall = async (extraPrefix = false) => {
    return new Promise((resolve) => {
      let command = npmCmd;
      let args = ['i', '-g', 'cnpm', '--registry=https://registry.npmmirror.com'];

      if (extraPrefix && isWindows && process.env.APPDATA) {
        const userNpmDir = path.join(process.env.APPDATA, 'npm');
        args = ['i', '-g', 'cnpm', `--prefix=${userNpmDir}`, '--registry=https://registry.npmmirror.com'];
      }

      const child = spawn(command, args, {
        shell: true,
        stdio: ['ignore', 'inherit', 'pipe']
      });

      let errOutput = '';
      child.stderr?.on('data', (d) => {
        errOutput += d.toString();
      });

      child.on('close', (code) => {
        resolve({ code, errOutput });
      });

      child.on('error', (err) => {
        resolve({ code: 1, errOutput: err.message });
      });
    });
  };

  let installResult = await runInstall(false);

  // 若因权限受阻 (如 EPERM)，尝试使用用户目录安装
  if (installResult.code !== 0 && isWindows) {
    console.log('\n⚠️  全局目录写入权限受限，正在尝试写入用户目录安装 cnpm...');
    installResult = await runInstall(true);
  }

  if (installResult.code !== 0) {
    console.log('\n\x1b[1m\x1b[31m✖ 全局安装 cnpm 失败！\x1b[0m');
    if (installResult.errOutput) {
      console.log(`\n错误详情:\n${installResult.errOutput}\n`);
    }
    return {
      ok: false,
      cmd: isWindows ? 'cnpm.cmd' : 'cnpm',
      error: installResult.errOutput || `Exit code ${installResult.code}`
    };
  }

  // 再次查找 cnpm
  cnpmExe = findCnpmExecutable() || (isWindows ? 'cnpm.cmd' : 'cnpm');
  console.log('\n\x1b[1m\x1b[32m✔ cnpm 全局安装就绪！\x1b[0m\n');
  return { ok: true, cmd: cnpmExe };
}

/**
 * 步骤 3/3: 批量安装所有子项目的依赖 (优先自动就绪 cnpm 并使用 cnpm install 高速安装)
 */
export async function installAllSubprojectDependencies(options = {}) {
  const recordErrorInConfig = options.recordErrorInConfig === true;
  clearScreen();
  console.log('+========================================================================+');
  console.log('|\t📦 【后端服务依赖一键安装 (cnpm 高速安装)】');
  console.log('|\t💡 说明: 微信小程序依赖由微信开发者工具独立管理，此处专注安装 Backend 服务依赖');
  console.log(`|\t包含 ${ALL_SUBPROJECTS.length} 个核心后端模块，正在准备依赖安装环境...`);
  console.log('+========================================================================+\n');

  const isWindows = process.platform === 'win32';

  // 1. 确保环境具备 cnpm
  const cnpmStatus = await ensureCnpmInstalled();
  if (!cnpmStatus.ok) {
    if (recordErrorInConfig) {
      setDependencyInstallError({
        failed_module: 'Global / cnpm',
        dir: 'N/A',
        error: cnpmStatus.error || 'Failed to install cnpm globally via npm i -g cnpm',
        timestamp: new Date().toISOString()
      });
    }
    return false;
  }

  const cnpmCmd = cnpmStatus.cmd;

  console.log('+------------------------------------------------------------------------+');
  console.log('|\t🚀 cnpm 环境就绪，正在依次执行 cnpm install 高速安装子模块依赖...');
  console.log('+------------------------------------------------------------------------+\n');

  for (let i = 0; i < ALL_SUBPROJECTS.length; i++) {
    const sub = ALL_SUBPROJECTS[i];
    const subDirAbs = path.resolve(PROJECT_ROOT, sub.dir);
    const progressTag = `[${i + 1}/${ALL_SUBPROJECTS.length}]`;

    if (!fs.existsSync(subDirAbs) || !fs.existsSync(path.join(subDirAbs, 'package.json'))) {
      console.log(`\t${progressTag} \x1b[90m[跳过]\x1b[0m ${sub.name} (未检测到 package.json)`);
      continue;
    }

    process.stdout.write(`\t${progressTag} ⏳ 正在安装 \x1b[1m\x1b[36m${sub.name}\x1b[0m 依赖... `);

    // 优先使用 cnpm install --ignore-scripts (避免 postinstall 原生编译或外网外链下载异常)
    let result = await new Promise((resolve) => {
      const child = spawn(cnpmCmd, ['install', '--ignore-scripts'], {
        cwd: subDirAbs,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let errOutput = '';
      child.stderr.on('data', (d) => { errOutput += d.toString(); });
      child.stdout.on('data', (d) => { /* quiet progress */ });

      child.on('close', (code) => {
        resolve({ code, errOutput });
      });

      child.on('error', (err) => {
        resolve({ code: 1, errOutput: err.message });
      });
    });

    // 若 cnpm 遇到异常，自动使用 npm 镜像源进行安全降级重试
    if (result.code !== 0) {
      process.stdout.write('\x1b[33m(cnpm 异常，自动切换 npm 镜像源重试...)\x1b[0m ');
      const npmCmd = isWindows ? 'npm.cmd' : 'npm';
      result = await new Promise((resolve) => {
        const child = spawn(npmCmd, ['install', '--registry=https://registry.npmmirror.com', '--no-audit', '--no-fund', '--ignore-scripts'], {
          cwd: subDirAbs,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let errOutput = '';
        child.stderr.on('data', (d) => { errOutput += d.toString(); });

        child.on('close', (code) => {
          resolve({ code, errOutput });
        });

        child.on('error', (err) => {
          resolve({ code: 1, errOutput: err.message });
        });
      });
    }

    if (result.code === 0) {
      console.log('\x1b[1m\x1b[32m✔ 成功\x1b[0m');
    } else {
      console.log('\x1b[1m\x1b[31m✖ 失败\x1b[0m');
      console.log('\n+========================================================================+');
      console.log(`|\t❌ 子模块【${sub.name}】依赖安装出错 (退出码: ${result.code})`);
      console.log('+========================================================================+');
      if (result.errOutput) {
        console.log(`\n错误详情:\n${result.errOutput}\n`);
      }
      if (recordErrorInConfig) {
        setDependencyInstallError({
          failed_module: sub.name,
          dir: sub.dir,
          error: result.errOutput || `Exit code ${result.code}`,
          timestamp: new Date().toISOString()
        });
      }
      return false;
    }
  }

  if (recordErrorInConfig) {
    clearDependencyInstallError();
  }
  console.log('\n+========================================================================+');
  console.log('|\t🎉 后端服务依赖全部安装成功！');
  console.log('+========================================================================+\n');
  return true;
}

/**
 * 主流程
 */
async function main() {
  let aiConfig = null;

  while (true) {
    // 1. 第一步：配置 AI 参数并验证
    aiConfig = await configureAiStep();
    if (!aiConfig) {
      console.log('\n🚪 已退出项目初始化向导。\n');
      process.exit(1);
    }

    // 2. 第二步：配置 Git 用户身份
    const gitUserConfig = await configureGitUserStep();
    if (gitUserConfig === '__BACK__') {
      // 返回第一步重新配置
      continue;
    }
    if (!gitUserConfig) {
      console.log('\n🚪 已退出项目初始化向导。\n');
      process.exit(1);
    }

    // 3. 第三步：安装全项目依赖
    const installOk = await installAllSubprojectDependencies();
    if (!installOk) {
      console.log('❌ 依赖安装失败，初始化未完成。请排除环境或网络问题后重新运行。\n');
      process.exit(1);
    }

    // 4. 落盘保存根配置文件
    saveAiConfig({ ...aiConfig, initialized: true });
    clearDependencyInstallError();

    console.log('+========================================================================+');
    console.log('|\t✨ 高校后勤巡查e速办 v4.0 项目一键初始化大获成功！');
    console.log(`|\t📁 配置文件已生成:\t\x1b[1m\x1b[32m${CONFIG_FILE_PATH}\x1b[0m`);
    console.log('|\t💡 (该配置文件已加入 .gitignore，不会被上传至远程仓库)');
    console.log('+========================================================================+\n');

    await getKeyPress('👉 按 [回车] 立即进入高校后勤巡查e速办总控控制台...');
    process.exit(0);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  if (process.argv.includes('--install-deps-only')) {
    installAllSubprojectDependencies().then((ok) => {
      process.exit(ok ? 0 : 1);
    });
  } else {
    main().catch((err) => {
      console.error('\n❌ 初始化向导发生异常:', err);
      process.exit(1);
    });
  }
}

