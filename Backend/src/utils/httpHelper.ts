import http from "http";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../shared/index.js";

export async function parseJsonBody<T = any>(req: http.IncomingMessage): Promise<StandardResult<T>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // 50MB 限制 (以支持可能的大图或数据上传)
      if (data.length > 50 * 1024 * 1024) {
        req.destroy();
        resolve(returnError("请求体过大 (Payload too large)"));
      }
    });

    req.on("end", () => {
      if (!data || data.trim() === "") {
        return resolve(returnSuccess({} as T));
      }
      try {
        const parsed = JSON.parse(data) as T;
        resolve(returnSuccess(parsed));
      } catch (err) {
        resolve(returnError(`JSON 解析失败: ${tryCatchErrorToString(err)}`));
      }
    });

    req.on("error", (err) => {
      resolve(returnError(`读取 HTTP Body 失败: ${tryCatchErrorToString(err)}`));
    });
  });
}

export function sendJsonResponse<T = any>(
  res: http.ServerResponse,
  result: StandardResult<T>,
  statusCode: number = 200
) {
  const httpPort = parseInt(process.env.HTTP_PORT || "8000", 10);
  const nodeNum = process.env.NODE_ID
    ? parseInt(process.env.NODE_ID.replace(/[^\d]/g, ""), 10) || (httpPort - 8000 + 1)
    : httpPort - 8000 + 1;

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, token, X-Backend-Node, X-Backend-Server-ID",
    "Access-Control-Expose-Headers": "X-Backend-Node",
    "X-Backend-Node": String(nodeNum),
  });
  res.end(JSON.stringify(result));
}

export function extractBearerToken(req: http.IncomingMessage): string | null {
  // 1. 优先读取微信小程序特有的 req.headers.token
  const customToken = req.headers.token as string;
  if (customToken && customToken.trim() !== "") {
    return customToken.trim();
  }

  // 2. 兼容标准 Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return authHeader.trim();
}
