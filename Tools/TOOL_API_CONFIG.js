/**
 * TOOL_API_CONFIG.js
 * 
 * AI 接口配置管理与连通性测试工具 (AI API Config & Connection Tester)
 * 
 * 核心功能：
 *   1. 查看当前生效的 AI 大模型 API 三项关键参数 (Key / Base / Model)；
 *   2. 【纯内存极速渲染 + 上下键/回车/ESC】点了即刻生效，零延迟响应；
 *   3. 实时发起 AI 对话连通性测试，验证 API 可用性与模型响应速度。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import readline from 'node:readline';
import { getAiConfig, saveAiConfig, CONFIG_FILE_PATH } from './config_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      resolve(answer.trim());
    });
  });
}

/**
 * 掩码格式化 API Key (例如: sk-f189****02dc)
 */
function maskApiKey(key) {
  if (!key) return '(未配置)';
  if (key.length <= 10) return '******';
  return key.substring(0, 7) + '****' + key.substring(key.length - 4);
}

// 内存配置缓存
let cachedConfig = getAiConfig();

function refreshCachedConfig() {
  cachedConfig = getAiConfig();
  return cachedConfig;
}

/**
 * 功能 1: 实时测试 AI 对话连通性
 */
async function handleTestConnection() {
  clearScreen();
  const config = cachedConfig;

  console.log('+========================================================================+');
  console.log('|\t🧪 [测试] AI 接口连通性实时检测');
  console.log('+========================================================================+\n');

  console.log('📋 当前用于测试的参数：');
  console.log(`\t🔑 API Key:\t\x1b[36m${maskApiKey(config.apiKey)}\x1b[0m`);
  console.log(`\t🌐 API Base:\t\x1b[33m${config.apiBase}\x1b[0m`);
  console.log(`\t🤖 Model:\t\x1b[32m${config.model}\x1b[0m\n`);

  console.log('⏳ 正在向 AI 服务端发送测试请求 (Prompt: "请确认连接状态")... ');

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
          { role: 'system', content: 'You are an AI connectivity tester for QuickPatrol.' },
          { role: 'user', content: '你好，这是一条高校后勤巡查e速办工具箱连通性测试消息，请回复一句话确认当前接口状态正常。' }
        ],
        temperature: 0.1,
        max_tokens: 150
      })
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!res.ok) {
      const errText = await res.text();
      console.log('\x1b[31m✖ 请求失败\x1b[0m\n');
      console.log('+------------------------------------------------------------------------+');
      console.log(`|\t❌ HTTP 错误状态码:\t${res.status} ${res.statusText}`);
      console.log(`|\t⏱️ 请求耗时:\t\t${duration}s`);
      console.log('+------------------------------------------------------------------------+');
      console.log(`\n服务端返回详情:\n${errText}\n`);
    } else {
      const data = await res.json();
      const aiReply = (data.choices?.[0]?.message?.content || '').trim();

      console.log('\x1b[32m✔ 连接成功！\x1b[0m\n');
      console.log('+========================================================================+');
      console.log('|\t🎉 AI 接口与对话测试百分之百通过！');
      console.log(`|\t⏱️ 往返耗时 (Latency):\t\x1b[1m\x1b[32m${duration} 秒\x1b[0m`);
      console.log(`|\t🤖 响应模型 (Model):\t\x1b[1m\x1b[36m${data.model || config.model}\x1b[0m`);
      console.log('+========================================================================+');
      console.log(`\n💬 AI 实时回复内容:\n\x1b[32m"${aiReply}"\x1b[0m\n`);
    }
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\x1b[31m✖ 网络异常\x1b[0m\n');
    console.log('+------------------------------------------------------------------------+');
    console.log(`|\t❌ 异常原因: ${err.message}`);
    console.log(`|\t⏱️ 请求耗时: ${duration}s`);
    console.log('+------------------------------------------------------------------------+');
  }

  await getKeyPress('👉 按 [回车] 或 [ESC] 返回配置菜单...');
}

/**
 * 功能 2: 修改 API Key
 */
async function handleModifyApiKey() {
  clearScreen();
  const config = cachedConfig;

  console.log('+========================================================================+');
  console.log('|\t🔑 修改 API Key (接口密钥)');
  console.log('+========================================================================+\n');
  console.log(`当前 API Key: ${maskApiKey(config.apiKey)}\n`);

  const input = await askQuestion('👉 请输入新的 API Key (直接回车保留原值): ');

  if (input.trim()) {
    saveAiConfig({ apiKey: input.trim() });
    refreshCachedConfig();
    console.log('\n✔ API Key 已成功更新并保存！');
  } else {
    console.log('\n💡 已保留原 API Key。');
  }
  await new Promise((r) => setTimeout(r, 600));
}

/**
 * 功能 3: 修改 API Base URL
 */
async function handleModifyApiBase() {
  clearScreen();
  const config = cachedConfig;

  console.log('+========================================================================+');
  console.log('|\t🌐 修改 API Base URL (接口地址)');
  console.log('+========================================================================+\n');
  console.log(`当前 API Base: ${config.apiBase}`);
  console.log('💡 提示：若更换为第三方服务商或代理中转，请确保同时更换对应的 Key 和 Model 名称。\n');

  const input = await askQuestion('👉 请输入新的 API Base URL (直接回车保留原值): ');

  if (input.trim()) {
    saveAiConfig({ apiBase: input.trim() });
    refreshCachedConfig();
    console.log('\n✔ API Base URL 已成功更新！');
  } else {
    console.log('\n💡 已保留原 API Base URL。');
  }
  await new Promise((r) => setTimeout(r, 600));
}

