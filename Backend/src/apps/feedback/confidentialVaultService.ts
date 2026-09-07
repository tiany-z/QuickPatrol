/**
 * 高校后勤巡查e速办 v4.0 - M31: 绝对匿名隐私保险箱核心加密服务
 * (Confidential Vault Cryptography Service)
 * 
 * 核心职责：
 * 1. HMAC-SHA256 单向多重加盐不可逆散列计算 (Salted Vault Hashing)
 * 2. AES-256-GCM 双向认证加密签发客户端私钥凭证卡 (Vault Token Mint)
 * 3. 严格解析与验签 Vault Token，硬件级防篡改与跨校租户越权阻断 (Vault Token Verify)
 */

import crypto from "crypto";
import { IVaultTokenPayload } from "./feedbackAppealTypes.js";

export class ConfidentialVaultService {
  /** 服务端主对称秘钥 (32字节，由环境变量配置注入或安全派生) */
  private static readonly MASTER_VAULT_KEY: Buffer = (() => {
    const rawKey =
      process.env.QUICKPATROL_VAULT_MASTER_KEY ||
      "quickpatrol_super_secret_vault_key_2026_salt_32b_production";
    return crypto.createHash("sha256").update(rawKey).digest();
  })();

  /**
   * 计算单向不可逆匿名散列特征码 (HMAC-SHA256)
   * 
   * @param openId 微信提报人唯一 OpenID
   * @param schoolId 学校租户ID
   * @param tenantSecret 租户高熵安全主秘钥
   * @param nonceSalt 单次诉求专属 16 字节随机盐
   */
  public static generateAnonymousHash(
    openId: string,
    schoolId: number,
    tenantSecret: string,
    nonceSalt: string
  ): string {
    // 派生安全混合盐: SHA256(tenantSecret || ":tenant_" || schoolId || ":" || nonceSalt)
    const derivedSalt = crypto
      .createHash("sha256")
      .update(`${tenantSecret}:tenant_${schoolId}:${nonceSalt}`)
      .digest("hex");

    // 计算 HMAC-SHA256 单向特征码
    return crypto
      .createHmac("sha256", derivedSalt)
      .update(openId)
      .digest("hex");
  }

  /**
   * 生成 16 字节高熵随机十六进制动态盐
   */
  public static generateNonceSalt(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * 签发客户端追踪私钥凭证卡 (AES-256-GCM 认证加密)
   * 
   * 数据封装格式 (Binary):
   * [12 bytes IV] + [16 bytes AuthTag] + [4 bytes SchoolId (UInt32BE)] + [4 bytes PostId (UInt32BE)] + [Ciphertext]
   * 并通过 Base64URL 进行安全字符串转换
   */
  public static mintVaultToken(payload: IVaultTokenPayload): string {
    const iv = crypto.randomBytes(12);

    // 构造附加认证数据 (AAD)，绑定租户与诉求ID防重放
    const aadStr = `quickpatrol:vault:${payload.schoolId}:${payload.postId}`;
    const aad = Buffer.from(aadStr, "utf8");

    const cipher = crypto.createCipheriv("aes-256-gcm", this.MASTER_VAULT_KEY, iv);
    cipher.setAAD(aad);

    const plaintext = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const prefixBuf = Buffer.alloc(8);
    prefixBuf.writeUInt32BE(payload.schoolId, 0);
    prefixBuf.writeUInt32BE(payload.postId, 4);

    const combinedBuffer = Buffer.concat([iv, authTag, prefixBuf, encrypted]);
    return combinedBuffer.toString("base64url");
  }

  /**
   * 严格解析并验签客户端携带的 Vault Token
   * 
   * @param token 客户端上传的 Base64URL 凭证卡字符串
   * @param expectedSchoolId 当前请求所属租户学校ID
   * @throws Error 当解密失败、数据篡改、AAD不匹配或跨租户时抛出越权异常
   */
  public static verifyAndDecodeVaultToken(
    token: string,
    expectedSchoolId: number
  ): IVaultTokenPayload {
    if (!token || typeof token !== "string") {
      throw new Error("非法凭证: VaultToken 格式无效");
    }

    try {
      const combinedBuffer = Buffer.from(token, "base64url");
      if (combinedBuffer.length < 36) {
        throw new Error("非法凭证: 数据长度严重受损");
      }

      const iv = combinedBuffer.subarray(0, 12);
      const authTag = combinedBuffer.subarray(12, 28);
      const tokenSchoolId = combinedBuffer.readUInt32BE(28);
      const tokenPostId = combinedBuffer.readUInt32BE(32);
      const ciphertext = combinedBuffer.subarray(36);

      // 租户安全隔离校验
      if (tokenSchoolId !== expectedSchoolId) {
        throw new Error("租户越权: 该凭证不属于当前高校租户空间");
      }

      const aadStr = `quickpatrol:vault:${tokenSchoolId}:${tokenPostId}`;
      const aad = Buffer.from(aadStr, "utf8");

      const decipher = crypto.createDecipheriv("aes-256-gcm", this.MASTER_VAULT_KEY, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const decryptedStr = decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
      const payload: IVaultTokenPayload = JSON.parse(decryptedStr);

      if (payload.schoolId !== expectedSchoolId) {
        throw new Error("租户越权: 该凭证不属于当前高校租户空间");
      }
      if (payload.postId !== tokenPostId) {
        throw new Error("凭证安全认证标签比对失败");
      }

      return payload;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("租户越权")) {
        throw err;
      }
      const message = err instanceof Error ? err.message : "未知加解密异常";
      throw new Error(`凭证验签失败: ${message}`);
    }
  }
}
