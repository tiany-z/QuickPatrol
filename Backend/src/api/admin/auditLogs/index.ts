/**
 * M19: 安全审计日志分页查询路由端点
 * GET /api/admin/audit-logs 与 GET /api/admin/auditLogs
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleQueryAuditLogs } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/admin/audit-logs",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const role = Number(ctx.userPayload?.role ?? 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("无效的租户上下文");
    }

    return handleQueryAuditLogs({ schoolId, role }, data.query || {});
  }
};

export default api;
