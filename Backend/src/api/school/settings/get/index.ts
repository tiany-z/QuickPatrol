/**
 * M12: 获取当前学校个性化设置清单路由定义
 * 自动扫描挂载路径: GET /api/school/settings/get
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { getSettingsHandler } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/school/settings/get",
  authRequired: true,
  handler: async (_data: HttpRequestData, ctx: RequestContext) => {
    return getSettingsHandler(ctx);
  }
};

export default api;
