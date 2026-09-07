/**
 * M24: 师傅工作台四象限任务列表路由端点
 * GET /api/patrol/workbench-list
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleGetWorkbenchList } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/patrol/workbench-list",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const ip = (ctx as any).ip || (data.req?.socket?.remoteAddress) || "127.0.0.1";

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    const query = (data.query || {}) as any;
    return handleGetWorkbenchList({ schoolId, userId, role, ip }, query);
  }
};

export default api;
