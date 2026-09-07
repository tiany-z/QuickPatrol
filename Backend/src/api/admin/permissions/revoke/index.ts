/**
 * M18: 收回网格单项授权端点路由
 * POST /api/admin/permissions/revoke
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleRevokePermission } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/admin/permissions/revoke",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const role = Number(ctx.userPayload?.role ?? 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("无效的租户上下文");
    }

    return handleRevokePermission({ schoolId, role }, data.body);
  }
};

export default api;
