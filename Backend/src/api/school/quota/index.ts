/**
 * M11: 租户 SaaS 配额看板 API 路由模块
 * 自动扫描挂载路径: GET /api/school/quota
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { getTenantQuotaHandler } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/school/quota",
  authRequired: true,
  handler: async (_data: HttpRequestData, ctx: RequestContext) => {
    return getTenantQuotaHandler(ctx);
  }
};

export default api;
