import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleGetFeeds } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/feeds",
  authRequired: false, // 0 门槛免登录公网直出
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.query?.schoolId ||
      1
    );
    const schoolCode = (data.query?.schoolCode as string) || (data.req?.headers?.["x-school-code"] as string) || "lcu";

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleGetFeeds({
      schoolId,
      schoolCode,
      query: data.query
    });
  }
};

export default api;
