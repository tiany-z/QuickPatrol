/**
 * M16: 创建岗位职能标签 API 路由定义
 * 自动扫描挂载路径: POST /api/org/tags/create
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { ICreateTagDto } from "../../../../services/org/tagTypes.js";
import { handleCreateTag } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/tags/create",
  authRequired: true,
  handler: async (data: HttpRequestData<ICreateTagDto>, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    const role = ctx.userPayload?.role !== undefined ? Number(ctx.userPayload.role) : 0;
    return handleCreateTag({ schoolId, role }, data.body);
  }
};

export default api;
