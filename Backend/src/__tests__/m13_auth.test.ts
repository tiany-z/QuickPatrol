import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { MultiTenantJwtService } from "../apps/auth/jwtService.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { handleWeChatLogin } from "../api/auth/login/handler.js";
import { handleSwitchIdentity } from "../api/auth/switch-identity/handler.js";

describe("M13: 微信静默授权登录与多租户双身份签发 (Auth & Multi-Tenant JWT)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M13-01: 首次微信登录能够自动原子建档，默认角色为学生 (role=0)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 13, caseIndex: 1 });
    const mockCode = "mock_code_user_new_001";

    const res = await handleWeChatLogin({
      schoolId: tenant.schoolId,
      code: mockCode,
      nickName: "新生小张"
    });

    expect(res.status).toBe(1);
    expect(res.data.token).toBeTruthy();
    expect(res.data.userInfo.role).toBe(0);
    expect(res.data.activeType).toBe(1);
    expect(res.data.availableIdentities.length).toBe(1); // 仅师生端

    // 验证 JWT 内部载荷
    const payload = MultiTenantJwtService.verify(res.data.token);
    expect(payload.schoolId).toBe(tenant.schoolId);
    expect(payload.role).toBe(0);
    expect(payload.activeType).toBe(1);
    expect(payload.tokenVersion).toBe(1);
  });

  it("M13-02: 具备师傅资质的用户 (role=2) 登录时应能识别双身份并支持切换", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 13, caseIndex: 2 });
    const mockCode = "mock_code_master_002";

    // 1. 先建档
    const loginRes = await handleWeChatLogin({ schoolId: tenant.schoolId, code: mockCode });
    expect(loginRes.status).toBe(1);
    const userId = loginRes.data.userInfo.userId;

    // 2. 模拟管理员将角色提权为 2 (师傅)
    await TestHarness.executeSql(
      "UPDATE users SET role = 2 WHERE id = ?",
      [userId]
    );

    // 3. 再次登录，应返回可切换身份
    const secondLogin = await handleWeChatLogin({ schoolId: tenant.schoolId, code: mockCode });
    expect(secondLogin.status).toBe(1);
    expect(secondLogin.data.userInfo.role).toBe(2);
    expect(secondLogin.data.availableIdentities.length).toBe(2); // 师生端 + 施工端

    // 4. 发起双身份切换至施工端 (activeType = 2)
    const switchRes = await handleSwitchIdentity(
      { schoolId: tenant.schoolId, userId, token: secondLogin.data.token },
      { targetActiveType: 2 }
    );

    expect(switchRes.status).toBe(1);
    expect(switchRes.data.activeType).toBe(2);
    expect(switchRes.data.role).toBe(2);

    // 验证新 Token 中的视角为 2
    const newPayload = MultiTenantJwtService.verify(switchRes.data.token);
    expect(newPayload.activeType).toBe(2);
    expect(newPayload.role).toBe(2);
  });

  it("M13-03: 普通学生 (role=0) 强行切换至师傅端应被权限防线直接拒绝", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 13, caseIndex: 3 });
    const mockCode = "mock_code_student_attack";

    const loginRes = await handleWeChatLogin({ schoolId: tenant.schoolId, code: mockCode });
    expect(loginRes.status).toBe(1);
    const userId = loginRes.data.userInfo.userId;

    const switchRes = await handleSwitchIdentity(
      { schoolId: tenant.schoolId, userId, token: loginRes.data.token },
      { targetActiveType: 2 }
    );

    expect(switchRes.status).toBe(0);
    expect(switchRes.content).toContain("越权访问");
  });

  it("M13-04: 多租户 OpenId 正交隔离测试 (同 OpenId 在两所大学各拥有独立账号)", async () => {
    const schoolA = 101;
    const schoolB = 102;
    const commonCode = "mock_code_same_person";

    const resA = await handleWeChatLogin({ schoolId: schoolA, code: commonCode });
    const resB = await handleWeChatLogin({ schoolId: schoolB, code: commonCode });

    expect(resA.status).toBe(1);
    expect(resB.status).toBe(1);
    expect(resA.data.userInfo.schoolId).toBe(schoolA);
    expect(resB.data.userInfo.schoolId).toBe(schoolB);
    expect(resA.data.userInfo.userId).not.toBe(resB.data.userInfo.userId); // 必须是两个独立 userId
  });

  it("M13-05: 封禁账号登录应被安全拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 13, caseIndex: 5 });
    const mockCode = "mock_code_banned_user";

    // 1. 正常建档
    const loginRes = await handleWeChatLogin({ schoolId: tenant.schoolId, code: mockCode });
    expect(loginRes.status).toBe(1);
    const userId = loginRes.data.userInfo.userId;

    // 2. 模拟拉黑封禁
    await TestHarness.executeSql(
      "UPDATE users SET isBan = 1 WHERE id = ?",
      [userId]
    );


    // 3. 再次登录应被拦截
    const bannedLoginRes = await handleWeChatLogin({ schoolId: tenant.schoolId, code: mockCode });
    expect(bannedLoginRes.status).toBe(0);
    expect(bannedLoginRes.content).toContain("封禁");
  });

  it("M13-06: 多租户 JWT 验签与防篡改解码保护", async () => {
    const token = MultiTenantJwtService.sign({
      schoolId: 1001,
      userId: 8888,
      openId: "wx_test_token_tamper",
      role: 2,
      activeType: 1,
      tokenVersion: 1
    });

    const verified = MultiTenantJwtService.verify(token);
    expect(verified.schoolId).toBe(1001);
    expect(verified.userId).toBe(8888);

    // 篡改 Token 尾部签名
    const tamperedToken = token.slice(0, -4) + "XXXX";
    expect(() => MultiTenantJwtService.verify(tamperedToken)).toThrow(/Token 校验无效/);

    // 空 Token 拦截
    expect(() => MultiTenantJwtService.verify("")).toThrow(/缺少认证 Token/);
  });

  it("M13-07: Code2Session Mock 桩点与异常输入处理", async () => {
    const openId = await WeChatAuthService.fetchOpenId("mock_code_test_123");
    expect(openId).toBe("mock_openid_test_123");

    await expect(WeChatAuthService.fetchOpenId("")).rejects.toThrow("微信 Code 不能为空");
  });

  it("M13-08: API 请求参数防御性校验", async () => {
    // 非法 schoolId
    const res1 = await handleWeChatLogin({ schoolId: 0, code: "mock_code_abc" });
    expect(res1.status).toBe(0);
    expect(res1.content).toContain("缺少合法所属学校参数");

    // 缺少 code
    const res2 = await handleWeChatLogin({ schoolId: 1, code: "" });
    expect(res2.status).toBe(0);
    expect(res2.content).toContain("缺少微信授权凭证");

    // 非法 targetActiveType
    const res3 = await handleSwitchIdentity(
      { schoolId: 1, userId: 1, token: "mock_token" },
      { targetActiveType: 5 as any }
    );
    expect(res3.status).toBe(0);
    expect(res3.content).toContain("非法的目标工作视角标识");
  });
});
