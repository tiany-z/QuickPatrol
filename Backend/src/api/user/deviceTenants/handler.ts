import { MultiTenantTransitService } from "../../../services/user/multiTenantTransitService.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";

/**
 * 跨校多租户账号与待办红点并发反查端点处理器
 * POST /api/user/device-tenants
 */
export async function handleGetDeviceTenants(
  ctx: { schoolId: number; userId: number },
  body: { phone?: string }
): Promise<StandardResult<any>> {
  try {
    const phone = body?.phone;
    if (!phone) {
      return returnError("缺少查询手机号参数");
    }

    const data = await MultiTenantTransitService.getCrossTenantList(phone, ctx.schoolId);
    return returnSuccess(data);
  } catch (err: any) {
    return returnError(`获取跨校账号失败: ${err.message}`);
  }
}
