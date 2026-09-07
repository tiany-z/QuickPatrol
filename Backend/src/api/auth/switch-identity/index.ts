/**
 * M13: 双身份无缝热切换路由定义
 * 自动扫描挂载路径: POST /api/auth/switch-identity
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { extractBearerToken } from "../../../utils/httpHelper.js";
import { handleSwitchIdentity } from "./handler.js";
import { returnError } from "../../../shared/flow/result.js";

export const api: ApiEndpointModule = {
  routePath: "/api/auth/switch-identity",
  authRequired: true,
  handler: async (data: HttpRequestData, ctx: RequestContext) => {
    const token = extractBearerToken(data.req);
    if (!token) {
      return returnError("未登录或缺少身份凭证");
    }

    const schoolId = Number(ctx.userPayload?.schoolId);
    const userId = Number(ctx.userPayload?.userId);

    if (!schoolId || !userId || isNaN(schoolId) || isNaN(userId)) {
      return returnError("无效的用户上下文");
    }

    return handleSwitchIdentity({ schoolId, userId, token }, data.body);
  }
};

export default api;
