/**
 * M38: 调阅会话撤回存根端点 (仅限校级管理员)
 * GET /api/v4/chat/rooms/withdrawn-stubs
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetWithdrawnStubs } from "../../audit/withdrawn-stubs/handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/chat/rooms/withdrawn-stubs",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    if (role !== 4) {
      return returnError("越权拒绝: 仅校级网络安全员与后勤督查纪检专员有权调阅撤回存根");
    }

    return handleGetWithdrawnStubs({
      schoolId,
      userId,
      userRole: role,
      query: (data.query || {}) as any
    });
  }
};

export default api;
