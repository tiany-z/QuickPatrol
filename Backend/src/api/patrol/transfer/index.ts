/**
 * M24: 现场协同改派与转交路由端点
 * POST /api/patrol/transfer
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleTransferPatrol } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/patrol/transfer",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const ip = (ctx as any).ip || (data.req?.socket?.remoteAddress) || "127.0.0.1";

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    return handleTransferPatrol({ schoolId, userId, role, ip }, data.body);
  }
};

export default api;
