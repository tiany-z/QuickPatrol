/**
 * M14: 过期卡片原地半屏免密快捷续期路由定义
 * 自动扫描挂载路径: POST /api/auth/quick-renew
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleQuickRenew } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/auth/quick-renew",
  authRequired: false,
  handler: async (data: HttpRequestData, _ctx: RequestContext) => {
    return handleQuickRenew(data.body);
  }
};

export default api;
