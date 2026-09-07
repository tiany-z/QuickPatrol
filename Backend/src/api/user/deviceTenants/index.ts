/**
 * M14: 跨校多租户账号与待办红点并发反查路由定义
 * 自动扫描挂载路径: POST /api/user/device-tenants
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleGetDeviceTenants } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/user/device-tenants",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const userId = Number(ctx.userPayload?.userId);

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的用户上下文");
    }

    return handleGetDeviceTenants({ schoolId, userId }, data.body);
  }
};

export default api;
