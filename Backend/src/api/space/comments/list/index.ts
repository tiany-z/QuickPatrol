import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleListComments } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/comments/list",
  authRequired: false, // 允许访客免密拉取评论树
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.query?.schoolId ||
      1
    );

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleListComments({ schoolId }, data.query);
  }
};

export default api;
