/**
 * M20: 现场扫码防伪与防作弊打卡路由端点
 * POST /api/inspection/qrcode/verify
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleVerifyScan } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/inspection/qrcode/verify",
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
      return returnError("无效的用户上下文");
    }

    return handleVerifyScan({ schoolId, userId, role, ip }, data.body);
  }
};

export default api;
