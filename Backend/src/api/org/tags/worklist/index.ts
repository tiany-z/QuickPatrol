/**
 * M16: 师傅工作台动态待办工单拉取 API 路由定义
 * 自动扫描挂载路径: GET /api/org/tags/worklist
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetDynamicWorklist } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/tags/worklist",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    const userId = Number(ctx.userPayload?.userId || data.query?.userId || 0);
    return handleGetDynamicWorklist({ schoolId, userId }, data.query as any);
  }
};

export default api;
