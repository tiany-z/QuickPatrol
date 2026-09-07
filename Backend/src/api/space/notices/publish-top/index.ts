import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handlePublishTopNotice } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/notices/publish-top",
  authRequired: true, // 仅后勤主管/校级管理员有权调用
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.body?.schoolId ||
      1
    );

    const userId = Number(ctx.userPayload?.userId || 0);
    const role = Number(ctx.userPayload?.role ?? 1);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    if (!userId || userId <= 0) {
      return returnError("请先完成管理员身份登录");
    }

    return handlePublishTopNotice({ schoolId, userId, role }, data.body);
  }
};

export default api;
