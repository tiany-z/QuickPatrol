import http from "http";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { TerminalLogger } from "../shared/log/terminalLogger.js";
import { verifyJwtToken } from "../shared/crypto/jwt.js";
import { ConnectionBufferManager } from "./connectionBuffer.js";
import { WsRpcEngine } from "./wsRpcEngine.js";
import { RedisWsBridge } from "./redisWsBridge.js";
import { WsHandshakePayload, WsSessionContext } from "./wsTypes.js";

let wss: WebSocketServer | null = null;
let handshakeTimeoutMs = 3000;

export function setHandshakeTimeoutMs(ms: number): void {
  handshakeTimeoutMs = ms;
}

export function resetHandshakeTimeoutMs(): void {
  handshakeTimeoutMs = 3000;
}

export function getHandshakeTimeoutMs(): number {
  return handshakeTimeoutMs;
}

const legacyMessageHandlers: Map<
  string,
  Array<(openId: string, value: any) => Promise<void> | void>
> = new Map();

/**
 * 初始化高可靠 WebSocket 网关中枢 (二阶段握手、1s 闪断缓冲队列与 WS-RPC 调度)
 */
export function initWsGateway(server: http.Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url
      ? new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname
      : "";
    if (pathname.startsWith("/api") || pathname.startsWith("/ws")) {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket, _req: http.IncomingMessage) => {
    let currentSession: WsSessionContext | null = null;

    // 阶段一：建立物理连接，启动 3000ms 握手鉴权倒计时
    const handshakeTimer = setTimeout(() => {
      if (!currentSession) {
        TerminalLogger.warn(
          "[M06] 客户端物理连接超过 3000ms 未进行二阶段鉴权握手，强制主动掐断",
          "WebSocket"
        );
        try {
          ws.close(4001, "Handshake Timeout");
        } catch {}
      }
    }, getHandshakeTimeoutMs());

    ws.on("message", async (rawMessage) => {
      try {
        const msgStr = rawMessage.toString();
        const msg = JSON.parse(msgStr);

        // 处理握手帧 (阶段二：业务载荷鉴权)
        if (msg.key === "handshake") {
          clearTimeout(handshakeTimer);
          const payload: WsHandshakePayload = msg.value;

          if (!payload || !payload.token) {
            ws.close(4001, "Missing Handshake Token");
            return;
          }

          // 校验 Token
          const authRes = verifyJwtToken(payload.token);
          if (authRes.status === 0 || !authRes.data) {
            ws.close(4001, "Invalid Handshake Token");
            return;
          }

          const authUser = authRes.data;
          const schoolId = payload.schoolId || authUser.schoolId || 1;
          const userId = Number(authUser.userId || 0);
          const openId = authUser.openId || "";

          // 检查租户匹配防越权
          if (authUser.schoolId && authUser.schoolId !== schoolId) {
            ws.close(4001, "Tenant Mismatch in Handshake");
            return;
          }

          // 尝试 1000ms 闪断热重连自愈
          if (payload.lastSessionId) {
            const resumeRes = ConnectionBufferManager.tryResumeSession(
              payload.lastSessionId,
              schoolId,
              userId,
              ws
            );
            if (resumeRes.resumed && resumeRes.session) {
              currentSession = resumeRes.session;
              ws.send(
                JSON.stringify({
                  key: "connected",
                  value: {
                    sessionId: currentSession.sessionId,
                    serverTime: Date.now(),
                    reconnected: true,
                    flushedCount: resumeRes.flushedCount,
                  },
                })
              );
              return;
            }
          }

          // 全新上线生成高熵 SessionId
          const epoch = Math.floor(Date.now() / 1000);
          const signature = crypto
            .createHash("md5")
            .update(`${schoolId}_${userId}_${epoch}`)
            .digest("hex")
            .slice(0, 8);
          const sessionId = `sess_${schoolId}_${userId}_${epoch}_${signature}`;

          currentSession = {
            sessionId,
            schoolId,
            userId,
            openId,
            socket: ws,
            state: "CONNECTED",
            connectedAt: Date.now(),
            lastActiveAt: Date.now(),
            graceBuffer: [],
          };

          ConnectionBufferManager.registerSession(currentSession);

          ws.send(
            JSON.stringify({
              key: "connected",
              value: {
                sessionId,
                serverTime: Date.now(),
                reconnected: false,
                flushedCount: 0,
              },
            })
          );
          return;
        }

        // 未握手前拦截所有业务帧
        if (!currentSession) {
          TerminalLogger.warn(
            "[M06] 未鉴权会话尝试发送业务消息，已拦截阻断",
            "WebSocket"
          );
          return;
        }

        currentSession.lastActiveAt = Date.now();

        // 双向 WS-RPC 调度
        if (msg.key === "_request") {
          await WsRpcEngine.dispatchIncomingRequest(ws, msg.value);
        } else if (msg.key === "_response") {
          WsRpcEngine.dispatchIncomingResponse(msg.value);
        } else {
          // 常规业务事件分发 (包含向后兼容 onWsMessage)
          TerminalLogger.debug(
            `[M06 收到事件] Key: ${msg.key} | User: ${currentSession.userId}`,
            "WebSocket"
          );
          const handlers = legacyMessageHandlers.get(msg.key);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(currentSession.openId, msg.value);
              } catch (e) {
                TerminalLogger.error(`WS handler execution error: ${e}`, "WebSocket");
              }
            }
          }
        }
      } catch (err) {
        TerminalLogger.error(`[M06] 消息解析异常: ${err}`, "WebSocket");
      }
    });

    ws.on("close", () => {
      clearTimeout(handshakeTimer);
      ConnectionBufferManager.handleSocketDisconnect(ws);
    });

    ws.on("error", (err) => {
      TerminalLogger.error(`[M06] 套接字异常: ${err.message}`, "WebSocket");
    });
  });

  // 跨微服务集群 Redis Pub/Sub 总线对接
  RedisWsBridge.initBridge((packet) => {
    if (packet.targetUserId) {
      // 定向推送
      ConnectionBufferManager.sendOrBuffer(
        packet.schoolId,
        Number(packet.targetUserId),
        {
          key: packet.channel,
          value: packet.data,
        }
      );
    } else {
      // 租户全校广播
      broadcastWsMessage(packet.channel, packet.data, packet.schoolId);
    }
  });

  TerminalLogger.info(
    "[M06] 高可靠 WebSocket 网关就绪 (含二阶段握手、1s 闪断缓冲队列与双向 WS-RPC 调度)",
    "WebSocket"
  );

  return wss;
}

