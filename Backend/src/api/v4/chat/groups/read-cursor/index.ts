import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../../dispatcher/gatewayTypes.js";
import { handleUpdateReadCursor } from "./handler.js";
import { returnError } from "../../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/chat/groups/read-cursor",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.query?.schoolId ||
      1
    );

    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId || 0);
    const userRole = Number(ctx.userPayload?.role ?? (ctx as any).role ?? 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先登录");
    }

    return handleUpdateReadCursor({
      schoolId,
      userId,
      userRole,
      body: data.body,
      query: data.query,
      params: (data as any).params
    });
  }
};

export default api;
