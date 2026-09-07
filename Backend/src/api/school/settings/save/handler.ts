/**
 * M12: 保存或更新当前学校个性化设置 Handler
 * 路径: POST /api/school/settings/save
 */

import { RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { returnError, StandardResult } from "../../../../shared/flow/result.js";
import { SettingsService } from "../../../../services/school/settingsService.js";
import { ISaveSettingRequest } from "../../../../services/school/settingsTypes.js";

export async function saveSettingHandler(
  ctx: RequestContext,
  body: ISaveSettingRequest
): Promise<StandardResult<boolean>> {
  const schoolId = ctx.userPayload?.schoolId || (ctx as any).schoolId;
  if (!schoolId) {
    return returnError("缺少租户标识");
  }

  const role = ctx.userPayload?.role !== undefined ? ctx.userPayload.role : (ctx as any).role;
  // 门禁：仅限主管及以上角色修改 (role >= 3)
  if (role !== undefined && role < 3) {
    return returnError("无权修改该单位配置参数");
  }

  if (!body || !body.key || body.value === undefined || body.value === null) {
    return returnError("配置项 Key 与 Value 不能为空");
  }

  const userId = typeof ctx.userPayload?.userId === "number" ? ctx.userPayload.userId : 0;
  return await SettingsService.saveSetting(schoolId, body, userId);
}

export default saveSettingHandler;
