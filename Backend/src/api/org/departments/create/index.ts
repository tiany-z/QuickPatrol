/**
 * M15: 创建新部门 API 路由模块
 * 自动扫描挂载路径: POST /api/org/departments/create
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { ICreateDepartmentDto } from "../../../../services/org/departmentTypes.js";
import { handleCreateDepartment } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/departments/create",
  authRequired: true,
  handler: async (data: HttpRequestData<ICreateDepartmentDto>, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    const role = ctx.userPayload?.role !== undefined ? Number(ctx.userPayload.role) : 0;
    return handleCreateDepartment({ schoolId, role }, data.body);
  }
};

export default api;
