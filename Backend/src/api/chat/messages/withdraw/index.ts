/**
 * M38: 撤回消息端点 (类 QQ 120 秒撤回中枢)
 * POST /api/v4/chat/messages/withdraw
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleWithdrawMessage } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/chat/messages/withdraw",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const ip = (ctx as any).ip || (data.req?.socket?.remoteAddress) || "127.0.0.1";
    const userAgent = (ctx as any).userAgent || data.req?.headers?.["user-agent"] || "QuickPatrol-Client";

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    return handleWithdrawMessage({
      schoolId,
      userId,
      userRole: role,
      ip,
      userAgent,
      body: data.body,
      params: (data as any).params
    });
  }
};

export default api;
