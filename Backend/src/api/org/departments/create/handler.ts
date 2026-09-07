/**
 * M15: 创建新部门端点处理函数
 * POST /api/org/departments/create
 */

import { DepartmentService } from "../../../../services/org/departmentService.js";
import { ICreateDepartmentDto } from "../../../../services/org/departmentTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleCreateDepartment(
  ctx: { schoolId: number; role: number },
  body: ICreateDepartmentDto
): Promise<StandardResult<any>> {
  try {
    // 权限校验：仅限科室主管或校管 (role >= 3)
    if (ctx.role < 3) {
      return returnError("权限不足: 仅限主管或管理员维护组织架构");
    }

    if (!body || !body.name || body.name.trim() === "") {
      return returnError("缺少参数: 部门名称不能为空");
    }

    const created = await DepartmentService.createDepartment(ctx.schoolId, body);
    return returnSuccess(created);
  } catch (err: any) {
    return returnError(`创建部门失败: ${err.message}`);
  }
}
