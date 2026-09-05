/**
 * config_helper.js
 * 
 * 集中管理全项目根目录的 AI 大模型接口配置、依赖状态及跨平台工具函数
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const CONFIG_FILE_PATH = path.join(PROJECT_ROOT, 'chat_sys_config.json');

const DEFAULT_CONFIG = {
  apiKey: '',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  initialized: false
};

/**
 * 检查项目根目录是否已完成初始化配置 (chat_sys_config.json 是否存在且标记初始化)
 */
export function isProjectInitialized() {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) {
      return false;
    }
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Boolean(parsed && (parsed.initialized === true || (typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0)));
  } catch {
    return false;
  }
}

/**
 * 检查当前是否已配置有效的 AI API Key
 */
export function hasValidAiKey() {
  const config = getAiConfig();
  return Boolean(config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim().length > 0);
}

/**
 * 检查是否存在上次依赖安装失败记录
 */
export function getDependencyInstallError() {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.dependency_install_error || null;
  } catch {
    return null;
  }
}

/**
 * 记录依赖安装失败信息
 */
export function setDependencyInstallError(errorInfo) {
  try {
    let current = {};
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      current = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf-8'));
    }
    current.dependency_install_error = errorInfo;
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(current, null, 2), 'utf-8');
  } catch {}
}

/**
 * 清理依赖安装失败记录
 */
export function clearDependencyInstallError() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const current = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf-8'));
      if (current.dependency_install_error) {
        delete current.dependency_install_error;
        fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(current, null, 2), 'utf-8');
      }
    }
  } catch {}
}

/**
 * 获取当前生效的 AI API 配置
 */
export function getAiConfig() {
  let config = { ...DEFAULT_CONFIG };

  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      config = { ...config, ...parsed };
    }
  } catch {}

  if (process.env.OPENAI_API_KEY) config.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_API_BASE) config.apiBase = process.env.OPENAI_API_BASE;
  if (process.env.OPENAI_MODEL) config.model = process.env.OPENAI_MODEL;

  config.apiBase = (config.apiBase || 'https://api.deepseek.com').replace(/\/+$/, '');
  return config;
}

/**
 * 保存 AI API 配置到根目录 chat_sys_config.json
 */
export function saveAiConfig(newConfig) {
  const current = getAiConfig();
  const merged = { ...current, ...newConfig };
  merged.apiBase = (merged.apiBase || 'https://api.deepseek.com').replace(/\/+$/, '');
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/**
 * 跨平台智能自动唤起系统默认浏览器打开 URL（自动判断环境并捕获异常，绝不崩溃）
 */
export function tryAutoOpenBrowser(url) {
  try {
    const platform = process.platform;
    let cmd = '';
    let args = [];

    if (platform === 'win32') {
      cmd = 'cmd';
      args = ['/c', 'start', '', url];
    } else if (platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }

    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.on('error', () => {
      // 在无图形界面或找不到浏览器程序时静默忽略，依赖终端打印链接
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
