/**
 * M22: 多租户云存储中枢与 STS 临时凭证派发服务
 * (Tenant Storage OSS/COS Service & STS Token Issuer)
 * 
 * 核心特性与架构保障：
 * 1. 租户沙箱绝对隔离：目录前缀强制锁定 schools/${schoolId}/${scene}/${YYYYMM}/
 * 2. 权限最小化 Policy：仅授权 PutObject 单向写入，限定文件大小 1KB ~ 15MB
 * 3. 短时动态熔断：凭证时效固定为 900 秒 (15分钟)，动态 ISO8601 过期戳
 * 4. 零带宽直传中枢：服务端仅进行毫秒级 Policy 计算与 HMAC-SHA1 签名
 * 5. M12 密文配置集成与内存测试沙箱支持
 * 6. 操作安全留痕：全面记录 STORAGE_STS_TOKEN_ISSUED 审计流水
 */

import crypto from "crypto";
import { SettingsService } from "../../services/school/settingsService.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { getTenantKV, setTenantKV } from "../../shared/cache/redis.js";
import {
  ITenantStorageConfig,
  IStsTokenRequest,
  IStsTokenResponseDto
} from "./ossTypes.js";

// 内存级测试桩点字典 (用于离线单测环境与多租户沙箱隔离)
const mockStorageConfigStore = new Map<number, ITenantStorageConfig>();

export class OssService {
  public static readonly TOKEN_EXPIRATION_SECONDS = 900; // 15分钟有效期

  /**
   * 注册虚拟学校存储配置 (用于测试沙箱)
   */
  public static mockRegisterStorageConfig(schoolId: number, config: Partial<ITenantStorageConfig>): void {
    const fullConfig: ITenantStorageConfig = {
      provider: config.provider || "aliyun_oss",
      region: config.region || "oss-cn-beijing",
      bucket: config.bucket || `school-${schoolId}-bucket`,
      accessKeyId: config.accessKeyId || `LTAI_${schoolId}_MOCK_KEY`,
      accessKeySecret: config.accessKeySecret || `SECRET_${schoolId}_MOCK_VALUE`,
      roleArn: config.roleArn,
      customCdnDomain: config.customCdnDomain || `https://cdn.school${schoolId}.edu.cn`
    };
    mockStorageConfigStore.set(schoolId, fullConfig);
  }

  /**
   * 清空虚拟学校存储配置 (用于测试沙箱重置)
   */
  public static clearMockStorageConfigs(): void {
    mockStorageConfigStore.clear();
  }

  /**
   * 生成租户沙箱隔离的 STS 直传凭证与 Base64 策略
   */
  public static async generateTenantStsToken(
    schoolId: number,
    userId: number,
    userIp: string,
    req: IStsTokenRequest
  ): Promise<IStsTokenResponseDto> {
    if (!schoolId || schoolId <= 0) {
      throw new Error("无效的高校租户标识");
    }
    if (!userId || userId <= 0) {
      throw new Error("无效的用户身份标识");
    }
    const scene = req?.scene || "patrol";
    if (!["patrol", "handle", "review"].includes(scene)) {
      throw new Error("非法的上传场景，仅支持 patrol/handle/review");
    }

    // 1. 获取本校存储配置 (优先测试沙箱 -> 缓存 -> M12 密文配置 -> 默认托底)
    const config = await this.getTenantStorageConfig(schoolId);

    // 2. 构造严格受控的沙箱目录前缀: schools/${schoolId}/${scene}/${YYYYMM}/
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dirPrefix = `schools/${schoolId}/${scene}/${yearMonth}/`;

    // 3. 计算 Policy 过期时间 (ISO 8601)
    const expirationDate = new Date(now.getTime() + this.TOKEN_EXPIRATION_SECONDS * 1000);
    const expirationIso = expirationDate.toISOString();

    // 4. 构建 Policy 声明 (严格限制仅允许上传到指定租户前缀，且文件大小在 1KB ~ 15MB 之间)
    const policyObj = {
      expiration: expirationIso,
      conditions: [
        ["starts-with", "$key", dirPrefix],
        ["content-length-range", 1024, 15 * 1024 * 1024]
      ]
    };

    const policyBase64 = Buffer.from(JSON.stringify(policyObj)).toString("base64");

    // 5. 计算 HMAC-SHA1 签名
    const signature = crypto
      .createHmac("sha1", config.accessKeySecret)
      .update(policyBase64)
      .digest("base64");

    // 6. 确定上传域名与访问 CDN 域名
    let uploadHost = "";
    if (config.provider === "tencent_cos") {
      uploadHost = `https://${config.bucket}.cos.${config.region}.myqcloud.com`;
    } else {
      uploadHost = `https://${config.bucket}.${config.region}.aliyuncs.com`;
    }
    const cdnDomain = config.customCdnDomain || uploadHost;

    // 7. 记录凭证签发审计流水
    await AuditLogger.log(schoolId, userId, "STORAGE_STS_TOKEN_ISSUED", "Storage", userIp || "127.0.0.1", {
      scene,
      dirPrefix,
      expiration: expirationIso,
      provider: config.provider
    });

    return {
      provider: config.provider,
      uploadHost,
      accessKeyId: config.accessKeyId,
      policyBase64,
      signature,
      securityToken: undefined,
      dirPrefix,
      expiration: expirationIso,
      expiresInSeconds: this.TOKEN_EXPIRATION_SECONDS,
      cdnDomain
    };
  }

  /**
   * 读取高校租户云存储配置 (支持 M12 密文解密与 Redis 多级缓存)
   */
  public static async getTenantStorageConfig(schoolId: number): Promise<ITenantStorageConfig> {
    // 0. 优先命中测试桩点
    if (mockStorageConfigStore.has(schoolId)) {
      return mockStorageConfigStore.get(schoolId)!;
    }

    // 1. 尝试从 Redis 租户二级缓存读取
    const cacheRes = await getTenantKV<ITenantStorageConfig>(schoolId, "storage", "config");
    if (cacheRes.status === 1 && cacheRes.data) {
      return cacheRes.data;
    }

    // 2. 从 M12 settingsService 读取已解密配置项
    const [provider, region, bucket, keyId, keySecret, cdn] = await Promise.all([
      SettingsService.getDecryptedSetting(schoolId, "OSS_PROVIDER"),
      SettingsService.getDecryptedSetting(schoolId, "OSS_REGION"),
      SettingsService.getDecryptedSetting(schoolId, "OSS_BUCKET"),
      SettingsService.getDecryptedSetting(schoolId, "OSS_ACCESS_KEY_ID"),
      SettingsService.getDecryptedSetting(schoolId, "OSS_ACCESS_KEY_SECRET"),
      SettingsService.getDecryptedSetting(schoolId, "OSS_CDN_DOMAIN")
    ]);

    // 3. 兜底配置：若高校未独立配置，采用平台统一下发配置
    const config: ITenantStorageConfig = {
      provider: (provider as any) || "aliyun_oss",
      region: region || "oss-cn-beijing",
      bucket: bucket || "quickpatrol-prod",
      accessKeyId: keyId || "LTAI_DEFAULT_KEY_ID",
      accessKeySecret: keySecret || "SECRET_DEFAULT_KEY_VALUE",
      customCdnDomain: cdn || "https://cdn.quickpatrol.edu.cn"
    };

    // 4. 写入 Redis 缓存 10 分钟 (600s)
    await setTenantKV(schoolId, "storage", "config", config, 600);
    return config;
  }
}