/**
 * 业务层统一推送入口 (自动兼顾本地直发、GraceBuffer 缓冲与跨进程 Redis 广播)
 */
export async function sendWsMessage(
  schoolId: number,
  userId: number,
  key: string,
  value: any
): Promise<boolean>;
export async function sendWsMessage(
  openId: string,
  key: string,
  value: any
): Promise<boolean>;
export async function sendWsMessage(
  arg1: number | string,
  arg2: number | string,
  arg3: any,
  arg4?: any
): Promise<boolean> {
  if (typeof arg1 === "number") {
    const schoolId = arg1;
    const userId = Number(arg2);
    const key = String(arg3);
    const value = arg4;

    const localSent = ConnectionBufferManager.sendOrBuffer(schoolId, userId, {
      key,
      value,
    });
    // 同时发布到 M05 集群广播总线，同步至其他微服务进程
    await RedisWsBridge.broadcast(
      "ws:cluster:direct",
      schoolId,
      { key, value },
      userId
    );
    return localSent;
  } else {
    // 兼容旧版基于 openId 的调用 (单校默认 schoolId=1, userId=0)
    const openId = arg1;
    const key = String(arg2);
    const value = arg3;
    const localSent = ConnectionBufferManager.sendOrBuffer(1, 0, { key, value });
    await RedisWsBridge.broadcast("ws:cluster:direct", 1, { openId, key, value });
    return localSent;
  }
}

/**
 * 全网或指定学校在线客户端广播消息
 */
export async function broadcastWsMessage(
  key: string,
  value: any,
  schoolId?: number
): Promise<void> {
  const payload = JSON.stringify({ key, value });
  if (wss) {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // 同步发布到 Redis 广播总线
  await RedisWsBridge.broadcast("ws:cluster:broadcast", schoolId || 1, {
    key,
    value,
  });
}

/**
 * 注册自定义业务 WS 消息处理器
 */
export function onWsMessage(
  key: string,
  handler: (openId: string, value: any) => Promise<void> | void
): void {
  if (!legacyMessageHandlers.has(key)) {
    legacyMessageHandlers.set(key, []);
  }
  legacyMessageHandlers.get(key)!.push(handler);
}

/**
 * 获取本地在线活跃会话数量
 */
export function getLocalOnlineUserCount(): number {
  return ConnectionBufferManager.getActiveSessionCount();
}

/**
 * 关闭 WebSocket 网关 (服务下线或单测销毁使用)
 */
export async function closeWsGateway(): Promise<void> {
  if (wss) {
    await new Promise<void>((resolve) => {
      wss!.close(() => resolve());
    });
    wss = null;
  }
  ConnectionBufferManager.clearAll();
  WsRpcEngine.clearAll();
}
