/**
 * M15: 获取全校组织架构树端点定义
 * 自动扫描挂载路径: GET /api/org/departments/getTree
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetDepartmentTree } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/departments/getTree",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    return handleGetDepartmentTree({ schoolId });
  }
};

export default api;
