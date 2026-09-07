/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/schedules/day 网关元数据定义
 * 获取某天的垂直时刻时间轴与值班师傅名单
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetDayRoute } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v1/schedules/day",
  authRequired: false,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const userPayload = ctx.userPayload || {};
    const schoolId = Number(
      userPayload.schoolId !== undefined
        ? userPayload.schoolId
        : (ctx as any).schoolId !== undefined
        ? (ctx as any).schoolId
        : data.req?.headers?.["x-school-id"] ||
          data.query?.schoolId ||
          1
    );

    return handleGetDayRoute(data.req, data.res, data.query || {}, {
      ...userPayload,
      schoolId
    });
  }
};

export default api;
