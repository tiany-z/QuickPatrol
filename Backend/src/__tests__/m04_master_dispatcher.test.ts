import { describe, expect, it, beforeAll, afterAll } from "vitest";
import http from "http";
import {
  dispatchHttpRequest,
  registerRoute,
  scanAndPrecompileApiRoutes,
} from "../dispatcher/index.js";
import { normalizeUrlPath, parseJsonBody } from "../utils/httpHelper.js";
import { returnSuccess, signJwtToken } from "../shared/index.js";
import { Readable } from "stream";

describe("M04: MasterDispatcher 动态路由分发与 CORS 预检引擎 (Gateway Engine)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // 1. 装载并预编译既有物理 API 路由
    await scanAndPrecompileApiRoutes();

    // 2. 动态注册一个受限业务接口 (authRequired: true)，用于多通道鉴权测试
    registerRoute("/api/test/secure", {
      routePath: "/api/test/secure",
      authRequired: true,
      handler: async (_data, ctx) => {
        return returnSuccess({
          message: "Secure Data Accessed",
          userId: ctx.userPayload?.userId,
          schoolId: ctx.userPayload?.schoolId,
        });
      },
    });

    // 3. 启动本地真实回环 HTTP 服务器
    server = http.createServer(async (req, res) => {
      await dispatchHttpRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("用例 1: 0ms OPTIONS 跨域预检短路测试 (返回完整 CORS 头)", () => {
    it("发送 OPTIONS 请求必须立即短路返回 HTTP 200 及完整 CORS 标头", async () => {
      const startTime = Date.now();
      const res = await fetch(`${baseUrl}/api/system/ping`, {
        method: "OPTIONS",
      });
      const duration = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(duration).toBeLessThan(150); // 极速短路响应 (容忍高并发并发度调度抖动)
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("OPTIONS");
      expect(res.headers.get("access-control-allow-headers")).toContain("token");
      expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
      expect(res.headers.get("x-backend-node")).toBeDefined();

      const json = (await res.json()) as any;
      expect(json.status).toBe(1);
    });
  });

  describe("用例 2: URL 正规化测试 (末尾单斜杠/多斜杠自动剔除)", () => {
    it("normalizeUrlPath 算法函数应精准清除末尾冗余斜杠", () => {
      expect(normalizeUrlPath("/api/system/ping/")).toBe("/api/system/ping");
      expect(normalizeUrlPath("/api/system/ping///")).toBe("/api/system/ping");
      expect(normalizeUrlPath("/api/system/ping?query=1")).toBe("/api/system/ping");
      expect(normalizeUrlPath("/")).toBe("/");
      expect(normalizeUrlPath("")).toBe("/");
    });

    it("带单斜杠或多斜杠的 HTTP 请求均能 100% 精准匹配原路由", async () => {
      const res1 = await fetch(`${baseUrl}/api/system/ping/`);
      const res2 = await fetch(`${baseUrl}/api/system/ping///`);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const json1 = (await res1.json()) as any;
      const json2 = (await res2.json()) as any;

      expect(json1.status).toBe(1);
      expect(json2.status).toBe(1);
      expect(json1.data?.message).toBe("pong");
      expect(json2.data?.message).toBe("pong");
    });
  });

  describe("用例 3: 404 路由丢失包裹为 HTTP 200 报文测试 (No-Fail Envelope)", () => {
    it("请求不存在的路径应返回 HTTP 200 并包裹 status=0 的 404 报文", async () => {
      const res = await fetch(`${baseUrl}/api/random/unknown_route_path_404`);
      // 微信友好设计：HTTP 传输层必须是 200，绝不触发小程序底层 fail 回调
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.status).toBe(0);
      expect(json.content).toContain("API 404 Not Found");
      expect(json.content).toContain("/api/random/unknown_route_path_404");
    });
  });

  describe("用例 4: 双通道 Token 提取优先级与缺失 401 拦截测试", () => {
    const testPayload = { userId: 999, schoolId: 1, openId: "wx_test_openid" };
    const validJwt = signJwtToken(testPayload).data!;

    it("4a: 通过微信小程序通道 (headers.token) 访问受限接口应成功放行", async () => {
      const res = await fetch(`${baseUrl}/api/test/secure`, {
        headers: {
          token: validJwt,
        },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.status).toBe(1);
      expect(json.data?.userId).toBe(999);
      expect(json.data?.schoolId).toBe(1);
    });

    it("4b: 通过标准工业级通道 (Authorization: Bearer) 访问受限接口同样放行", async () => {
      const res = await fetch(`${baseUrl}/api/test/secure`, {
        headers: {
          Authorization: `Bearer ${validJwt}`,
        },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.status).toBe(1);
      expect(json.data?.userId).toBe(999);
    });

    it("4c: 未传递 Token 访问受限接口，应返回友好包裹的 401 提示", async () => {
      const res = await fetch(`${baseUrl}/api/test/secure`);
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.status).toBe(0);
      expect(json.content).toContain("未登录或缺少身份凭证");
    });

    it("4d: 传递非法或篡改的 Token 访问受限接口，应被拦截拒绝", async () => {
      const res = await fetch(`${baseUrl}/api/test/secure`, {
        headers: {
          token: "malformed_invalid_jwt_token_string",
        },
      });
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.status).toBe(0);
      expect(json.content).toContain("Token 无效或已过期");
    });
  });

  describe("用例 5: 公开免密接口携 Token 身份自动补齐测试", () => {
    it("免密公共接口未携 Token 正常放行，且用户身份自动降级为访客", async () => {
      const res = await fetch(`${baseUrl}/api/system/ping`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.status).toBe(1);
      expect(json.data?.message).toBe("pong");
    });

    it("免密公共接口主动携带 Token 时，网关静默解析填充用户上下文而不中断", async () => {
      const validJwt = signJwtToken({ userId: 666, username: "guest_upgrade" }).data!;
      const res = await fetch(`${baseUrl}/api/system/ping`, {
        headers: {
          token: validJwt,
        },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.status).toBe(1);
      expect(json.data?.message).toBe("pong");
    });
  });

  describe("用例 6: 50MB 超大包流式截断与拒绝测试", () => {
    it("parseJsonBody 面对超过 50MB 的超大流式载荷时，应主动掐断连接并熔断拒绝", async () => {
      // 构造一个模拟超过 50MB 的 Mock IncomingMessage 流
      const mockReq = new Readable({
        read() {
          // 推送超过 50MB 的巨型分片
          const hugeChunk = Buffer.alloc(10 * 1024 * 1024, "a"); // 10MB
          this.push(hugeChunk);
          this.push(hugeChunk);
          this.push(hugeChunk);
          this.push(hugeChunk);
          this.push(hugeChunk);
          this.push(hugeChunk); // 累计 60MB > 50MB
          this.push(null);
        },
      }) as any;

      mockReq.headers = {};
      mockReq.destroy = () => {};

      const res = await parseJsonBody(mockReq, 50 * 1024 * 1024);
      expect(res.status).toBe(0);
      expect(res.content).toContain("超出 50MB 安全配额");
    });
  });

  describe("用例 7: X-Backend-Node 响应头注入测试", () => {
    it("所有正常响应、错误响应与预检响应均必须包含 X-Backend-Node 诊断标头", async () => {
      const res1 = await fetch(`${baseUrl}/api/system/ping`);
      expect(res1.headers.get("x-backend-node")).toBeDefined();

      const res2 = await fetch(`${baseUrl}/api/system/ping`, { method: "OPTIONS" });
      expect(res2.headers.get("x-backend-node")).toBeDefined();

      const res3 = await fetch(`${baseUrl}/api/unknown/any_path`);
      expect(res3.headers.get("x-backend-node")).toBeDefined();
    });
  });
});
