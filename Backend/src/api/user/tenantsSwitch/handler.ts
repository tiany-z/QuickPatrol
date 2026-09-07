import { MultiTenantTransitService } from "../../../services/user/multiTenantTransitService.js";
import { ISwitchTenantRequest } from "../../../services/user/transitTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";

/**
 * 跨校会话平滑秒级热切端点处理器
 * POST /api/user/tenants/switch
 */
export async function handleSwitchTenant(
  ctx: { schoolId: number; userId: number },
  body: ISwitchTenantRequest
): Promise<StandardResult<any>> {
  try {
    if (!body || typeof body !== "object") {
      return returnError("请求体不能为空");
    }

    if (!body.targetSchoolId || typeof body.targetSchoolId !== "number") {
      return returnError("缺少有效的目标学校参数 (targetSchoolId)");
    }

    const switchResult = await MultiTenantTransitService.switchTenant(
      ctx.userId,
      ctx.schoolId,
      body.targetSchoolId
    );

    return returnSuccess(switchResult);
  } catch (err: any) {
    return returnError(`切换学校失败: ${err.message}`);
  }
}
