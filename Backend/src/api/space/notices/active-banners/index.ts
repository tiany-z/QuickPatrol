import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetActiveBanners } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v4/space/notices/active-banners",
  authRequired: false, // 公开免密展示置顶通告
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(
      ctx.userPayload?.schoolId ||
      (ctx as any).schoolId ||
      data.req?.headers?.["x-school-id"] ||
      data.query?.schoolId ||
      data.body?.schoolId ||
      1
    );

    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少高校租户标识");
    }

    return handleGetActiveBanners({ schoolId });
  }
};

export default api;
