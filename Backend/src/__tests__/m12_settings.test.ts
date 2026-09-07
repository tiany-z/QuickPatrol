import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { AesCryptoEngine } from "../shared/crypto/aesCrypto.js";
import { maskSensitiveValue } from "../services/school/masker.js";
import { SettingsService } from "../services/school/settingsService.js";
import { getSettingsHandler } from "../api/school/settings/get/handler.js";
import { saveSettingHandler } from "../api/school/settings/save/handler.js";
import { RequestContext } from "../dispatcher/gatewayTypes.js";
import { SagaWithdrawStack } from "../shared/sql/withdrawStack.js";

describe("M12: 学校个性化设置字典与敏感配置加密存储 (School Settings & Cryptography)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M12-01: AES-256-GCM 能够正确加密并在无损状态下还原明文", () => {
    const rawApiKey = "sk-proj-9876543210abcdefghijklmnop";
    const encrypted = AesCryptoEngine.encrypt(rawApiKey);

    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(rawApiKey);

    // 验证物理三元组格式: iv_hex:tag_hex:cipher_hex
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(24); // 12 字节 = 24 hex
    expect(parts[1].length).toBe(32); // 16 字节 = 32 hex
    expect(parts[2].length).toBeGreaterThan(0);

    // 校验每次加密生成的随机 IV 必须不同 (抗彩虹表碰撞)
    const encryptedSecond = AesCryptoEngine.encrypt(rawApiKey);
    expect(encryptedSecond).not.toBe(encrypted);

    const decrypted = AesCryptoEngine.decrypt(encrypted);
    expect(decrypted).toBe(rawApiKey);
  });

  it("M12-02: 密文被篡改时，GCM 验签必须立即抛出安全异常", () => {
    const rawApiKey = "sk-secret-token-v4-super-secure";
    const encrypted = AesCryptoEngine.encrypt(rawApiKey);
    const parts = encrypted.split(":");

    // 1. 人为篡改密文主体中的字符 (Bit-Flipping 攻击模拟)
    const lastChar = parts[2].slice(-1);
    const tamperedCipher = parts[2].slice(0, -1) + (lastChar === "a" ? "b" : "a");
    const tamperedPayload1 = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    expect(() => {
      AesCryptoEngine.decrypt(tamperedPayload1);
    }).toThrow();

    // 2. 人为篡改认证标签 AuthTag
    const tamperedTag = (parts[1].startsWith("0") ? "1" : "0") + parts[1].slice(1);
    const tamperedPayload2 = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(() => {
      AesCryptoEngine.decrypt(tamperedPayload2);
    }).toThrow();
  });

  it("M12-03: 敏感凭据前后缀动态自适应脱敏符合预期", () => {
    // 长度 <= 6: 全隐藏
    expect(maskSensitiveValue("123456")).toBe("******");
    expect(maskSensitiveValue("abc")).toBe("******");

    // 7 <= 长度 <= 12: 保留前 2 位与后 2 位
    expect(maskSensitiveValue("sk-12345678")).toBe("sk****78");
    expect(maskSensitiveValue("1234567890")).toBe("12****90");

    // 长度 > 12: 保留前 4 位与后 4 位
    expect(maskSensitiveValue("sk-proj-abcdef123456")).toBe("sk-p****3456");
    expect(maskSensitiveValue("sk-deepseek-qwertyuiopasdfgh")).toBe("sk-d****dfgh");
  });

  it("M12-04: 多租户联合唯一键隔离断言 (多校相同 Key 互不污染)", async () => {
    const ctxSchool1 = TestHarness.createMockTenantContext({ moduleIndex: 12, caseIndex: 1 });
    const ctxSchool2 = TestHarness.createMockTenantContext({ moduleIndex: 12, caseIndex: 2 });

    expect(ctxSchool1.schoolId).not.toBe(ctxSchool2.schoolId);

    // 学校 1 保存 auto_pass_days = "3"
    await SettingsService.saveSetting(ctxSchool1.schoolId, {
      key: "auto_pass_days",
      value: "3",
      desc: "工单默认3天自动好评"
    });

    // 学校 2 保存 auto_pass_days = "14"
    await SettingsService.saveSetting(ctxSchool2.schoolId, {
      key: "auto_pass_days",
      value: "14",
      desc: "工单默认14天自动好评"
    });

    const val1 = await SettingsService.getDecryptedSetting(ctxSchool1.schoolId, "auto_pass_days");
    const val2 = await SettingsService.getDecryptedSetting(ctxSchool2.schoolId, "auto_pass_days");

    expect(val1).toBe("3");
    expect(val2).toBe("14");
    expect(val1).not.toBe(val2);
  });

  it("M12-05: SettingsService.saveSetting 敏感项自动加密与全集群广播", async () => {
    const schoolId = 81205;
    const rawApiKey = "sk-proj-super-secret-key-12345678";

    const saveRes = await SettingsService.saveSetting(schoolId, {
      key: "ai_api_key",
      value: rawApiKey,
      desc: "大模型授权密钥",
      isEncrypted: true
    });

    expect(saveRes.status).toBe(1);

    // 验证内部受控解密可完整还原
    const decrypted = await SettingsService.getDecryptedSetting(schoolId, "ai_api_key");
    expect(decrypted).toBe(rawApiKey);
  });

  it("M12-06: SettingsService.getSettingsList 对外脱敏回显测试", async () => {
    const schoolId = 81206;
    const rawApiKey = "sk-proj-super-secret-key-12345678";

    await SettingsService.saveSetting(schoolId, {
      key: "ai_api_key",
      value: rawApiKey,
      desc: "大模型授权密钥",
      isEncrypted: true
    });

    await SettingsService.saveSetting(schoolId, {
      key: "service_phone",
      value: "0535-6668888",
      desc: "后勤报修热线",
      isEncrypted: false
    });

    const listRes = await SettingsService.getSettingsList(schoolId);
    expect(listRes.status).toBe(1);
    expect(listRes.data?.length).toBe(2);

    const keyItem = listRes.data?.find((i) => i.key === "ai_api_key");
    expect(keyItem).toBeDefined();
    expect(keyItem?.isEncrypted).toBe(true);
    // 验证返回的值经过了脱敏，不含真实明文
    expect(keyItem?.value).not.toBe(rawApiKey);
    expect(keyItem?.value).toContain("****");

    const phoneItem = listRes.data?.find((i) => i.key === "service_phone");
    expect(phoneItem?.value).toBe("0535-6668888");
    expect(phoneItem?.isEncrypted).toBe(false);
  });

  it("M12-07: SettingsService.getDecryptedSetting 服务端受控安全解密测试", async () => {
    const schoolId = 81207;
    // 写入一个明文配置和一个加密配置
    await SettingsService.saveSetting(schoolId, {
      key: "plain_config",
      value: "hello_plain",
      isEncrypted: false
    });
    await SettingsService.saveSetting(schoolId, {
      key: "secret_config",
      value: "secret_1234567890",
      isEncrypted: true
    });

    expect(await SettingsService.getDecryptedSetting(schoolId, "plain_config")).toBe("hello_plain");
    expect(await SettingsService.getDecryptedSetting(schoolId, "secret_config")).toBe("secret_1234567890");
    expect(await SettingsService.getDecryptedSetting(schoolId, "non_existent_key")).toBeNull();
  });

  it("M12-08: API 端点权限守卫测试 (GET /api/school/settings/get & POST /api/school/settings/save)", async () => {
    const schoolId = 81208;

    // 1. 普通学生 (role: 0) 尝试读取设置 -> 403 拦截
    const studentCtx: RequestContext = {
      requestId: "req_student",
      withdrawStack: new SagaWithdrawStack(),
      lockedRows: [],
      userPayload: { schoolId, userId: 101, role: 0 }
    };
    const deniedGet = await getSettingsHandler(studentCtx);
    expect(deniedGet.status).toBe(0);
    expect(deniedGet.content).toContain("无权查看");

    // 2. 普通学生尝试保存设置 -> 403 拦截
    const deniedSave = await saveSettingHandler(studentCtx, {
      key: "auto_pass_days",
      value: "5"
    });
    expect(deniedSave.status).toBe(0);
    expect(deniedSave.content).toContain("无权修改");

    // 3. 校管理员 (role: 4) 访问与保存 -> 200 成功
    const adminCtx: RequestContext = {
      requestId: "req_admin",
      withdrawStack: new SagaWithdrawStack(),
      lockedRows: [],
      userPayload: { schoolId, userId: 102, role: 4 }
    };
    const successSave = await saveSettingHandler(adminCtx, {
      key: "auto_pass_days",
      value: "5",
      desc: "5天默认好评"
    });
    expect(successSave.status).toBe(1);

    const successGet = await getSettingsHandler(adminCtx);
    expect(successGet.status).toBe(1);
    expect(successGet.data?.length).toBe(1);
    expect(successGet.data?.[0].value).toBe("5");
  });
});
