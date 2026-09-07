/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/workplace/apps 网关元数据定义
 * 支持访客态与已登录态获取微应用矩阵
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { handleGetAppsRoute } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/v1/workplace/apps",
  authRequired: false, // 允许访客态调用，展示公共微应用及毛玻璃禁行卡片
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

    return handleGetAppsRoute(data.req, data.res, data.query || {}, {
      ...userPayload,
      schoolId
    });
  }
};

export default api;
