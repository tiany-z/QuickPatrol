import { WebSocket } from "ws";

/**
 * WebSocket 通信最外层帧信封契约
 */
export interface WsPacket<T = any> {
  /** 业务事件键名 (如 "handshake", "chat:msg", "_request", "_response") */
  key: string;
  /** 业务载荷对象 */
  value: T;
  /** 服务端冲刷标记 (若为 true 则表明是断网期间缓冲的历史消息) */
  _buffered?: boolean;
  /** 冲刷缓冲入队时间戳 */
  _bufferedTime?: number;
  /** 消息序号 */
  seq?: number;
}

/**
 * 二阶段握手鉴权载荷契约
 */
export interface WsHandshakePayload {
  /** 客户端持有的 JWT Token */
  token: string;
  /** 当前用户所在的高校租户 ID (强制校验) */
  schoolId: number;
  /** 可选：前一次连接分配的 SessionId (闪断重连时必须携带) */
  lastSessionId?: string;
  /** 客户端设备指纹 (如 "iOS-17.5 / WeChat-8.0.48") */
  clientDevice?: string;
}

/**
 * 二阶段握手成功响应载荷
 */
export interface WsHandshakeSuccessResponse {
  /** 本次长连接唯一分配的 SessionId */
  sessionId: string;
  /** 服务端当前高精度 UNIX 时间戳 */
  serverTime: number;
  /** 是否成功复用前一次会话 (热重连命中) */
  reconnected: boolean;
  /** 冲刷补发的消息条数 */
  flushedCount: number;
}

/**
 * WS-RPC 请求载荷
 */
export interface WsRpcRequestPayload<T = any> {
  /** 调用的远程业务方法 (如 "order:take", "chat:read_cursor") */
  action: string;
  /** 业务参数载荷 */
  payload: T;
  /** 客户端生成的唯一关联 ID (UUID) */
  requestId: string;
}

/**
 * WS-RPC 响应载荷
 */
export interface WsRpcResponsePayload<T = any> {
  /** 对应请求的关联 ID */
  requestId: string;
  /** 执行是否成功 */
  success: boolean;
  /** 成功时返回的业务数据 */
  data?: T;
  /** 失败时返回的错误描述 */
  error?: string;
  /** 响应执行耗时 (毫秒) */
  elapsedMs?: number;
}

/** 会话状态枚举 */
export type SessionState = "CONNECTED" | "WAITING_RECONNECT" | "DESTROYED";

/** 闪断缓冲队列消息项 */
export interface BufferedMessageItem {
  data: any;
  timestamp: number;
  seq: number;
}

/**
 * 服务端长连接会话状态上下文
 */
export interface WsSessionContext {
  /** 全局唯一会话 ID */
  sessionId: string;
  /** 所属高校租户 ID */
  schoolId: number;
  /** 绑定的用户自增主键 ID */
  userId: number;
  /** 微信 openId */
  openId: string;
  /** 物理底层的 WebSocket 实例 (断开待重连态时为 null) */
  socket: WebSocket | null;
  /** 会话当前状态机状态 */
  state: SessionState;
  /** 首次成功建立连接时间戳 */
  connectedAt: number;
  /** 最后一次活跃 (发包/心跳) 时间戳 */
  lastActiveAt: number;
  /** 闪断缓冲队列 (最大容量 100) */
  graceBuffer: BufferedMessageItem[];
}
