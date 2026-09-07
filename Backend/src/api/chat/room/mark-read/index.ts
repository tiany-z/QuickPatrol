/**
 * M25: 标记已读端点
 * POST /api/chat/room/mark-read
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleMarkRead } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/chat/room/mark-read",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const ip = (ctx as any).ip || (data.req?.socket?.remoteAddress) || "127.0.0.1";
    const realName = ctx.userPayload?.username || (ctx as any).realName;

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    return handleMarkRead({ schoolId, userId, role, ip, realName }, data.body);
  }
};

export default api;
