/**
 * M16: 岗位标签全景调度大盘 API 别名路由定义
 * 自动扫描挂载路径: GET /api/org/tags/dashboard
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetTagDashboard } from "../list/handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/tags/dashboard",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    return handleGetTagDashboard({ schoolId });
  }
};

export default api;
