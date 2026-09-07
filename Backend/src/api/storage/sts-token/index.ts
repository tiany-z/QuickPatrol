/**
 * M22: 获取云存储直传 STS 临时凭证 API 路由端点
 * GET /api/storage/sts-token
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleGetStsToken } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/storage/sts-token",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const ip = (ctx as any).ip || (data.req?.socket?.remoteAddress) || "127.0.0.1";

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("未授权的租户请求或用户未登录");
    }

    return handleGetStsToken({ schoolId, userId, ip }, (data.query as any) || {});
  }
};

export default api;
