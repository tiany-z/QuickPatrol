/**
 * M18: 棋盘单元格批量授权路由端点
 * POST /api/admin/permissions/grant
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGrantPermissions } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/admin/permissions/grant",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const role = Number(ctx.userPayload?.role ?? 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("无效的租户上下文");
    }

    return handleGrantPermissions({ schoolId, role }, data.body);
  }
};

export default api;
