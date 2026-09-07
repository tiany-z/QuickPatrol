/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/schedules/month 网关元数据定义
 * 获取月度 42 单元格微圆点大盘
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetMonthRoute } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v1/schedules/month",
  authRequired: false, // 允许访客态与已登录态查看全校重大日程与值班概览
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

    return handleGetMonthRoute(data.req, data.res, data.query || {}, {
      ...userPayload,
      schoolId
    });
  }
};

export default api;
