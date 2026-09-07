/**
 * M26: 师傅提交工单延期申请处理函数
 * POST /api/patrol/delay/apply
 */

import { DelayController, IDelayOperatorContext } from "../../../../apps/patrol/delayController.js";
import { ICreateDelayApplyRequestDto, ICreateDelayApplyResponseDto } from "../../../../apps/patrol/delayTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleCreateDelayApply(
  operator: IDelayOperatorContext,
  body: ICreateDelayApplyRequestDto
): Promise<StandardResult<ICreateDelayApplyResponseDto>> {
  return DelayController.handleCreateDelayApply(operator, body);
}
