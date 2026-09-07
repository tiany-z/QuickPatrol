/**
 * M31: 凭借 Vault Token 进行匿名追加追问端点
 * POST /api/v4/feedback/appeals/append-inquiry
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleAppendInquiry } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/feedback/appeals/append-inquiry",
  authRequired: false, // 允许凭 Vault Token 匿名追问
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      1
    );
    const userId = Number(ctx.userPayload?.userId || 0);
    const ip = (ctx as any).ip || data.req?.socket?.remoteAddress || "127.0.0.1";

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少有效的高校租户上下文标识");
    }

    return handleAppendInquiry(
      { schoolId, userId, ip },
      data.body || {}
    );
  }
};

export default api;
