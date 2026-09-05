import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  TerminalLogger,
  publishRedis,
  subscribeRedis,
} from "../shared/index.js";

interface ConnectedClient {
  openId: string;
  ws: WebSocket;
  connectedAt: number;
}

const localClients: Map<string, Set<WebSocket>> = new Map();
const messageHandlers: Map<string, Array<(openId: string, value: any) => Promise<void> | void>> = new Map();

const CLUSTER_WS_CHANNEL = "ws:cluster:message";
const CLUSTER_BROADCAST_CHANNEL = "ws:cluster:broadcast";

let wss: WebSocketServer | null = null;
let isSubscribed = false;

export function initWsGateway(server: http.Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname : "";
    if (pathname.startsWith("/api") || pathname.startsWith("/ws")) {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    let clientOpenId: string | null = null;

    ws.on("message", (rawMessage) => {
      try {
        const msgStr = rawMessage.toString();
        const msg = JSON.parse(msgStr);

        if (msg.key === "openId") {
          // 首次握手注册 openId
          clientOpenId = msg.value;
          if (!localClients.has(clientOpenId!)) {
            localClients.set(clientOpenId!, new Set());
          }
          localClients.get(clientOpenId!)!.add(ws);

          TerminalLogger.info(`[WS 上线] openId: ${clientOpenId}`, "WebSocket");
          // 握手成功确认应答
          ws.send(JSON.stringify({ key: "connected", value: true }));
        } else {
          if (!clientOpenId) return;

          TerminalLogger.debug(`[WS 收到消息] openId: ${clientOpenId} | key: ${msg.key}`, "WebSocket");
          const handlers = messageHandlers.get(msg.key);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(clientOpenId, msg.value);
              } catch (e) {
                TerminalLogger.error(`WS handler execution error: ${e}`, "WebSocket");
              }
            }
          }
        }
      } catch (err) {
        TerminalLogger.warn(`WS invalid message received: ${rawMessage}`, "WebSocket");
      }
    });

    ws.on("close", () => {
      if (clientOpenId && localClients.has(clientOpenId)) {
        const clientSet = localClients.get(clientOpenId)!;
        clientSet.delete(ws);
        if (clientSet.size === 0) {
          localClients.delete(clientOpenId);
          TerminalLogger.info(`[WS 下线] openId: ${clientOpenId}`, "WebSocket");
        }
      }
    });

    ws.on("error", (err) => {
      TerminalLogger.error(`WS client error: ${err.message}`, "WebSocket");
    });
  });

  // 跨节点 Redis Pub/Sub 订阅
  setupClusterSubscription();

  TerminalLogger.info("WebSocket 网关初始化完成 (支持跨4进程 Redis 消息广播)", "WebSocket");
}

async function setupClusterSubscription() {
  if (isSubscribed) return;
  isSubscribed = true;

  // 订阅定向推送
  await subscribeRedis(CLUSTER_WS_CHANNEL, (messageStr: string) => {
    try {
      const { openId, key, value, sourceNode } = JSON.parse(messageStr);
      const currentNode = process.env.NODE_ID || "node";
      if (sourceNode && sourceNode === currentNode) {
        return; // 过滤本节点自己广播出去的回环消息，避免重复投递
      }
      // 如果本节点存在该用户的连接，则投递
      sendDirectLocal(openId, key, value);
    } catch (e) {
      TerminalLogger.error(`Parse cluster ws message failed: ${e}`, "WebSocket");
    }
  });

  // 订阅全局广播
  await subscribeRedis(CLUSTER_BROADCAST_CHANNEL, (messageStr: string) => {
    try {
      const { key, value, sourceNode } = JSON.parse(messageStr);
      const currentNode = process.env.NODE_ID || "node";
      if (sourceNode && sourceNode === currentNode) {
        return; // 过滤本节点自己广播出去的回环消息，避免重复投递
      }
      broadcastLocal(key, value);
    } catch (e) {
      TerminalLogger.error(`Parse cluster broadcast failed: ${e}`, "WebSocket");
    }
  });
}

function sendDirectLocal(openId: string, key: string, value: any): boolean {
  const sockets = localClients.get(openId);
  if (!sockets || sockets.size === 0) return false;

  const payload = JSON.stringify({ key, value });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
  return true;
}

function broadcastLocal(key: string, value: any) {
  if (!wss) return;
  const payload = JSON.stringify({ key, value });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * 向特定用户发送 WebSocket 消息 (跨4个进程自动同步)
 */
export async function sendWsMessage(openId: string, key: string, value: any) {
  // 1. 先尝试在当前进程内直接发送
  const localSent = sendDirectLocal(openId, key, value);

  // 2. 同时发布到 Redis Pub/Sub，让其他 3 个进程也尝试发送
  await publishRedis(
    CLUSTER_WS_CHANNEL,
    JSON.stringify({
      openId,
      key,
      value,
      sourceNode: process.env.NODE_ID || "node",
    })
  );
}

/**
 * 向全网所有在线客户端广播消息 (跨4个进程自动同步)
 */
export async function broadcastWsMessage(key: string, value: any) {
  broadcastLocal(key, value);
  await publishRedis(
    CLUSTER_BROADCAST_CHANNEL,
    JSON.stringify({
      key,
      value,
      sourceNode: process.env.NODE_ID || "node",
    })
  );
}

/**
 * 注册自定义业务 WS 消息处理器
 */
export function onWsMessage(key: string, handler: (openId: string, value: any) => Promise<void> | void) {
  if (!messageHandlers.has(key)) {
    messageHandlers.set(key, []);
  }
  messageHandlers.get(key)!.push(handler);
}

export function getLocalOnlineUserCount(): number {
  return localClients.size;
}
