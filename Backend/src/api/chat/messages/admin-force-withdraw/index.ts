/**
 * M38: 管理员强制熔断撤回违规消息端点
 * POST /api/v4/chat/messages/admin-force-withdraw
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleAdminForceWithdraw } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/chat/messages/admin-force-withdraw",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);
    const role = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);
    const ip = (ctx as any).ip || (data.req?.socket?.remoteAddress) || "127.0.0.1";
    const userAgent = (ctx as any).userAgent || data.req?.headers?.["user-agent"] || "QuickPatrol-Admin";

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的高校租户或用户未登录");
    }

    if (role !== 4) {
      return returnError("操作权限不足: 仅校级安全管理员有权执行强制熔断撤回");
    }

    return handleAdminForceWithdraw({
      schoolId,
      userId,
      userRole: role,
      ip,
      userAgent,
      body: data.body,
      params: (data as any).params
    });
  }
};

export default api;
