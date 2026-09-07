import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleDeleteComment } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/comments/delete",
  authRequired: true, // 软删除违规评论必须具备登录身份
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || 1);
    const userId = Number(ctx.userPayload?.userId || 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleDeleteComment({ schoolId, userId }, data.body);
  }
};

export default api;
