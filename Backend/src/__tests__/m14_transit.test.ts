import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { MultiTenantTransitService, applyLruEviction } from "../services/user/multiTenantTransitService.js";
import { MultiTenantJwtService } from "../apps/auth/jwtService.js";
import { handleGetDeviceTenants } from "../api/user/deviceTenants/handler.js";
import { handleSwitchTenant } from "../api/user/tenantsSwitch/handler.js";
import { handleQuickRenew } from "../api/auth/quickRenew/handler.js";

describe("M14: 自然人多身份独立存储与多校会话穿梭 (Multi-Identity & Tenant Switching)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M14-01: 基于同手机号能够准确反查多所高校档案与待办红点", async () => {
    const commonPhone = "13800008888";
    const schoolA = 201;
    const schoolB = 202;

    // 1. 在两所学校分别为同一手机号建档
    await TestHarness.executeSql(
      "INSERT INTO schools (id, name, code, status) VALUES (?, '第一大学', 'SCH_A', 1), (?, '第二大学', 'SCH_B', 1) ON DUPLICATE KEY UPDATE status=1",
      [schoolA, schoolB]
    );

    await TestHarness.executeSql(
      "INSERT INTO users (schoolId, openId, phone, realName, role) VALUES (?, 'openid_a', ?, '张三', 2), (?, 'openid_b', ?, '张三', 1)",
      [schoolA, commonPhone, schoolB, commonPhone]
    );

    // 2. 调用跨校反查聚合服务
    const res = await MultiTenantTransitService.getCrossTenantList(commonPhone, schoolA);

    expect(res.accounts.length).toBe(2);
    expect(res.accounts.find((a) => a.schoolId === schoolA)?.isCurrent).toBe(true);
    expect(res.accounts.find((a) => a.schoolId === schoolA)?.sessionStatus).toBe("active");
    expect(res.accounts.find((a) => a.schoolId === schoolB)?.isCurrent).toBe(false);
    expect(res.accounts.find((a) => a.schoolId === schoolB)?.sessionStatus).toBe("valid");

    // 验证 HTTP 端点响应一致性
    const httpRes = await handleGetDeviceTenants({ schoolId: schoolA, userId: 1 }, { phone: commonPhone });
    expect(httpRes.status).toBe(1);
    expect(httpRes.data.accounts.length).toBe(2);
  });

  it("M14-02: 跨校会话切换能够成功颁发目标学校的专属租户 JWT", async () => {
    const commonPhone = "13911112222";
    const schoolA = 301;
    const schoolB = 302;

    await TestHarness.executeSql(
      "INSERT INTO schools (id, name, code, status) VALUES (?, '清华园校', 'THU', 1), (?, '未名湖校', 'PKU', 1) ON DUPLICATE KEY UPDATE status=1",
      [schoolA, schoolB]
    );

    // 建档
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, phone, role) VALUES (10, ?, 'openid_1', ?, 2), (20, ?, 'openid_2', ?, 1)",
      [schoolA, commonPhone, schoolB, commonPhone]
    );

    // 切换至学校 B
    const switchRes = await handleSwitchTenant(
      { schoolId: schoolA, userId: 10 },
      { targetSchoolId: schoolB }
    );

    expect(switchRes.status).toBe(1);
    expect(switchRes.data.targetSchoolId).toBe(schoolB);
    expect(switchRes.data.targetUserId).toBe(20);
    expect(switchRes.data.targetRole).toBe(1);

    // 验证新 Token 内部 payload 严格属于目标租户
    const payload = MultiTenantJwtService.verify(switchRes.data.token);
    expect(payload.schoolId).toBe(schoolB);
    expect(payload.userId).toBe(20);
    expect(payload.role).toBe(1);
  });

  it("M14-03: 试图切换至未建档的高校应被安全阻断", async () => {
    const phone = "13500000001";
    const schoolA = 401;
    const unjoinedSchool = 999;

    await TestHarness.executeSql(
      "INSERT INTO schools (id, name, code, status) VALUES (?, '母校', 'HOME', 1), (?, '未入驻校', 'NONE', 1)",
      [schoolA, unjoinedSchool]
    );

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, phone, role) VALUES (100, ?, 'open_0', ?, 0)",
      [schoolA, phone]
    );

    const switchRes = await handleSwitchTenant(
      { schoolId: schoolA, userId: 100 },
      { targetSchoolId: unjoinedSchool }
    );

    expect(switchRes.status).toBe(0);
    expect(switchRes.content).toContain("未检索到");
  });

  it("M14-04: 目标高校账号被封禁 (isBan=1) 时应坚决阻断切入", async () => {
    const commonPhone = "13600000002";
    const schoolA = 501;
    const schoolB = 502;

    await TestHarness.executeSql(
      "INSERT INTO schools (id, name, code, status) VALUES (?, '甲大学', 'SCH_A', 1), (?, '乙大学', 'SCH_B', 1)",
      [schoolA, schoolB]
    );

    // 学校 B 账号已被拉黑封禁 isBan=1
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, phone, role, isBan) VALUES (11, ?, 'open_11', ?, 0, 0), (22, ?, 'open_22', ?, 2, 1)",
      [schoolA, commonPhone, schoolB, commonPhone]
    );

    const switchRes = await handleSwitchTenant(
      { schoolId: schoolA, userId: 11 },
      { targetSchoolId: schoolB }
    );

    expect(switchRes.status).toBe(0);
    expect(switchRes.content).toContain("封禁");
  });

  it("M14-05: 切换目标学校为当前学校时防重提示", async () => {
    const switchRes = await handleSwitchTenant(
      { schoolId: 601, userId: 66 },
      { targetSchoolId: 601 }
    );

    expect(switchRes.status).toBe(0);
    expect(switchRes.content).toContain("无需切换");
  });

  it("M14-06: 目标学校处于欠费停运状态 (status=0) 熔断阻断", async () => {
    const commonPhone = "13700000003";
    const schoolA = 701;
    const frozenSchool = 702;

    await TestHarness.executeSql(
      "INSERT INTO schools (id, name, code, status) VALUES (?, '在营高校', 'ACT', 1), (?, '停运高校', 'STP', 0)",
      [schoolA, frozenSchool]
    );

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, phone, role) VALUES (71, ?, 'op_71', ?, 0), (72, ?, 'op_72', ?, 2)",
      [schoolA, commonPhone, frozenSchool, commonPhone]
    );

    const switchRes = await handleSwitchTenant(
      { schoolId: schoolA, userId: 71 },
      { targetSchoolId: frozenSchool }
    );

    expect(switchRes.status).toBe(0);
    expect(switchRes.content).toContain("服务已暂停");
  });

  it("M14-07: 过期凭据原地半屏免密一键续期成功", async () => {
    const phone = "13866667777";
    const schoolId = 801;

    await TestHarness.executeSql(
      "INSERT INTO schools (id, name, code, status) VALUES (?, '续期高校', 'RNW', 1)",
      [schoolId]
    );

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, phone, role, realName) VALUES (88, ?, 'open_88', ?, 2, '李师傅')",
      [schoolId, phone]
    );

    const renewRes = await handleQuickRenew({
      targetSchoolId: schoolId,
      phone
    });

    expect(renewRes.status).toBe(1);
    expect(renewRes.data.schoolId).toBe(schoolId);
    expect(renewRes.data.userId).toBe(88);
    expect(renewRes.data.realName).toBe("李师傅");
    expect(renewRes.data.token).toBeTruthy();

    const verified = MultiTenantJwtService.verify(renewRes.data.token);
    expect(verified.schoolId).toBe(schoolId);
    expect(verified.role).toBe(2);
  });

  it("M14-08: 本机设备存根 LRU 20 自动淘汰算法验证", () => {
    const accounts = [];
    // 构造 25 个按秒递增的存根卡片
    for (let i = 1; i <= 25; i++) {
      accounts.push({
        schoolId: i,
        lastLoginAt: new Date(1700000000000 + i * 1000).toISOString()
      });
    }

    const evicted = applyLruEviction(accounts, 20);

    expect(evicted.length).toBe(20);
    // 最陈旧的 1~5 号应被淘汰，保留最新的 6~25 号
    expect(evicted[0].schoolId).toBe(6);
    expect(evicted[19].schoolId).toBe(25);
  });

  it("M14-09: HTTP 接口请求参数防御性拦截", async () => {
    // 缺少手机号
    const res1 = await handleGetDeviceTenants({ schoolId: 1, userId: 1 }, { phone: "" });
    expect(res1.status).toBe(0);
    expect(res1.content).toContain("缺少查询手机号参数");

    // 缺少 targetSchoolId
    const res2 = await handleSwitchTenant({ schoolId: 1, userId: 1 }, { targetSchoolId: 0 as any });
    expect(res2.status).toBe(0);
    expect(res2.content).toContain("缺少有效的目标学校参数");

    // 快捷续期参数缺失
    const res3 = await handleQuickRenew({ targetSchoolId: 0, phone: "" });
    expect(res3.status).toBe(0);
    expect(res3.content).toContain("参数缺失");
  });
});
