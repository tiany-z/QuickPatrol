/**
 * M31: 凭客户端持有的 Vault Tokens 批量免密查询诉求进展端点
 * POST /api/v4/feedback/appeals/batch-query-by-tokens
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleBatchQueryByTokens } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/feedback/appeals/batch-query-by-tokens",
  authRequired: false, // 允许匿名免密凭卡查询
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      1
    );
    const userId = Number(ctx.userPayload?.userId || 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少有效的高校租户上下文标识");
    }

    return handleBatchQueryByTokens(
      { schoolId, userId },
      data.body || {}
    );
  }
};

export default api;
