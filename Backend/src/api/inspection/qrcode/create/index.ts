/**
 * M20: 创建资产二维码点位路由端点
 * POST /api/inspection/qrcode/create
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleCreatePoint } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/inspection/qrcode/create",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId);
    const userId = Number(ctx.userPayload?.userId);
    const role = Number(ctx.userPayload?.role ?? 0);

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的租户上下文");
    }

    return handleCreatePoint({ schoolId, userId, role }, data.body);
  }
};

export default api;
