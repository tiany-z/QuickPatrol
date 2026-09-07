/**
 * M30: 异常工单终止作废端点
 * POST /api/patrol/abort
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleAbortPatrol } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/patrol/abort",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const ip = (ctx as any).ip || data.req?.socket?.remoteAddress || "127.0.0.1";
    const realName = ctx.userPayload?.username || (ctx as any).realName;
    const permissions = ctx.userPayload?.permissions || [];

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    return handleAbortPatrol(
      { schoolId, userId, role, permissions, ip, realName },
      data.body || {}
    );
  }
};

export default api;
