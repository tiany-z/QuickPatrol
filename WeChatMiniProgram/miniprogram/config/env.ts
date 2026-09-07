/**
 * 全局运行环境与网络网关配置
 * 后端服务默认端口 HTTP_PORT=8000
 */

// 开发环境与生产环境判定
const isDev = true;

export const ENV_CONFIG = {
  isDev,
  // 统一后端 API 基础地址（对齐 Backend/1.env 中的 8000 端口）
  apiBase: isDev ? 'http://127.0.0.1:8000' : 'https://api.quickpatrol.edu.cn',
  // 统一 WebSocket 地址
  wsBase: isDev ? 'ws://127.0.0.1:8000/ws' : 'wss://api.quickpatrol.edu.cn/ws',
  // 租户切换免密凭据存根服务
  transitBase: isDev ? 'http://127.0.0.1:8000' : 'https://api.quickpatrol.edu.cn',
  // 默认请求超时时间
  timeout: 10000,
};

export const API_BASE = ENV_CONFIG.apiBase;
export const WS_BASE = ENV_CONFIG.wsBase;
