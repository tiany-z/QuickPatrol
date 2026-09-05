import jwt from "jsonwebtoken";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";
import { decodeLegacyToken } from "./legacyToken.js";

export interface UserTokenPayload {
  userId?: string | number;
  openId?: string;
  username?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

const DEFAULT_JWT_SECRET = "xc-backend-v4-secret-key-2026";

export function signJwtToken(
  payload: UserTokenPayload,
  secret: string = process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  expiresIn: string = "7d"
): StandardResult<string> {
  try {
    const token = jwt.sign(payload, secret, { expiresIn: expiresIn as any });
    return returnSuccess(token);
  } catch (error) {
    return returnError(`Sign JWT token failed: ${tryCatchErrorToString(error)}`);
  }
}

export function verifyJwtToken(
  token: string,
  secret: string = process.env.JWT_SECRET || DEFAULT_JWT_SECRET
): StandardResult<UserTokenPayload> {
  try {
    // 1. 尝试标准 JWT 解密
    try {
      const decoded = jwt.verify(token, secret) as UserTokenPayload;
      return returnSuccess(decoded);
    } catch {
      // 2. 如果非标准 JWT，尝试旧版小程序对称混淆 Token 解密
      const legacyDecoded = decodeLegacyToken(token);
      const parsed = JSON.parse(legacyDecoded);
      return returnSuccess({
        openId: parsed.openId,
        username: parsed.username,
        userId: parsed.userId || parsed.id,
      });
    }
  } catch (error) {
    return returnError(`Token 验证失败: ${tryCatchErrorToString(error)}`);
  }
}
