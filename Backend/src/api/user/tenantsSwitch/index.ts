/**
 * M14: 跨校会话平滑热切路由定义
 * 自动扫描挂载路径: POST /api/user/tenants/switch 与 POST /api/user/tenantsSwitch
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleSwitchTenant } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/user/tenants/switch",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const userId = Number(ctx.userPayload?.userId);

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的用户上下文");
    }

    return handleSwitchTenant({ schoolId, userId }, data.body);
  }
};

export default api;
