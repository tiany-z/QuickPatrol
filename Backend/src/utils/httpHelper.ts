import http from "http";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../shared/index.js";

/**
 * URL 规范化管道与末尾斜杠容错算法 (算法 1)
 * 自动剥除 QueryString 与冗余末尾斜杠 (例如: /api/patrol/list/// -> /api/patrol/list)
 */
export function normalizeUrlPath(rawUrl: string): string {
  if (!rawUrl || rawUrl.trim() === "") return "/";

  try {
    const urlObj = new URL(rawUrl, "http://localhost");
    let pathname = urlObj.pathname.trim();

    // 剥除末尾所有的冗余斜杠
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/, "");
    }

    return pathname === "" ? "/" : pathname;
  } catch {
    // 降级截取
    const clean = rawUrl.split("?")[0].trim();
    if (clean.length > 1) {
      return clean.replace(/\/+$/, "");
    }
    return clean === "" ? "/" : clean;
  }
}

/**
 * 双通道 Token 凭据无感抽取算法 (算法 3)
 * 通道 1: 优先提取微信小程序端特有 Header: 'token'
 * 通道 2: 兼容标准工业级 Header: 'Authorization: Bearer <jwt>'
 */
export function extractBearerToken(req: http.IncomingMessage): string | null {
  // 通道 1: 微信小程序客户端自定义 Header: 'token'
  const customToken = req.headers["token"] as string;
  if (customToken && customToken.trim() !== "") {
    return customToken.trim();
  }

  // 通道 2: 工业级标准 Authorization Header
  const authHeader = req.headers["authorization"] as string;
  if (!authHeader || authHeader.trim() === "") {
    return null;
  }

  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.substring(7).trim();
  }
  return trimmed;
}

/**
 * 50MB 大载荷流式防护与安全 JSON 反序列化 (算法 5)
 * 防止恶意大包 DoS 攻击 (50MB 物理截断红线)
 */
export async function parseJsonBody<T = any>(
  req: http.IncomingMessage,
  maxBytes: number = 52428800 // 50MB
): Promise<StandardResult<T>> {
  return new Promise((resolve) => {
    let rawBuffer = "";
    let receivedBytes = 0;
    let destroyed = false;

    req.on("data", (chunk) => {
      if (destroyed) return;
      receivedBytes += chunk.length;

      if (receivedBytes > maxBytes) {
        destroyed = true;
        req.destroy(); // 掐断底层 TCP Socket
        resolve(returnError("请求体过大，超出 50MB 安全配额 (Payload Too Large)"));
      } else {
        rawBuffer += chunk;
      }
    });

    req.on("end", () => {
      if (destroyed) return;
      if (!rawBuffer || rawBuffer.trim() === "") {
        return resolve(returnSuccess({} as T));
      }
      try {
        const parsed = JSON.parse(rawBuffer) as T;
        resolve(returnSuccess(parsed));
      } catch (err) {
        resolve(returnError(`JSON 格式解析失败: ${tryCatchErrorToString(err)}`));
      }
    });

    req.on("error", (err) => {
      if (!destroyed) {
        resolve(returnError(`读取 HTTP 网络流异常: ${tryCatchErrorToString(err)}`));
      }
    });
  });
}

/**
 * 统一 JSON 响应格式化器 (微信小程序 No-Fail Envelope 友好封装)
 * 自动植入 X-Backend-Node 与 CORS 响应头
 */
export function sendJsonResponse<T = any>(
  res: http.ServerResponse,
  result: StandardResult<T>,
  statusCode: number = 200
): void {
  const httpPort = parseInt(process.env.HTTP_PORT || "8000", 10);
  const nodeNum = process.env.NODE_ID
    ? parseInt(process.env.NODE_ID.replace(/[^\d]/g, ""), 10) || (httpPort - 8000 + 1)
    : httpPort - 8000 + 1;

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, token, X-Backend-Node, X-Requested-With, X-School-Code, X-Backend-Server-ID",
    "Access-Control-Expose-Headers": "X-Backend-Node, Content-Disposition",
    "X-Backend-Node": String(nodeNum),
  });

  res.end(JSON.stringify(result));
}
