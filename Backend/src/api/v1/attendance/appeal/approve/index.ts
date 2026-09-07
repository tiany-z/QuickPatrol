/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/attendance/appeal/approve 网关元数据定义
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../../dispatcher/gatewayTypes.js";
import { handleApproveAppealRoute } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v1/attendance/appeal/approve",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const userPayload = ctx.userPayload || {};
    const schoolId = Number(
      userPayload.schoolId !== undefined
        ? userPayload.schoolId
        : (ctx as any).schoolId !== undefined
        ? (ctx as any).schoolId
        : data.req?.headers?.["x-school-id"] ||
          data.body?.schoolId ||
          1
    );

    return handleApproveAppealRoute(data.req, data.res, data.body || {}, {
      ...userPayload,
      schoolId
    });
  }
};

export default api;
