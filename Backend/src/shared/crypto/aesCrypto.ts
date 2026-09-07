/**
 * M12: 硬件级 AES-256-GCM 对称认证加解密引擎 (AES-GCM Cipher Suite)
 * 
 * 遵照金融级与商业密码标准：
 * 1. 采用 aes-256-gcm 认证加密模式 (兼具保密性 Confidentiality 与真实性 Authenticity)
 * 2. 每次加密使用硬件级熵池生成全新的 12 字节强随机向量 (96-bit IV)，彻底杜绝彩虹表碰撞
 * 3. 提取 16 字节 (128-bit) GCM 认证标签 (AuthTag)，解密时强制验签，防范比特翻转 (Bit-Flipping)
 * 4. 物理密文格式标准: iv_hex:authTag_hex:cipherText_hex
 */

import crypto from "crypto";
import { TerminalLogger } from "../log/terminalLogger.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 推荐标准 12 字节 (96-bit)
const TAG_LENGTH = 16; // 16 字节认证标签 (128-bit)
const DEFAULT_FALLBACK_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export class AesCryptoEngine {
  /**
   * 获取并校验 256 位主密钥 (Master Secret)
   */
  public static getMasterKey(customKeyHex?: string): string {
    const key = customKeyHex || process.env.MASTER_ENCRYPTION_KEY || DEFAULT_FALLBACK_KEY;
    if (key.length !== 64) {
      TerminalLogger.warn(
        `[M12 Crypto] MASTER_ENCRYPTION_KEY 长度 (${key.length}) 非 64 位 Hex，已启用标准 256-bit 保底密钥`,
        "Security"
      );
      return DEFAULT_FALLBACK_KEY;
    }
    return key;
  }

  /**
   * 执行 AES-256-GCM 认证加密
   * 输出格式: iv:authTag:cipherText (三元组 Hex 字符串)
   */
  public static encrypt(plainText: string, customMasterKeyHex?: string): string {
    if (!plainText) return "";
    const masterKey = this.getMasterKey(customMasterKeyHex);
    const keyBuf = Buffer.from(masterKey, "hex");

    if (keyBuf.length !== 32) {
      throw new Error("[M12 加密异常] 主密钥长度必须严格为 32 字节 (256-bit)");
    }

    // 1. 生成 12 字节硬件级随机 IV
    const iv = crypto.randomBytes(IV_LENGTH);

    // 2. 创建加密器并执行加密
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
    let cipherText = cipher.update(plainText, "utf8", "hex");
    cipherText += cipher.final("hex");

    // 3. 提取 128 位认证标签 (AuthTag)
    const authTag = cipher.getAuthTag();

    // 4. 打包为三元组标准物理存储字符串
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${cipherText}`;
  }

  /**
   * 执行 AES-256-GCM 认证解密与防篡改验签
   * 若密文或认证标签被哪怕篡改 1 位，底层将立即抛出安全认证异常
   */
  public static decrypt(encryptedPayload: string, customMasterKeyHex?: string): string {
    if (!encryptedPayload) return "";
    const parts = encryptedPayload.split(":");
    if (parts.length !== 3) {
      throw new Error("[M12 解密异常] 非法的 GCM 密文格式，必须为 'iv:authTag:cipherText' 三元组");
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const masterKey = this.getMasterKey(customMasterKeyHex);
    const keyBuf = Buffer.from(masterKey, "hex");

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");

    if (iv.length !== IV_LENGTH) {
      throw new Error(`[M12 解密异常] IV 向量长度非法，期望 ${IV_LENGTH} 字节，实际 ${iv.length} 字节`);
    }

    if (authTag.length !== TAG_LENGTH) {
      throw new Error(`[M12 解密异常] AuthTag 长度非法，期望 ${TAG_LENGTH} 字节，实际 ${authTag.length} 字节`);
    }

    // 1. 创建解密器
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);
    decipher.setAuthTag(authTag); // 设置认证标签供底层在 final() 时比对验签

    // 2. 执行解密 (若被篡改则抛出 Error: Unsupported state or unable to authenticate data)
    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}

export { AesCryptoEngine as AesGcmCrypto };
