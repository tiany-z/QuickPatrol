import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetHistory } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/chat/rooms/history",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.query?.schoolId ||
      1
    );

    const userId = Number(ctx.userPayload?.userId || 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先完成身份登录");
    }

    return handleGetHistory({ schoolId, userId }, data.query, (data as any).params);
  }
};

export default api;
