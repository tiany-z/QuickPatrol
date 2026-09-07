/**
 * M16: 获取全校岗位标签全景调度大盘处理函数
 * GET /api/org/tags/list 或 /api/org/tags/dashboard
 */

import { TagService } from "../../../../services/org/tagService.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetTagDashboard(ctx: { schoolId: number }): Promise<StandardResult<any>> {
  try {
    if (!ctx.schoolId || ctx.schoolId <= 0) {
      return returnError("缺少合法的租户标识 schoolId");
    }
    const dashboard = await TagService.getTagAssignmentsDashboard(ctx.schoolId);
    return returnSuccess(dashboard);
  } catch (err: any) {
    return returnError(`获取标签调度大盘失败: ${err.message}`);
  }
}
