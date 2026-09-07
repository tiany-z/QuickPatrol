import { MultiTenantTransitService } from "../../../services/user/multiTenantTransitService.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";

/**
 * 过期卡片原地半屏免密快捷续期端点处理器
 * POST /api/auth/quick-renew
 */
export async function handleQuickRenew(body: {
  targetSchoolId: number;
  phone: string;
}): Promise<StandardResult<any>> {
  try {
    if (!body || typeof body !== "object") {
      return returnError("请求体不能为空");
    }

    const { targetSchoolId, phone } = body;
    if (!targetSchoolId || !phone) {
      return returnError("参数缺失: 必须指定 targetSchoolId 与 phone");
    }

    const renewResult = await MultiTenantTransitService.quickRenew(targetSchoolId, phone);
    return returnSuccess(renewResult);
  } catch (err: any) {
    return returnError(`快捷续期失败: ${err.message}`);
  }
}
