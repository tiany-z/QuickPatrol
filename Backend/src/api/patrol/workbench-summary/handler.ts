/**
 * M24: 师傅工作台四象限未读数字统计处理函数
 * GET /api/patrol/workbench-summary
 */

import { AcceptController } from "../../../apps/patrol/acceptController.js";
import { IMasterWorkbenchSummaryDto } from "../../../apps/patrol/stateMachineTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleGetWorkbenchSummary(
  operator: { schoolId: number; userId: number; role?: number; ip?: string }
): Promise<StandardResult<IMasterWorkbenchSummaryDto>> {
  return AcceptController.handleGetWorkbenchSummary(operator);
}
