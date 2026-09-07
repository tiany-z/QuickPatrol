import http from "http";
import {
  genUUID,
  returnError,
  TerminalLogger,
  tryCatchErrorToString,
  verifyJwtToken,
} from "../shared/index.js";
import {
  extractBearerToken,
  normalizeUrlPath,
  parseJsonBody,
  sendJsonResponse,
} from "../utils/httpHelper.js";
import { getApiRoute } from "./apiScanner.js";
import { handleCorsPreflight } from "./corsInterceptor.js";
import { SagaWithdrawStack } from "../shared/sql/withdrawStack.js";
import { RowLockManager } from "../shared/lock/rowLockManager.js";
import { LockedRowStub, RequestContext } from "./gatewayTypes.js";

export { RequestContext } from "./gatewayTypes.js";

/**
 * 全系统核心网关主分发器 (MasterDispatcher Gateway Engine)
 * 承接全量 HTTP 流量，执行 URL 规范化、0ms 预检短路、双通道鉴权、50MB 流式防护与 Saga/行锁自愈闭环
 */
export async function dispatchHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const startTime = Date.now();
  const clientIp =
    (req.headers["x-forwarded-for"] as string) ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  // 1. 0ms OPTIONS 跨域预检短路 (算法 4)
  if (req.method === "OPTIONS") {
    handleCorsPreflight(req, res);
    TerminalLogger.logAccess("OPTIONS", req.url || "/", 200, clientIp, Date.now() - startTime, null);
    return;
  }

  // 2. URL 规范化管道 (算法 1: 消除末尾多余斜杠、剥离 QueryString)
  const cleanPath = normalizeUrlPath(req.url || "/");
  let urlObj: URL;
  try {
    urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    urlObj = new URL("http://localhost/");
  }

  let currentUserId: string | null = null;

  // 3. API 契约路由匹配 (O(1) 常数级哈希查找与通配扫描)
  const route = getApiRoute(cleanPath);
  if (!route) {
    // 微信小程序 No-Fail Envelope: 统一返回 HTTP 200 包裹 status=0 报文，防止底层网络断开
    sendJsonResponse(res, returnError(`API 404 Not Found: ${cleanPath}`), 200);
    TerminalLogger.logAccess(req.method || "GET", cleanPath, 404, clientIp, Date.now() - startTime, null);
    return;
  }

  // 4. 双通道 Token 提取与鉴权验证 (算法 3)
  let userPayload: any = null;
  const token = extractBearerToken(req);

  if (route.authRequired !== false) {
    // 受限业务接口：必须持有有效 Token
    if (!token) {
      sendJsonResponse(res, returnError("未登录或缺少身份凭证 (Missing Authorization Token)"), 200);
      TerminalLogger.logAccess(req.method || "GET", cleanPath, 401, clientIp, Date.now() - startTime, null);
      return;
    }
    const jwtRes = verifyJwtToken(token);
    if (jwtRes.status === 0) {
      sendJsonResponse(res, returnError(`Token 无效或已过期: ${jwtRes.content}`), 200);
      TerminalLogger.logAccess(req.method || "GET", cleanPath, 401, clientIp, Date.now() - startTime, null);
      return;
    }
    userPayload = jwtRes.data;
    currentUserId = String(userPayload?.userId || userPayload?.openId || "auth-user");
  } else if (token) {
    // 公开免密接口：客户端附带 Token 时尝试静默解密，成功则注入用户上下文，失败则静默降级为访客
    const jwtRes = verifyJwtToken(token);
    if (jwtRes.status === 1) {
      userPayload = jwtRes.data;
      currentUserId = String(userPayload?.userId || userPayload?.openId || "auth-user");
    }
  }

  // 5. 50MB 流式防护与 Body 解析 (算法 5)
  const bodyRes = await parseJsonBody(req);
  if (bodyRes.status === 0) {
    sendJsonResponse(res, returnError(bodyRes.content), 200);
    TerminalLogger.logAccess(req.method || "POST", cleanPath, 400, clientIp, Date.now() - startTime, currentUserId);
    return;
  }

  // 6. 构造本次请求绑定的 RequestContext 独立上下文
  const requestId = genUUID();
  const withdrawStack = new SagaWithdrawStack();
  const lockedRows: LockedRowStub[] = [];

  const ctx: RequestContext = {
    requestId,
    withdrawStack,
    lockedRows,
    userPayload,
  };

  try {
    // 7. 精准调度至目标微应用业务控制器
    const handlerRes = await route.handler(
      {
        req,
        res,
        body: bodyRes.data,
        query: Object.fromEntries(urlObj.searchParams),
        run: route.run,
      },
      ctx
    );

    // 针对 SSE 长连接或由 Handler 自主写入发送响应的场景，直通放行
    if (res.writableEnded || res.headersSent) {
      await releaseAllLockedRows(lockedRows, true);
      withdrawStack.clear();
      TerminalLogger.logAccess(req.method || "POST", cleanPath, res.statusCode || 200, clientIp, Date.now() - startTime, currentUserId);
      return;
    }

    if (handlerRes && handlerRes.status === 1) {
      // 业务成功：提交释放所有持有的行锁，清空撤销栈
      await releaseAllLockedRows(lockedRows, true);
      withdrawStack.clear();
      sendJsonResponse(res, handlerRes, 200);
      TerminalLogger.logAccess(req.method || "POST", cleanPath, 200, clientIp, Date.now() - startTime, currentUserId);
    } else {
      // 业务逻辑失败：触发 Saga 逆序补偿回滚自愈，释放行锁
      await withdrawStack.withdrawAll();
      await releaseAllLockedRows(lockedRows, false);
      sendJsonResponse(res, handlerRes || returnError("未知响应错误"), 200);
      TerminalLogger.logAccess(req.method || "POST", cleanPath, 200, clientIp, Date.now() - startTime, currentUserId);
    }
  } catch (error) {
    // 运行时未捕获崩溃：强力触发 Saga 逆序回滚自愈，释放行锁，输出脱敏安全提示
    const errMsg = tryCatchErrorToString(error);
    await withdrawStack.withdrawAll();
    await releaseAllLockedRows(lockedRows, false);
    sendJsonResponse(res, returnError(`Server Internal Dispatch Error: ${errMsg}`), 200);
    TerminalLogger.logAccess(req.method || "POST", cleanPath, 500, clientIp, Date.now() - startTime, currentUserId);
  }
}

async function releaseAllLockedRows(lockedRows: LockedRowStub[], isCommitted: boolean): Promise<void> {
  for (const row of lockedRows) {
    if (row.schoolId !== undefined) {
      await RowLockManager.releaseRowLock(
        row.schoolId,
        row.tableName,
        row.targetId,
        row.requestId,
        isCommitted
      );
    } else {
      await RowLockManager.releaseRowLock(
        row.tableName,
        row.targetId,
        row.requestId,
        isCommitted
      );
    }
  }
}
