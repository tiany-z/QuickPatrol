/**
 * M15: 获取全校飞书式树状组织架构端点
 * GET /api/org/departments/getTree
 */

import { DepartmentService } from "../../../../services/org/departmentService.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetDepartmentTree(ctx: { schoolId: number }): Promise<StandardResult<any>> {
  try {
    if (!ctx.schoolId || ctx.schoolId <= 0) {
      return returnError("缺少合法的租户标识 schoolId");
    }
    const tree = await DepartmentService.getSchoolDepartmentTree(ctx.schoolId);
    return returnSuccess(tree);
  } catch (err: any) {
    return returnError(`获取组织架构树失败: ${err.message}`);
  }
}
