/**
 * M26: 管理员查询全校待审延期列表处理函数
 * GET /api/patrol/delay/pending
 */

import { DelayController, IDelayOperatorContext } from "../../../../apps/patrol/delayController.js";
import { IPatrolDelayItemDto } from "../../../../apps/patrol/delayTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetPendingApplies(
  operator: IDelayOperatorContext
): Promise<StandardResult<IPatrolDelayItemDto[]>> {
  return DelayController.handleGetPendingApplies(operator);
}
