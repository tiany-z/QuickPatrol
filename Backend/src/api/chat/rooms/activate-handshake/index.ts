import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleActivateHandshake } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/chat/rooms/activate-handshake",
  authRequired: true, // 仅责任师傅或登录后勤人员可调用
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.body?.schoolId ||
      1
    );

    const userId = Number(ctx.userPayload?.userId || 0);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先完成师傅身份登录");
    }

    return handleActivateHandshake({ schoolId, userId }, data.body, data.query);
  }
};

export default api;
