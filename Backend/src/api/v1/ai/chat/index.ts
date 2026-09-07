/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/ai/chat 网关元数据定义
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleStreamChatRoute } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v1/ai/chat",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const userPayload = ctx.userPayload || {};
    const schoolId = Number(
      userPayload.schoolId !== undefined
        ? userPayload.schoolId
        : (ctx as any).schoolId !== undefined
        ? (ctx as any).schoolId
        : data.req?.headers?.["x-school-id"] ||
          data.query?.schoolId ||
          data.body?.schoolId ||
          1
    );

    const userId = Number(userPayload.userId || userPayload.id || (ctx as any).userId || 0);

    if (!schoolId || isNaN(schoolId) || schoolId <= 0) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先登录");
    }

    return handleStreamChatRoute(data.req, data.res, data.body || {}, {
      ...userPayload,
      schoolId,
      userId
    });
  }
};

export default api;