/**
 * 功能 4: 修改 Model 名称
 */
async function handleModifyModel() {
  clearScreen();
  const config = cachedConfig;

  console.log('+========================================================================+');
  console.log('|\t🤖 修改 Model 模型名称');
  console.log('+========================================================================+\n');
  console.log(`当前 Model 名称: ${config.model}`);
  console.log('💡 提示：模型名称必须与当前 API Base 平台相互匹配 (如 deepseek-chat, gpt-4o, qwen-plus 等)。\n');

  const input = await askQuestion('👉 请输入新的 Model 名称 (直接回车保留原值): ');

  if (input.trim()) {
    saveAiConfig({ model: input.trim() });
    refreshCachedConfig();
    console.log('\n✔ Model 名称已成功更新！');
  } else {
    console.log('\n💡 已保留原模型名称。');
  }
  await new Promise((r) => setTimeout(r, 600));
}

/**
 * 功能 5: 一键批量修改全部 3 项参数
 */
async function handleBatchModify() {
  clearScreen();
  const config = cachedConfig;

  console.log('+========================================================================+');
  console.log('|\t✏️  一键批量修改全部 AI 接口参数');
  console.log('+========================================================================+\n');

  const newKey = await askQuestion(`1. API Key (当前: ${maskApiKey(config.apiKey)}): `);
  const newBase = await askQuestion(`2. API Base (当前: ${config.apiBase}): `);
  const newModel = await askQuestion(`3. Model Name (当前: ${config.model}): `);

  const updates = {};
  if (newKey.trim()) updates.apiKey = newKey.trim();
  if (newBase.trim()) updates.apiBase = newBase.trim();
  if (newModel.trim()) updates.model = newModel.trim();

  if (Object.keys(updates).length > 0) {
    const updated = saveAiConfig(updates);
    refreshCachedConfig();
    console.log('\n+========================================================================+');
    console.log('|\t🎉 参数已成功保存至根目录 chat_sys_config.json！');
    console.log(`|\t🔑 API Key:\t${maskApiKey(updated.apiKey)}`);
    console.log(`|\t🌐 API Base:\t${updated.apiBase}`);
    console.log(`|\t🤖 Model:\t${updated.model}`);
    console.log('+========================================================================+\n');
  } else {
    console.log('\n💡 未做任何修改。');
  }

  await getKeyPress('👉 按 [回车] 或 [ESC] 返回配置菜单...');
}

const CONFIG_OPTIONS = [
  { id: 'test', label: '🧪 快速测试 AI 接口连通性', desc: '实时发起测试对话，验证 Key 与服务端可用性' },
  { id: 'key', label: '🔑 修改 API Key (接口密钥)', desc: '更新 AI 大模型接口访问密钥' },
  { id: 'base', label: '🌐 修改 API Base URL (接口地址)', desc: '配置服务商官方 API 或第三方代理中转网关' },
  { id: 'model', label: '🤖 修改 Model 模型名称', desc: '设定调用的模型名称 (需与当前 Base 平台匹配)' },
  { id: 'batch', label: '✏️  一键批量修改全部参数', desc: '按顺序连续输入并更新全部 3 项参数' },
  { id: 'back', label: '🔙 返回总控主菜单', desc: '返回上一级高校后勤巡查e速办总控台' }
];

/**
 * 纯内存原子化渲染配置主菜单
 */
function printMenu(cursorIndex = 0) {
  const config = cachedConfig;

  let out = '';
  out += '+========================================================================+\n';
  out += '|  ⚙️  AI 接口参数配置与连通性测试 (AI API Config & Test)\n';
  out += `|  📂 配置文件:\t${path.relative(PROJECT_ROOT, CONFIG_FILE_PATH)}\n`;
  out += '+========================================================================+\n';
  out += `|  🔑 API Key:\t\x1b[1m\x1b[36m${maskApiKey(config.apiKey)}\x1b[0m\n`;
  out += `|  🌐 API Base:\t\x1b[1m\x1b[33m${config.apiBase}\x1b[0m\n`;
  out += `|  🤖 Model:\t\x1b[1m\x1b[32m${config.model}\x1b[0m\n`;
  out += '+========================================================================+\n\n';

  CONFIG_OPTIONS.forEach((opt, idx) => {
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
  let cursorIndex = 0;
  refreshCachedConfig();

  while (true) {
    printMenu(cursorIndex);

    const key = await getKeyPress();

    if (key === 'ESC') {
      process.exit(0);
    }

    if (key === 'UP') {
      cursorIndex = (cursorIndex - 1 + CONFIG_OPTIONS.length) % CONFIG_OPTIONS.length;
      printMenu(cursorIndex);
      continue;
    }

    if (key === 'DOWN') {
      cursorIndex = (cursorIndex + 1) % CONFIG_OPTIONS.length;
      printMenu(cursorIndex);
      continue;
    }

    if (key === 'ENTER') {
      const selected = CONFIG_OPTIONS[cursorIndex];

      if (selected.id === 'back') {
        process.exit(0);
      } else if (selected.id === 'test') {
        await handleTestConnection();
      } else if (selected.id === 'key') {
        await handleModifyApiKey();
      } else if (selected.id === 'base') {
        await handleModifyApiBase();
      } else if (selected.id === 'model') {
        await handleModifyModel();
      } else if (selected.id === 'batch') {
        await handleBatchModify();
      }
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ 配置管理控制台异常:', err);
  process.exit(1);
});
