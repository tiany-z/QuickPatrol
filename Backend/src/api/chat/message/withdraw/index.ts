/**
 * M25: 撤回消息端点
 * POST /api/chat/message/withdraw
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleWithdrawMessage } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/chat/message/withdraw",
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

    return handleWithdrawMessage({ schoolId, userId, role, ip, realName }, data.body);
  }
};

export default api;
