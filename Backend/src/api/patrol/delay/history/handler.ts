/**
 * M26: 查询工单延期历史流水处理函数
 * GET /api/patrol/delay/history
 */

import { DelayController, IDelayOperatorContext } from "../../../../apps/patrol/delayController.js";
import { IPatrolDelayHistoryResponseDto } from "../../../../apps/patrol/delayTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetDelayHistory(
  operator: IDelayOperatorContext,
  query: { patrolId?: number | string }
): Promise<StandardResult<IPatrolDelayHistoryResponseDto>> {
  return DelayController.handleGetDelayHistory(operator, query);
}
