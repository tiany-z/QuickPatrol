/**
 * M12: 获取当前学校个性化设置清单 Handler (敏感项自动脱敏)
 * 路径: GET /api/school/settings/get
 */

import { RequestContext } from "../../../../dispatcher/gatewayTypes.js";
import { returnError, StandardResult } from "../../../../shared/flow/result.js";
import { SettingsService } from "../../../../services/school/settingsService.js";
import { ISettingItemDto } from "../../../../services/school/settingsTypes.js";

export async function getSettingsHandler(
  ctx: RequestContext
): Promise<StandardResult<ISettingItemDto[]>> {
  const schoolId = ctx.userPayload?.schoolId || (ctx as any).schoolId;
  if (!schoolId) {
    return returnError("缺少租户标识");
  }

  const role = ctx.userPayload?.role !== undefined ? ctx.userPayload.role : (ctx as any).role;
  // 门禁：仅限主管及以上角色查看 (role >= 3)
  if (role !== undefined && role < 3) {
    return returnError("无权查看该单位高级配置信息");
  }

  return await SettingsService.getSettingsList(schoolId);
}

export default getSettingsHandler;
