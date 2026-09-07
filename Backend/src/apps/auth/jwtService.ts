import jwt from "jsonwebtoken";
import { IMultiTenantJwtPayload } from "./authTypes.js";
import { TerminalLogger } from "../../shared/index.js";

const DEFAULT_SECRET = "quickpatrol-v4-jwt-master-secret-2026";
const TOKEN_EXPIRE_SECONDS = 30 * 86400; // 30 天长效

export class MultiTenantJwtService {
  private static customSecret?: string;

  public static getSecret(): string {
    return this.customSecret || process.env.JWT_SECRET || DEFAULT_SECRET;
  }

  public static setCustomSecret(secret: string): void {
    this.customSecret = secret;
  }

  public static resetCustomSecret(): void {
    this.customSecret = undefined;
  }

  /**
   * 签发多租户双身份 JWT 凭据
   */
  public static sign(
    payload: Omit<IMultiTenantJwtPayload, "iat" | "exp">,
    expiresInSeconds: number = TOKEN_EXPIRE_SECONDS
  ): string {
    if (!payload.schoolId || !payload.userId) {
      TerminalLogger.error("[M13 JWT] 签发参数缺失 schoolId 或 userId", "Auth");
      throw new Error("签发 Token 失败: 缺少租户或用户标识");
    }

    const fullPayload: IMultiTenantJwtPayload = {
      ...payload,
      activeType: payload.activeType === 2 ? 2 : 1
    };

    return jwt.sign(fullPayload, this.getSecret(), {
      algorithm: "HS256",
      expiresIn: expiresInSeconds
    });
  }

  /**
   * 验证并解析 JWT 凭据
   */
  public static verify(token: string): IMultiTenantJwtPayload {
    if (!token) {
      throw new Error("缺少认证 Token");
    }

    try {
      const decoded = jwt.verify(token, this.getSecret(), { algorithms: ["HS256"] }) as IMultiTenantJwtPayload;

      if (typeof decoded.schoolId !== "number" || typeof decoded.userId !== "number") {
        throw new Error("Token 载荷数据异常: 缺少必要租户字段");
      }

      return decoded;
    } catch (err: any) {
      TerminalLogger.warn(`[M13 JWT 验签失败] ${err.message}`, "Security");
      throw new Error(`Token 校验无效: ${err.message}`);
    }
  }

  /**
   * 刷新并重签 Token (用于双身份切换或版本升级)
   */
  public static reSignWithActiveType(
    currentTokenPayload: IMultiTenantJwtPayload,
    newActiveType: 1 | 2
  ): string {
    // 强制安全防线：若用户物理角色不具备师傅资质，拒绝签发 activeType = 2
    const safeActiveType = (newActiveType === 2 && currentTokenPayload.role >= 2) ? 2 : 1;

    return this.sign({
      schoolId: currentTokenPayload.schoolId,
      userId: currentTokenPayload.userId,
      openId: currentTokenPayload.openId,
      role: currentTokenPayload.role,
      activeType: safeActiveType,
      tokenVersion: currentTokenPayload.tokenVersion
    });
  }
}
