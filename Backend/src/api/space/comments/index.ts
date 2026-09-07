import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleCreateComment, handleListComments, handleDeleteComment } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/comments",
  authRequired: false, // 允许访客免密调用
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
    const clientIp =
      (data.req?.headers?.["x-forwarded-for"] as string) ||
      (data.req?.headers?.["x-real-ip"] as string) ||
      "127.0.0.1";

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    const method = (data.req?.method || "POST").toUpperCase();

    // 1. DELETE 请求
    if (method === "DELETE" || data.body?.action === "delete") {
      return handleDeleteComment({ schoolId, userId, ip: clientIp }, data.body);
    }

    // 2. GET 请求 (拉取楼中楼列表)
    if (method === "GET" || (data.query?.postId && !data.body?.content)) {
      return handleListComments({ schoolId, userId, ip: clientIp }, data.query);
    }

    // 3. POST 请求 (发表留言)
    return handleCreateComment({ schoolId, userId, ip: clientIp }, data.body);
  }
};

export default api;
