/**
 * M18: 获取全校四维权限棋盘网格端点路由
 * GET /api/admin/permissions/matrix
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetPermissionMatrix } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/admin/permissions/matrix",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const role = Number(ctx.userPayload?.role ?? 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("无效的租户上下文");
    }

    return handleGetPermissionMatrix({ schoolId, role });
  }
};

export default api;
