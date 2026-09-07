import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleToggleLike } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/feeds/toggle-like",
  authRequired: true, // 必须具备师生登录身份 (userId > 0)
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.query?.schoolId ||
      data.body?.schoolId ||
      1
    );

    const userId = Number(ctx.userPayload?.userId || 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先完成师生身份登录后点赞");
    }

    return handleToggleLike({ schoolId, userId }, data.body, data.query);
  }
};

export default api;
