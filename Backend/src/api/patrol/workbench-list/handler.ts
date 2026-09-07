/**
 * M24: 师傅工作台四象限任务列表处理函数
 * GET /api/patrol/workbench-list
 */

import { AcceptController } from "../../../apps/patrol/acceptController.js";
import { IMasterWorkbenchQueryDto, IMasterTaskCardDto } from "../../../apps/patrol/stateMachineTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleGetWorkbenchList(
  operator: { schoolId: number; userId: number; role?: number; ip?: string },
  query: IMasterWorkbenchQueryDto
): Promise<StandardResult<{ list: IMasterTaskCardDto[]; total: number; page: number; pageSize: number }>> {
  return AcceptController.handleGetWorkbenchList(operator, query);
}
