import { describe, expect, it, beforeAll, afterAll } from "vitest";
import http from "http";
import { getApiRoute, getAllRoutes, scanAndPrecompileApiRoutes } from "../dispatcher/apiScanner.js";
import { dispatchHttpRequest } from "../dispatcher/masterDispatcher.js";
import { signJwtToken } from "../shared/index.js";

describe("API Scanner 路由扫描与路径规范化", () => {
  beforeAll(async () => {
    await scanAndPrecompileApiRoutes();
  });

  it("应成功装载已有路由", () => {
    const routes = getAllRoutes();
    expect(routes).toContain("/api/system/ping");
    expect(routes).toContain("/api/system/health");
  });

  it("应能精准命中无斜杠路由", () => {
    const route = getApiRoute("/api/system/ping");
    expect(route).not.toBeNull();
    expect(route?.routePath).toBe("/api/system/ping");
  });

  it("末尾斜杠容错测试：带末尾斜杠也应正确匹配同一接口", () => {
    const route1 = getApiRoute("/api/system/ping");
    const route2 = getApiRoute("/api/system/ping/");
    expect(route2).not.toBeNull();
    expect(route2).toBe(route1);
  });

  it("查询未注册的路由应返回 null", () => {
    expect(getApiRoute("/api/non/existent/path")).toBeNull();
  });
});

describe("MasterDispatcher HTTP 分发与 Saga 调度 (真实 HTTP 回环测试)", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await scanAndPrecompileApiRoutes();
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

  it("OPTIONS 跨域预检应返回 200 及 CORS 响应头", async () => {
    const res = await fetch(`${baseUrl}/api/system/ping`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const json = (await res.json()) as any;
    expect(json.status).toBe(1);
    expect(json.content).toBe("OK");
  });

  it("未匹配接口应返回 200 包裹 404 错误", async () => {
    const res = await fetch(`${baseUrl}/api/unknown/route_test`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe(0);
    expect(json.content).toContain("404 Not Found");
  });

  it("公共免鉴权接口正常调用 (/api/system/ping)", async () => {
    const res = await fetch(`${baseUrl}/api/system/ping`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe(1);
    expect(json.data?.nodeId).toBeDefined();
    expect(json.data?.message).toBe("pong");
    expect(json.data?.timestamp).toBeGreaterThan(0);
  });

  it("带末尾斜杠调用也应正常成功 (/api/system/ping/)", async () => {
    const res = await fetch(`${baseUrl}/api/system/ping/`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe(1);
  });

  it("携带合法 Token 访问时，请求头应能透传并解析", async () => {
    const jwt = signJwtToken({ userId: 88, username: "tester" }).data!;
    const res = await fetch(`${baseUrl}/api/system/ping`, {
      headers: {
        token: jwt,
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe(1);
  });
});
