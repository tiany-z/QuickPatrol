/**
 * M16: 师傅工作台动态待办工单拉取处理函数
 * GET /api/org/tags/worklist
 */

import { fetchTagDecoupledWorklist } from "../../../../services/org/worklistAggregator.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetDynamicWorklist(
  ctx: { schoolId: number; userId: number },
  query: { page?: string; pageSize?: string }
): Promise<StandardResult<any>> {
  try {
    const page = parseInt(query?.page || "1", 10);
    const pageSize = parseInt(query?.pageSize || "20", 10);

    const result = await fetchTagDecoupledWorklist({
      schoolId: ctx.schoolId,
      userId: ctx.userId,
      page,
      pageSize
    });

    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`拉取动态待办工单失败: ${err.message}`);
  }
}
