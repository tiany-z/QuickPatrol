import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import {
  closeWsGateway,
  initWsGateway,
  resetHandshakeTimeoutMs,
  sendWsMessage,
  setHandshakeTimeoutMs,
} from "../ws/wsGateway.js";
import { ConnectionBufferManager } from "../ws/connectionBuffer.js";
import { WsRpcEngine } from "../ws/wsRpcEngine.js";
import { RedisWsBridge } from "../ws/redisWsBridge.js";
import { signJwtToken } from "../shared/crypto/jwt.js";
import { clearChannelSubscribers, clearMemoryCache } from "../shared/cache/redis.js";

describe("M06: 高可靠 WebSocket 网关与 1 秒闪断缓冲队列 (WS & Grace Buffer)", () => {
  let server: http.Server;
  let wsUrl: string;

  beforeAll(async () => {
    // 启动本地测试 HTTP + WebSocket 回环服务器
    server = http.createServer();
    initWsGateway(server);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await closeWsGateway();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    clearMemoryCache();
    clearChannelSubscribers();
    ConnectionBufferManager.clearAll();
    WsRpcEngine.clearAll();
    RedisWsBridge.resetBridge();
    resetHandshakeTimeoutMs();
  });

  describe("用例 1: 3000ms 未鉴权连接超时主动掐断测试", () => {
    it("客户端建立连接后超过握手窗口未发送握手帧，服务端必须主动以 4001 掐断", async () => {
      // 为了让单元测试快速执行，动态设置握手窗口为 250ms
      setHandshakeTimeoutMs(250);

      const ws = new WebSocket(wsUrl);

      const closeResult = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeResult.code).toBe(4001);
      expect(closeResult.reason).toContain("Handshake Timeout");
    });
  });

  describe("用例 2: 二阶段握手成功与 SessionId 派生断言", () => {
    it("携带合法 JWT 鉴权成功，派生 sess_* 并进入 CONNECTED 状态", async () => {
      const tokenRes = signJwtToken({
        userId: 1001,
        schoolId: 1,
        openId: "wx_test_open_001",
      });
      expect(tokenRes.status).toBe(1);
      const token = tokenRes.data!;

      const ws = new WebSocket(wsUrl);

      const connectedPromise = new Promise<any>((resolve) => {
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.key === "connected") {
            resolve(msg.value);
          }
        });
      });

      await new Promise<void>((resolve) => ws.on("open", () => resolve()));

      // 发送二阶段握手帧
      ws.send(
        JSON.stringify({
          key: "handshake",
          value: {
            token,
            schoolId: 1,
          },
        })
      );

      const connectedPayload = await connectedPromise;
      expect(connectedPayload.sessionId).toMatch(/^sess_1_1001_/);
      expect(connectedPayload.reconnected).toBe(false);
      expect(connectedPayload.flushedCount).toBe(0);

      expect(ConnectionBufferManager.getActiveSessionCount()).toBe(1);

      ws.close();
    });
  });

  describe("用例 3: 500ms 物理断线热重连与 GraceBuffer 100% 冲刷验证", () => {
    it("断网期间下发业务消息进入 GraceBuffer，热重连成功后 100% 补发", async () => {
      const token = signJwtToken({
        userId: 1001,
        schoolId: 1,
        openId: "wx_test_open_001",
      }).data!;

      // 1. 首次建立连接并完成握手
      const ws1 = new WebSocket(wsUrl);
      const session1Promise = new Promise<string>((resolve) => {
        ws1.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.key === "connected") resolve(msg.value.sessionId);
        });
      });

      await new Promise<void>((resolve) => ws1.on("open", () => resolve()));
      ws1.send(
        JSON.stringify({
          key: "handshake",
          value: { token, schoolId: 1 },
        })
      );
      const originalSessionId = await session1Promise;

      // 2. 模拟物理网络闪断 (Close Event)
      await new Promise<void>((resolve) => {
        ws1.on("close", () => resolve());
        ws1.close();
      });

      // 稍等 50ms 确保服务端完全感知 TCP 断开并触发 handleSocketDisconnect
      await new Promise((r) => setTimeout(r, 50));

      expect(ConnectionBufferManager.getWaitingSessionCount()).toBe(1);

      // 3. 断线期间，下游业务 (如抢修派单) 下发工单通知
      const sendRes = await sendWsMessage(1, 1001, "patrol:dispatched", {
        orderId: 888,
        title: "水暖管爆裂急修",
      });
      expect(sendRes).toBe(true);

      // 4. 断网后 100ms (处于 1000ms 宽限内)，客户端恢复连接并携带 lastSessionId
      await new Promise((r) => setTimeout(r, 100));

      const ws2 = new WebSocket(wsUrl);
      const receivedMessages: any[] = [];

      const reconnectedPromise = new Promise<any>((resolve) => {
        ws2.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          receivedMessages.push(msg);
          if (msg.key === "connected") {
            resolve(msg.value);
          }
        });
      });

      await new Promise<void>((resolve) => ws2.on("open", () => resolve()));
      ws2.send(
        JSON.stringify({
          key: "handshake",
          value: {
            token,
            schoolId: 1,
            lastSessionId: originalSessionId,
          },
        })
      );

      const reconnectValue = await reconnectedPromise;
      expect(reconnectValue.reconnected).toBe(true);
      expect(reconnectValue.flushedCount).toBe(1);
      expect(reconnectValue.sessionId).toBe(originalSessionId);

      // 5. 等待事件循环接收冲刷补发的消息
      await new Promise((r) => setTimeout(r, 50));

      const bufferedItem = receivedMessages.find((m) => m.key === "patrol:dispatched");
      expect(bufferedItem).toBeDefined();
      expect(bufferedItem._buffered).toBe(true);
      expect(bufferedItem.value.orderId).toBe(888);
      expect(bufferedItem.value.title).toBe("水暖管爆裂急修");

      ws2.close();
    });
  });

  describe("用例 4: 超过 1000ms 未重连会话彻底销毁与内存清退测试", () => {
    it("超过 1000ms 宽限期仍未重连，旧会话与缓冲池彻底物理销毁", async () => {
      const token = signJwtToken({
        userId: 2002,
        schoolId: 1,
      }).data!;

      const ws = new WebSocket(wsUrl);
      const sessionPromise = new Promise<string>((resolve) => {
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.key === "connected") resolve(msg.value.sessionId);
        });
      });

      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      ws.send(
        JSON.stringify({
          key: "handshake",
          value: { token, schoolId: 1 },
        })
      );
      const sessionId = await sessionPromise;

      // 客户端断开连接
      await new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.close();
      });

      // 稍等 50ms 确保服务端完全感知断开
      await new Promise((r) => setTimeout(r, 50));

      expect(ConnectionBufferManager.getWaitingSessionCount()).toBe(1);

      // 等待 1100ms (超出 1000ms 宽限期)
      await new Promise((r) => setTimeout(r, 1100));

      // 验证原会话已被彻底销毁
      expect(ConnectionBufferManager.getWaitingSessionCount()).toBe(0);
      const destroyedSession = ConnectionBufferManager.getSession(sessionId);
      expect(destroyedSession?.state).toBe("DESTROYED");

      // 再次使用已销毁的 sessionId 重连，将被降级为全新会话，绝不复用
      const wsNew = new WebSocket(wsUrl);
      const newConnectPromise = new Promise<any>((resolve) => {
        wsNew.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.key === "connected") resolve(msg.value);
        });
      });

      await new Promise<void>((resolve) => wsNew.on("open", () => resolve()));
      wsNew.send(
        JSON.stringify({
          key: "handshake",
          value: { token, schoolId: 1, lastSessionId: sessionId },
        })
      );

      const newConnectRes = await newConnectPromise;
      expect(newConnectRes.reconnected).toBe(false);
      expect(newConnectRes.flushedCount).toBe(0);

      wsNew.close();
    });
  });

  describe("用例 5: 双向 WS-RPC 请求-响应强回执闭环测试", () => {
    it("客户端发起 WS-RPC 请求，服务端处理器执行并在 50ms 内返回强回执", async () => {
      const token = signJwtToken({
        userId: 3003,
        schoolId: 1,
      }).data!;

      // 注册服务端业务 RPC Handler
      WsRpcEngine.registerHandler("order:take", async (payload) => {
        return {
          orderId: payload.orderId,
          status: "ACCEPTED",
          takerName: "王师傅",
          acceptedAt: Date.now(),
        };
      });

      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => ws.on("open", () => resolve()));
      ws.send(
        JSON.stringify({
          key: "handshake",
          value: { token, schoolId: 1 },
        })
      );

      await new Promise<void>((resolve) => {
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.key === "connected") resolve();
        });
      });

      // 客户端发起 RPC 请求
      const rpcResponsePromise = new Promise<any>((resolve) => {
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.key === "_response") resolve(msg.value);
        });
      });

      ws.send(
        JSON.stringify({
          key: "_request",
          value: {
            action: "order:take",
            payload: { orderId: 12345 },
            requestId: "req_test_001",
          },
        })
      );

      const rpcRes = await rpcResponsePromise;
      expect(rpcRes.requestId).toBe("req_test_001");
      expect(rpcRes.success).toBe(true);
      expect(rpcRes.data.orderId).toBe(12345);
      expect(rpcRes.data.status).toBe("ACCEPTED");
      expect(rpcRes.data.takerName).toBe("王师傅");

      ws.close();
    });
  });

  describe("用例 6: WS-RPC 超时熔断拒绝断言", () => {
    it("对端未在指定超时时间内响应，本地 Promise 必须超时熔断拒绝且清理挂起表", async () => {
      // 模拟一个无响应的 WebSocket
      const dummySocket = {
        readyState: WebSocket.OPEN,
        send: () => {},
      } as any;

      const startTime = Date.now();
      const promise = WsRpcEngine.request(dummySocket, "system:no_reply", {}, 100);

      await expect(promise).rejects.toThrow("[WS-RPC Timeout]");
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(90);

      // 验证挂起表已完全清理，杜绝内存泄漏
      expect(WsRpcEngine.getPendingCount()).toBe(0);
    });
  });
});
