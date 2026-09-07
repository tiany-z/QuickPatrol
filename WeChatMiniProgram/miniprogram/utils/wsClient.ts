/**
 * 高校后勤巡查e速办 v4.0 - 小程序端企业级 WebSocket 客户端 (M06)
 * 核心特性：二阶段鉴权握手、1000ms 闪断无感重连、双向 WS-RPC 强回执与指数退避
 */

type MessageHandler = (data: any) => void;

interface RpcPendingItem {
  resolve: (data: any) => void;
  reject: (err: any) => void;
  timer: any;
}

declare const wx: any;

export class QpWsClient {
  private static socketTask: any = null;
  private static sessionId: string | null = null;
  private static isConnected: boolean = false;
  private static isConnecting: boolean = false;
  private static retryCount: number = 0;
  private static reconnectTimer: any = null;

  private static eventHandlers = new Map<string, Set<MessageHandler>>();
  private static pendingRpcs = new Map<string, RpcPendingItem>();

  /**
   * 初始化并建立连接 (自动携带 Token 与 SessionId 尝试自愈)
   */
  public static connect(url: string, schoolId: number, token: string): void {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.socketTask = wx.connectSocket({
        url,
        header: { "content-type": "application/json" },
      });
    } catch (e) {
      this.isConnecting = false;
      this.handleDisconnect(url, schoolId, token);
      return;
    }

    this.socketTask.onOpen(() => {
      // 物理链路建立成功 -> 立即发起阶段二业务鉴权握手
      this.socketTask?.send({
        data: JSON.stringify({
          key: "handshake",
          value: {
            token,
            schoolId,
            lastSessionId: this.sessionId || undefined,
          },
        }),
      });
    });

    this.socketTask.onMessage((res: { data: string }) => {
      try {
        const msg = JSON.parse(res.data);

        // 握手成功确认响应
        if (msg.key === "connected") {
          this.isConnected = true;
          this.isConnecting = false;
          this.retryCount = 0;
          this.sessionId = msg.value.sessionId;

          if (msg.value.reconnected) {
            console.log(
              `[WS] ⚡ 闪断热重连成功! 已同步补发 ${msg.value.flushedCount} 条消息`
            );
          } else {
            console.log(`[WS] ✅ 首次握手成功，分配会话: ${this.sessionId}`);
          }
          return;
        }

        // WS-RPC 响应调度
        if (msg.key === "_response") {
          this.dispatchRpcResponse(msg.value);
          return;
        }

        // 常规业务事件分发
        const handlers = this.eventHandlers.get(msg.key);
        if (handlers) {
          handlers.forEach((h) => h(msg.value));
        }
      } catch (err) {
        console.error("[WS] 报文解析异常", err);
      }
    });

    this.socketTask.onClose(() => {
      this.handleDisconnect(url, schoolId, token);
    });

    this.socketTask.onError(() => {
      this.handleDisconnect(url, schoolId, token);
    });
  }

  /**
   * 优雅断网重连逻辑 (结合指数退避与随机扰动 Full Jitter)
   */
  private static handleDisconnect(url: string, schoolId: number, token: string): void {
    this.isConnected = false;
    this.isConnecting = false;
    this.socketTask = null;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // 核心退避算法: 200ms * 2^retryCount，最大不超过 3000ms
    const baseDelay = Math.min(3000, 200 * Math.pow(2, this.retryCount));
    const jitterDelay = Math.floor(Math.random() * baseDelay);
    this.retryCount++;

    this.reconnectTimer = setTimeout(() => {
      console.log(
        `[WS] 尝试自愈重连 (第 ${this.retryCount} 次, 延时 ${jitterDelay}ms)...`
      );
      this.connect(url, schoolId, token);
    }, jitterDelay);
  }

  /**
   * 双向 WS-RPC 强类型调用
   */
  public static request<T = any>(action: string, payload: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.socketTask) {
        return reject(new Error("WebSocket 未就绪，无法发起 RPC 调用"));
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // 3000ms 超时熔断
      const timer = setTimeout(() => {
        this.pendingRpcs.delete(requestId);
        reject(new Error(`[WS-RPC Timeout] 请求超时 (3000ms) | Action: ${action}`));
      }, 3000);

      this.pendingRpcs.set(requestId, { resolve, reject, timer });

      this.socketTask.send({
        data: JSON.stringify({
          key: "_request",
          value: { action, payload, requestId },
        }),
      });
    });
  }

  private static dispatchRpcResponse(res: {
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
  }): void {
    const pending = this.pendingRpcs.get(res.requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRpcs.delete(res.requestId);

    if (res.success) {
      pending.resolve(res.data);
    } else {
      pending.reject(new Error(res.error || "WS-RPC Remote Error"));
    }
  }

  /**
   * 监听业务事件
   */
  public static on(event: string, handler: MessageHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * 移除事件监听
   */
  public static off(event: string, handler: MessageHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * 主动断开并清空会话
   */
  public static close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socketTask) {
      try {
        this.socketTask.close();
      } catch {}
      this.socketTask = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.sessionId = null;
    this.retryCount = 0;
  }
}
