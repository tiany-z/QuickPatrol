/**
 * M21: 校内 POI 空间吸附 API 路由端点
 * POST /api/patrol/poi/snap
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleSnapPoi } from "./handler.js";
import { returnError } from "../../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/patrol/poi/snap",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const schoolId = Number(ctx.userPayload?.schoolId || (ctx as any).schoolId);
    const userId = Number(ctx.userPayload?.userId || (ctx as any).userId);

    if (!schoolId || isNaN(schoolId)) {
      return returnError("无效的高校租户上下文");
    }

    return handleSnapPoi({ schoolId, userId }, data.body);
  }
};

export default api;
