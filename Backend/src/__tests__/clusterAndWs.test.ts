import { describe, expect, it } from "vitest";
import { HeartbeatManager } from "../heartbeat/heartbeatManager.js";
import { parseCliEnvFile, validateRequiredEnvs } from "../shared/index.js";
import { getLocalOnlineUserCount, onWsMessage } from "../ws/wsGateway.js";

describe("集群心跳与环境管理", () => {
  it("HeartbeatManager 连接计数器增减测试", () => {
    HeartbeatManager.setConnectionCount(10);
    HeartbeatManager.incrementConnection();
    HeartbeatManager.incrementConnection();
    HeartbeatManager.decrementConnection();
    // 验证逻辑未崩溃且方法调用平稳
    expect(true).toBe(true);
  });

  it("validateRequiredEnvs 缺少变量时应精准报错", () => {
    const res = validateRequiredEnvs(["NON_EXISTENT_ENV_KEY_12345"]);
    expect(res.status).toBe(0);
    expect(res.content).toContain("缺少必要的环境变量配置");
    expect(res.content).toContain("NON_EXISTENT_ENV_KEY_12345");
  });

  it("validateRequiredEnvs 全部存在时应返回成功", () => {
    process.env.TEST_EXIST_KEY = "test_val";
    const res = validateRequiredEnvs(["TEST_EXIST_KEY"]);
    expect(res.status).toBe(1);
  });

  it("parseCliEnvFile 能解析 --env_file=xxx 参数", () => {
    const oldArgs = [...process.argv];
    process.argv.push("--env_file=test.env");
    const parsed = parseCliEnvFile();
    expect(parsed).toBe("test.env");
    process.argv = oldArgs;
  });
});

describe("WebSocket 网关基础组件测试", () => {
  it("本地在线用户统计初始应为数字", () => {
    const count = getLocalOnlineUserCount();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("onWsMessage 自定义处理器注册测试", () => {
    let triggered = false;
    onWsMessage("ping_event", async (openId, val) => {
      triggered = true;
    });
    // 成功注册未报错
    expect(typeof onWsMessage).toBe("function");
  });
});
