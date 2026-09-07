/**
 * M26: 管理员审批工单延期申请处理函数
 * POST /api/patrol/delay/review
 */

import { DelayController, IDelayOperatorContext } from "../../../../apps/patrol/delayController.js";
import { IReviewDelayApplyRequestDto, IReviewDelayApplyResponseDto } from "../../../../apps/patrol/delayTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleReviewDelayApply(
  operator: IDelayOperatorContext,
  body: IReviewDelayApplyRequestDto
): Promise<StandardResult<IReviewDelayApplyResponseDto>> {
  return DelayController.handleReviewDelayApply(operator, body);
}
