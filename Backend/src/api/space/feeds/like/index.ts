import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleLikeFeed } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/feeds/like",
  authRequired: false, // 访客免密点赞
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.body?.schoolId ||
      1
    );

    const clientIp =
      (data.req?.headers?.["x-forwarded-for"] as string) ||
      (data.req?.headers?.["x-real-ip"] as string) ||
      "127.0.0.1";

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleLikeFeed({
      schoolId,
      ip: clientIp,
      body: data.body,
      params: data.query
    });
  }
};

export default api;
