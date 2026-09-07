import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGuestComment } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/feeds/guest-comment",
  authRequired: false, // 访客免密留言
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.body?.schoolId ||
      1
    );

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleGuestComment({
      schoolId,
      body: data.body,
      params: data.query
    });
  }
};

export default api;
