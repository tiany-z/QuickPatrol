/**
 * M16: 岗位职能标签一键无缝交接 API 路由定义
 * 自动扫描挂载路径: POST /api/org/tags/handover
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { IHandoverTagRequest } from "../../../../services/org/tagTypes.js";
import { handleHandoverTag } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/org/tags/handover",
  authRequired: true,
  handler: async (data: HttpRequestData<IHandoverTagRequest>, ctx: RequestContext) => {
    const schoolId = ctx.userPayload?.schoolId || Number(data.query?.schoolId) || 1;
    const role = ctx.userPayload?.role !== undefined ? Number(ctx.userPayload.role) : 0;
    return handleHandoverTag({ schoolId, role }, data.body);
  }
};

export default api;
