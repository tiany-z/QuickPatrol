/**
 * M22: 防篡改硬件级水印相机与 OSS 租户直传独立单测套件
 * (Watermark Camera & OSS Direct Test Suite)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { OssService } from "../apps/storage/ossService.js";
import { OssController } from "../apps/storage/ossController.js";
import { handleGetStsToken } from "../api/storage/sts-token/handler.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import { SettingsService } from "../services/school/settingsService.js";

describe("M22: 防篡改硬件级水印相机与 OSS 租户直传独立单测套件", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M22-01: STS 凭证派发 - 租户隔离前缀必须包含 schools/{schoolId}/ 且 Policy 合规", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 1 });
    const sId = tenant.schoolId;

    const sts = await OssService.generateTenantStsToken(sId, 101, "127.0.0.1", {
      scene: "patrol"
    });

    expect(sts.accessKeyId).toBeDefined();
    expect(sts.signature).toBeDefined();
    expect(sts.policyBase64).toBeDefined();
    expect(sts.expiresInSeconds).toBe(900);

    // 关键断言: 验证下发的目录前缀包含该学校 ID 与场景
    expect(sts.dirPrefix).toContain(`schools/${sId}/patrol/`);

    // 解码 Base64 Policy 并校验内部约束
    const decodedPolicy = JSON.parse(Buffer.from(sts.policyBase64, "base64").toString("utf-8"));
    expect(decodedPolicy.expiration).toBeDefined();

    // 验证 conditions 中存在针对 key 前缀的强限制
    const startsWithCond = decodedPolicy.conditions.find(
      (c: any) => Array.isArray(c) && c[0] === "starts-with" && c[1] === "$key"
    );
    expect(startsWithCond).toBeDefined();
    expect(startsWithCond[2]).toBe(sts.dirPrefix);
  });

  it("M22-02: 跨租户沙箱隔离验证 - 租户 A 与租户 B 派发的 dirPrefix 绝不重叠", async () => {
    const tenantA = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 2 });
    const tenantB = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 3 });

    const stsA = await OssService.generateTenantStsToken(tenantA.schoolId, 201, "127.0.0.1", {
      scene: "handle"
    });
    const stsB = await OssService.generateTenantStsToken(tenantB.schoolId, 202, "127.0.0.1", {
      scene: "handle"
    });

    expect(stsA.dirPrefix).not.toBe(stsB.dirPrefix);
    expect(stsA.dirPrefix).toContain(`schools/${tenantA.schoolId}/handle/`);
    expect(stsB.dirPrefix).toContain(`schools/${tenantB.schoolId}/handle/`);
  });

  it("M22-03: 文件大小约束断言 - Policy 必须限制最大上传不超过 15MB 且不小于 1KB", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 4 });
    const sId = tenant.schoolId;

    const sts = await OssService.generateTenantStsToken(sId, 301, "127.0.0.1", {
      scene: "review"
    });

    const decodedPolicy = JSON.parse(Buffer.from(sts.policyBase64, "base64").toString("utf-8"));
    const lengthCond = decodedPolicy.conditions.find(
      (c: any) => Array.isArray(c) && c[0] === "content-length-range"
    );

    expect(lengthCond).toBeDefined();
    expect(lengthCond[1]).toBe(1024); // 最小 1KB
    expect(lengthCond[2]).toBe(15 * 1024 * 1024); // 最大 15MB
  });

  it("M22-04: 上传场景 scene 校验 - 非法 scene 拒绝签发", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 5 });
    const sId = tenant.schoolId;

    await expect(
      OssService.generateTenantStsToken(sId, 401, "127.0.0.1", {
        scene: "invalid_scene" as any
      })
    ).rejects.toThrow("非法的上传场景");

    // 控制器层应优雅包裹为 400 失败
    const ctrlRes = await OssController.getStsToken(
      { schoolId: sId, userId: 401 },
      { scene: "malicious_hack" }
    );
    expect(ctrlRes.status).toBe(0);
    expect(ctrlRes.content).toContain("非法的上传场景");
  });

  it("M22-05: 租户个性化云存储配置 - 支持腾讯云 COS 与自定义 CDN 域名集成", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 6 });
    const sId = tenant.schoolId;

    // 针对该高校租户注册独立 COS 配置
    OssService.mockRegisterStorageConfig(sId, {
      provider: "tencent_cos",
      region: "ap-beijing",
      bucket: "custom-cos-bucket",
      accessKeyId: "COS_AK_999",
      accessKeySecret: "COS_SK_888",
      customCdnDomain: "https://media.myuniversity.edu.cn"
    });

    const sts = await OssService.generateTenantStsToken(sId, 501, "127.0.0.1", {
      scene: "patrol"
    });

    expect(sts.provider).toBe("tencent_cos");
    expect(sts.uploadHost).toBe("https://custom-cos-bucket.cos.ap-beijing.myqcloud.com");
    expect(sts.cdnDomain).toBe("https://media.myuniversity.edu.cn");
    expect(sts.accessKeyId).toBe("COS_AK_999");
  });

  it("M22-06: API 端点适配器与 MasterDispatcher 调度测试", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 7 });
    const sId = tenant.schoolId;
    const userId = 601;

    // 模拟合法 API 请求
    const apiRes = await handleGetStsToken(
      { schoolId: sId, userId, ip: "192.168.1.50" },
      { scene: "patrol" }
    );

    expect(apiRes.status).toBe(1);
    expect(apiRes.data).toBeDefined();
    expect(apiRes.data!.dirPrefix).toContain(`schools/${sId}/patrol/`);

    // 缺少身份上下文被拒
    const unauthRes = await handleGetStsToken(
      { schoolId: 0, userId: 0 },
      { scene: "patrol" }
    );
    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toContain("未授权");
  });

  it("M22-07: 安全合规留痕 - 凭证派发必须产生 STORAGE_STS_TOKEN_ISSUED 审计流水", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 22, caseIndex: 8 });
    const sId = tenant.schoolId;
    const userId = 701;

    await OssService.generateTenantStsToken(sId, userId, "127.0.0.1", {
      scene: "handle"
    });

    const logs = Array.from(AuditLogger.getMockLogsMap().values());
    const matchedLog = logs.find(
      (l) => l.schoolId === sId && l.action === "STORAGE_STS_TOKEN_ISSUED" && l.userId === userId
    );

    expect(matchedLog).toBeDefined();
    expect(matchedLog?.module).toBe("Storage");
    const parsedPayload = JSON.parse(matchedLog?.payloadJson || "{}");
    expect(parsedPayload.scene).toBe("handle");
    expect(parsedPayload.dirPrefix).toContain(`schools/${sId}/handle/`);
  });
});
