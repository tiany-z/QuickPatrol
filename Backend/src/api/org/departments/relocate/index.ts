/**
 * M15: 部门平移与父级变更 API 路由模块
 * 自动扫描挂载路径: POST /api/org/departments/relocate
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { IRelocateDepartmentRequest } from "../../../../services/org/departmentTypes.js";
import { handleRelocateDepartment } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/departments/relocate",
  authRequired: true,
  handler: async (data: HttpRequestData<IRelocateDepartmentRequest>, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    const role = ctx.userPayload?.role !== undefined ? Number(ctx.userPayload.role) : 0;
    return handleRelocateDepartment({ schoolId, role }, data.body);
  }
};

export default api;
