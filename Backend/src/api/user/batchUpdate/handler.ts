/**
 * M19: 批量更新用户属性端点处理器
 * POST /api/user/batch-update
 */

import { UserBatchService } from "../../../services/admin/userBatchService.js";
import { IBatchUpdateUsersRequest } from "../../../services/admin/batchTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";

export async function handleBatchUpdateUsers(
  ctx: { schoolId: number; userId: number; role: number; ip?: string },
  body: IBatchUpdateUsersRequest
): Promise<StandardResult<any>> {
  try {
    if (ctx.role < 3) {
      return returnError("权限不足: 仅限主管或管理员执行批量人员调度");
    }

    if (!body || typeof body !== "object") {
      return returnError("缺少请求体参数");
    }

    const result = await UserBatchService.executeBatchUpdate(
      ctx.schoolId,
      ctx.userId,
      ctx.ip || "127.0.0.1",
      body,
      ctx.role
    );

    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`批量操作失败: ${err.message}`);
  }
}
