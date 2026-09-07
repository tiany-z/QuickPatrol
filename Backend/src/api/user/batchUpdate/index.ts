/**
 * M19: 移动端批量调度用户属性路由端点
 * POST /api/user/batch-update 与 POST /api/user/batchUpdate
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleBatchUpdateUsers } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/user/batch-update",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const userId = Number(ctx.userPayload?.userId);
    const role = Number(ctx.userPayload?.role ?? 0);
    const ip =
      (data.req?.headers?.["x-forwarded-for"] as string) ||
      data.req?.socket?.remoteAddress ||
      "127.0.0.1";

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的租户上下文");
    }

    return handleBatchUpdateUsers({ schoolId, userId, role, ip }, data.body);
  }
};

export default api;
