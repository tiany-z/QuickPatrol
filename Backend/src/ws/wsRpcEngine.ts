import { WebSocket } from "ws";
import { WsRpcRequestPayload, WsRpcResponsePayload } from "./wsTypes.js";
import { TerminalLogger } from "../shared/log/terminalLogger.js";

type RpcHandler = (payload: any, socket: WebSocket) => Promise<any> | any;

interface PendingRpcItem {
  resolve: (data: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}

/**
 * M06: WsRpcEngine 双向 WS-RPC 调度与 3000ms 熔断引擎
 * 提供类似 HTTP Request-Response 的全双工强回执调用协议，并在超时（默认 3000ms）时自动熔断释放内存。
 */
export class WsRpcEngine {
  public static readonly DEFAULT_TIMEOUT_MS = 3000;
  private static handlers = new Map<string, RpcHandler>();
  private static pendingRequests = new Map<string, PendingRpcItem>();

  /**
   * 注册 RPC 业务方法处理器
   */
  public static registerHandler(action: string, handler: RpcHandler): void {
    this.handlers.set(action, handler);
  }

  /**
   * 处理对端发来的 RPC 请求并原路回传执行回执
   */
  public static async dispatchIncomingRequest(
    socket: WebSocket,
    req: WsRpcRequestPayload
  ): Promise<void> {
    const { action, payload, requestId } = req;
    const startTime = Date.now();
    const handler = this.handlers.get(action);

    if (!handler) {
      this.sendResponse(socket, {
        requestId,
        success: false,
        error: `RPC Handler Not Found for Action: ${action}`,
        elapsedMs: Date.now() - startTime,
      });
      return;
    }

    try {
      const result = await handler(payload, socket);
      this.sendResponse(socket, {
        requestId,
        success: true,
        data: result,
        elapsedMs: Date.now() - startTime,
      });
    } catch (err: any) {
      this.sendResponse(socket, {
        requestId,
        success: false,
        error: err.message || "Internal RPC Execution Error",
        elapsedMs: Date.now() - startTime,
      });
    }
  }

  /**
   * 处理接收到的对端 RPC 执行响应
   */
  public static dispatchIncomingResponse(res: WsRpcResponsePayload): void {
    const { requestId, success, data, error } = res;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return; // 已超时熔断或已被消费
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);

    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error || "Remote WS-RPC Execution Failed"));
    }
  }

  /**
   * 主动向对端发起 RPC 调用并挂起 Promise (超时自动熔断)
   */
  public static request<T = any>(
    socket: WebSocket,
    action: string,
    payload: any,
    timeoutMs: number = WsRpcEngine.DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return reject(new Error("Cannot perform WS-RPC: Socket is not open"));
      }

      const requestId = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `[WS-RPC Timeout] 超过 ${timeoutMs}ms 未收到对端回执 | Action: ${action} | RequestId: ${requestId}`
          )
        );
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        socket.send(
          JSON.stringify({
            key: "_request",
            value: {
              action,
              payload,
              requestId,
            },
          })
        );
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  private static sendResponse(socket: WebSocket, response: WsRpcResponsePayload): void {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(
          JSON.stringify({
            key: "_response",
            value: response,
          })
        );
      } catch (err) {
        TerminalLogger.error(`[M06] 回传 RPC 响应失败: ${err}`, "WebSocket");
      }
    }
  }

  public static getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 清理全部注册与挂起任务 (单元测试环境重置使用)
   */
  public static clearAll(): void {
    for (const item of this.pendingRequests.values()) {
      clearTimeout(item.timer);
    }
    this.pendingRequests.clear();
    this.handlers.clear();
  }
}
