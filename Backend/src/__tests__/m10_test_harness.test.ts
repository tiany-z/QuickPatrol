import { describe, expect, it, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { TestHarness } from "./testHarness.js";
import { SagaWithdrawStack } from "../shared/sql/withdrawStack.js";

describe("M10: 模块化单元测试与 Mock 桩点测试中枢 (Test Harness Substrate)", () => {
  beforeEach(() => {
    // 每次测试前清理沙箱状态，保证用例正交独立
    TestHarness.resetSandbox();
  });

  it("M10-01: 能够确定性派生合法的虚拟租户上下文与有效 JWT", () => {
    const context = TestHarness.createMockTenantContext({
      moduleIndex: 10,
      caseIndex: 1,
      role: 2 // 师傅
    });

    // 确定性数学推导校验: schoolId = 80000 + 10 * 100 + 1 = 81001
    expect(context.schoolId).toBe(81001);
    // userId = 81001 * 10 + (2 + 1) = 810013
    expect(context.userId).toBe(810013);
    expect(context.role).toBe(2);
    expect(context.roleName).toBe("维保师傅");
    expect(context.openId).toMatch(/^wx_mock_[a-f0-9]{8}$/);
    expect(context.authHeaders.token).toBeTruthy();
    expect(context.authHeaders["x-school-id"]).toBe("81001");

    // 验证签发的 JWT 可被标准密钥正确解析
    const decoded: any = jwt.verify(
      context.token,
      process.env.JWT_SECRET || "test_jwt_secret_key_v4"
    );
    expect(decoded.schoolId).toBe(81001);
    expect(decoded.userId).toBe(810013);
    expect(decoded.role).toBe(2);
  });

  it("M10-02: AST 探针能准确放行安全合法的租户 SQL", () => {
    const safeSql =
      "SELECT * FROM `patrols` WHERE (`category` = '水电') AND `schoolId` = 81001";

    expect(() => {
      TestHarness.assertTenantSafeQuery(safeSql, 81001);
    }).not.toThrow();

    const report = TestHarness.verifyTenantIsolation(safeSql, 81001);
    expect(report.passed).toBe(true);
    expect(report.errorType).toBeUndefined();
  });

  it("M10-03: AST 探针能精准拦截缺失 schoolId 的越权 SQL", () => {
    const unsafeSql = "SELECT * FROM `patrols` WHERE `category` = '水电'";

    expect(() => {
      TestHarness.assertTenantSafeQuery(unsafeSql);
    }).toThrow(/缺少强制租户隔离字段/);

    const report = TestHarness.verifyTenantIsolation(unsafeSql);
    expect(report.passed).toBe(false);
    expect(report.errorType).toBe("MISSING_TENANT_ID");
  });

  it("M10-04: AST 探针能敏锐识别未加括号保护的 OR 短路越权漏洞", () => {
    // 典型的 OR 越权注入漏洞 SQL: 缺少括号包裹，OR 导致跨租户全表泄露
    const vulnerableSql =
      "SELECT * FROM `patrols` WHERE `category` = '水电' OR `status` = 1 AND `schoolId` = 81001";

    expect(() => {
      TestHarness.assertTenantSafeQuery(vulnerableSql);
    }).toThrow(/OR 短路越权风险/);

    const report = TestHarness.verifyTenantIsolation(vulnerableSql);
    expect(report.passed).toBe(false);
    expect(report.errorType).toBe("OR_SHORT_CIRCUIT_RISK");
  });

  it("M10-05: 内存级 Redis Spy 桩点具备完整的 KV 与 TTL 过期能力", async () => {
    const redis = TestHarness.getRedisSpy();

    await redis.set("test:key:001", JSON.stringify({ name: "单元测试" }), "EX", 60);
    const raw = await redis.get("test:key:001");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).name).toBe("单元测试");

    expect(await redis.exists("test:key:001")).toBe(1);

    const mgetRes = await redis.mget("test:key:001", "non_existent_key");
    expect(mgetRes[0]).toBe(raw);
    expect(mgetRes[1]).toBeNull();

    await redis.del("test:key:001");
    expect(await redis.exists("test:key:001")).toBe(0);
    expect(await redis.get("test:key:001")).toBeNull();
  });

  it("M10-06: 内存级 Redis Spy 桩点具备异步 Pub/Sub 广播总线订阅能力", async () => {
    const redis = TestHarness.getRedisSpy();

    let receivedMsg = "";
    redis.subscribe("test:cluster:bus", (msg) => {
      receivedMsg = msg;
    });

    const subCount = await redis.publish("test:cluster:bus", "Hello M10 Cluster Bus");
    expect(subCount).toBe(1);

    // 等待微任务异步事件投递
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(receivedMsg).toBe("Hello M10 Cluster Bus");
  });

  it("M10-07: Saga 事务撤回栈的确定性回滚与 LIFO 逆序模拟断言", async () => {
    const stack = new SagaWithdrawStack();
    const executedRollbacks: string[] = [];

    // 模拟正向业务注册 3 个补偿动作
    stack.push(async () => {
      executedRollbacks.push("c1_rollback_material_stock");
    });
    stack.push(async () => {
      executedRollbacks.push("c2_unfreeze_master_quota");
    });
    stack.push(async () => {
      executedRollbacks.push("c3_revoke_dispatch_record");
    });

    expect(stack.size()).toBe(3);

    // 触发回滚撤回
    await stack.withdrawAll();

    // 验证回滚补偿操作严格按照 LIFO (后进先出) 逆序执行: c3 -> c2 -> c1
    const expectedOrder = [
      "c3_revoke_dispatch_record",
      "c2_unfreeze_master_quota",
      "c1_rollback_material_stock"
    ];

    const result = await TestHarness.assertSagaRollback(executedRollbacks, expectedOrder);

    expect(result.isStrictLifo).toBe(true);
    expect(result.expectedCompensations).toBe(3);
    expect(result.actualCompensations).toBe(3);
    expect(result.executionLogs).toEqual(expectedOrder);
    expect(stack.size()).toBe(0);
  });

  it("M10-08: resetSandbox 能彻底隔离多用例执行环境，杜绝数据残留", async () => {
    const redis = TestHarness.getRedisSpy();

    await redis.set("sandbox:leaked:key", "some_dirty_data");
    expect(await redis.get("sandbox:leaked:key")).toBe("some_dirty_data");
    expect(redis.size()).toBeGreaterThan(0);

    // 执行沙箱重置
    TestHarness.resetSandbox();

    expect(redis.size()).toBe(0);
    expect(await redis.get("sandbox:leaked:key")).toBeNull();
  });
});
