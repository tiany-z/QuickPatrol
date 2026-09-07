/**
 * 高校后勤巡查e速办 v4.0 - /api/school/settings/llm 网关元数据定义
 * (School LLM Settings API Endpoint Module)
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetLlmConfig, handleSaveLlmConfig } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/school/settings/llm",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId !== undefined
        ? ctx.userPayload.schoolId
        : (ctx as any).schoolId !== undefined
        ? (ctx as any).schoolId
        : data.req?.headers?.["x-school-id"] ||
          data.query?.schoolId ||
          data.body?.schoolId ||
          1
    );

    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId || 0);
    const userRole = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先登录");
    }

    const method = (data.req?.method || "GET").toUpperCase();
    if (method === "POST" || method === "PUT" || (data.body && Object.keys(data.body).length > 0)) {
      return handleSaveLlmConfig({ schoolId, userId, userRole }, data.body || {});
    }

    return handleGetLlmConfig({ schoolId, userId, userRole }, data.query || {});
  }
};

export default api;
