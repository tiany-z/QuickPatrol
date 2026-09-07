/**
 * M12: 保存当前学校个性化设置路由定义
 * 自动扫描挂载路径: POST /api/school/settings/save
 */

import { ApiEndpointModule, HttpRequestData, RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { saveSettingHandler } from "./handler.js";
import { ISaveSettingRequest } from "../../../../services/school/settingsTypes.js";

export const api: ApiEndpointModule<ISaveSettingRequest, boolean> = {
  routePath: "/api/school/settings/save",
  authRequired: true,
  handler: async (data: HttpRequestData<ISaveSettingRequest>, ctx: RequestContext) => {
    return saveSettingHandler(ctx, data.body);
  }
};

export default api;
