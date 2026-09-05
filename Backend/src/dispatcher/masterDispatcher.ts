import http from "http";
import {
  genUUID,
  TerminalLogger,
  returnError,
  RowLockManager,
  StandardResult,
  tryCatchErrorToString,
  verifyJwtToken,
} from "../shared/index.js";
import { extractBearerToken, parseJsonBody, sendJsonResponse } from "../utils/httpHelper.js";
import { getApiRoute } from "./apiScanner.js";

export interface RequestContext {
  requestId: string;
  withdrawStack: Array<() => Promise<void>>;
  lockedRows: Array<{ tableName: string; targetId: string | number; requestId: string }>;
  userPayload?: any;
}

export async function dispatchHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const startTime = Date.now();
  const requestId = genUUID();
  const lockedRows: Array<{ tableName: string; targetId: string | number; requestId: string }> = [];
  const withdrawStack: Array<() => Promise<void>> = [];

  const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
  let pathname = "/";
  let currentUserId: string | null = null;

  try {
    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = urlObj.pathname;

    // OPTIONS 跨域预检
    if (req.method === "OPTIONS") {
      sendJsonResponse(res, { status: 1, content: "OK" }, 200);
      TerminalLogger.logAccess(req.method || "OPTIONS", pathname, 200, clientIp, Date.now() - startTime, null);
      return;
    }

    const route = getApiRoute(pathname);
    if (!route) {
      // 兼容微信小程序，返回 status: 0 的 200 报文，避免小程序底层触发网络断开 fail
      sendJsonResponse(res, returnError(`API 404 Not Found: ${pathname}`), 200);
      TerminalLogger.logAccess(req.method || "GET", pathname, 404, clientIp, Date.now() - startTime, null);
      return;
    }

    let userPayload: any = null;
    const token = extractBearerToken(req);

    if (route.authRequired !== false) {
      if (!token) {
        // 需鉴权接口缺少 Token
        sendJsonResponse(res, returnError("未登录或缺少身份凭证 (Missing Authorization Token)"), 200);
        TerminalLogger.logAccess(req.method || "GET", pathname, 401, clientIp, Date.now() - startTime, null);
        return;
      }
      const jwtRes = verifyJwtToken(token);
      if (jwtRes.status === 0) {
        sendJsonResponse(res, returnError(`Token 无效或已过期: ${jwtRes.content}`), 200);
        TerminalLogger.logAccess(req.method || "GET", pathname, 401, clientIp, Date.now() - startTime, null);
        return;
      }
      userPayload = jwtRes.data;
      currentUserId = userPayload?.openId || userPayload?.username || String(userPayload?.userId || "auth-user");
    } else if (token) {
      // 免鉴权公共接口，但客户端主动附带了 Token（尝试解析填充身份上下文，失败则静默降级为访客）
      const jwtRes = verifyJwtToken(token);
      if (jwtRes.status === 1) {
        userPayload = jwtRes.data;
        currentUserId = userPayload?.openId || userPayload?.username || String(userPayload?.userId || "auth-user");
      }
    }

    const bodyRes = await parseJsonBody(req);
    const body = bodyRes.status === 1 ? bodyRes.data : {};

    const ctx: RequestContext = {
      requestId,
      withdrawStack,
      lockedRows,
      userPayload,
    };

    // 执行接口 Handlers (无显式 DB 事务，由池化连接与 AST 闭包保障)
    const handlerRes = await route.handler(
      {
        req,
        query: Object.fromEntries(urlObj.searchParams),
        body,
        run: route.run,
      },
      ctx
    );

    if (handlerRes.status === 1) {
      // 成功响应：释放分布式行锁，并提交广播
      await releaseMemoryLocks(lockedRows, true);
      sendJsonResponse(res, handlerRes, 200);
      TerminalLogger.logAccess(req.method || "GET", pathname, 200, clientIp, Date.now() - startTime, currentUserId);
    } else {
      // 业务失败：逆序 (LIFO) 执行 withdrawStack 撤回闭包，自愈回滚数据与 Redis
      await handleDispatchFailure(withdrawStack, lockedRows, handlerRes.content);
      sendJsonResponse(res, handlerRes, 200);
      TerminalLogger.logAccess(req.method || "GET", pathname, 200, clientIp, Date.now() - startTime, currentUserId);
    }
  } catch (error) {
    const errMsg = tryCatchErrorToString(error);
    await handleDispatchFailure(withdrawStack, lockedRows, errMsg);
    sendJsonResponse(res, returnError(`Server Internal Dispatch Error: ${errMsg}`), 200);
    TerminalLogger.logAccess(req.method || "GET", pathname, 500, clientIp, Date.now() - startTime, currentUserId);
  }
}

async function handleDispatchFailure(
  withdrawStack: Array<() => Promise<void>>,
  lockedRows: Array<{ tableName: string; targetId: string | number; requestId: string }>,
  _errorMsg: string
) {
  // 逆序 (LIFO) 执行收集到的全部 Undo 闭包，还原 MySQL 数据库与 Redis 缓存
  for (let i = withdrawStack.length - 1; i >= 0; i--) {
    try {
      await withdrawStack[i]();
    } catch (e) {
      TerminalLogger.error(`Undo operation error: ${tryCatchErrorToString(e)}`, "DispatcherRollback");
    }
  }

  // 撤回自愈完成后释放分布式行锁
  await releaseMemoryLocks(lockedRows, false);
}

async function releaseMemoryLocks(
  lockedRows: Array<{ tableName: string; targetId: string | number; requestId: string }>,
  isCommitted: boolean
) {
  for (const item of lockedRows) {
    await RowLockManager.releaseRowLock(item.tableName, item.targetId, item.requestId, isCommitted);
  }
}
