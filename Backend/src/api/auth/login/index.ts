/**
 * M13: 微信静默授权登录路由定义
 * 自动扫描挂载路径: POST /api/auth/login
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { handleWeChatLogin } from "./handler.js";

export const api: ApiEndpointModule = {
  routePath: "/api/auth/login",
  authRequired: false,
  handler: async (data: HttpRequestData, _ctx: RequestContext) => {
    return handleWeChatLogin(data.body);
  }
};

export default api;
