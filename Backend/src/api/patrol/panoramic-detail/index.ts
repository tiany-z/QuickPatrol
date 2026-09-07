/**
 * M30: 工单全景大宽表详情端点
 * GET /api/patrol/panoramic-detail
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleGetPanoramicDetail } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/patrol/panoramic-detail",
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

    return handleGetPanoramicDetail(
      { schoolId, userId, role, permissions, ip, realName },
      data.query || {}
    );
  }
};

export default api;
