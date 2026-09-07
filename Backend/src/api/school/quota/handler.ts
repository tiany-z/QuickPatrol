/**
 * M11: 租户 SaaS 配额健康状态看板查询端点 Handler
 * 路径: GET /api/school/quota
 */

import { RequestContext } from "../../../dispatcher/gatewayTypes.js";
import { returnError, StandardResult } from "../../../shared/flow/result.js";
import { SchoolService } from "../../../services/school/schoolService.js";
import { ITenantQuotaHealthReport } from "../../../services/school/schoolTypes.js";

/**
 * 查询当前高校租户的 SaaS 配额、健康水位与到期状态
 */
export async function getTenantQuotaHandler(
  ctx: RequestContext
): Promise<StandardResult<ITenantQuotaHealthReport>> {
  const schoolId = ctx.userPayload?.schoolId || (ctx as any).schoolId;
  if (!schoolId) {
    return returnError("缺少租户高校识别凭据");
  }

  const role = ctx.userPayload?.role !== undefined ? ctx.userPayload.role : (ctx as any).role;
  // 仅限科室主管、校管理员、超级管理员权限查看配额大盘 (角色代码 >= 3)
  if (role !== undefined && role < 3) {
    return returnError("您无权查看该单位 SaaS 商业化配额信息");
  }

  return await SchoolService.getTenantQuotaHealth(schoolId);
}

export default getTenantQuotaHandler;
