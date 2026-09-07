/**
 * M15: 部门跨层级平移与全子树原子重写端点处理函数
 * POST /api/org/departments/relocate
 */

import { DepartmentService } from "../../../../services/org/departmentService.js";
import { IRelocateDepartmentRequest } from "../../../../services/org/departmentTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleRelocateDepartment(
  ctx: { schoolId: number; role: number },
  body: IRelocateDepartmentRequest
): Promise<StandardResult<any>> {
  try {
    if (ctx.role < 4) {
      return returnError("越权访问: 仅限学校管理员 (role >= 4) 执行组织架构重组");
    }

    if (!body || !body.departmentId) {
      return returnError("缺少参数: 必须指定 departmentId");
    }

    const result = await DepartmentService.relocateDepartment(
      ctx.schoolId,
      body.departmentId,
      body.targetParentId !== undefined ? body.targetParentId : null
    );

    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`部门平移失败: ${err.message}`);
  }
}
