/**
 * M29: 提交工单服务满意度评价端点处理器
 * POST /api/patrol/feedback/submit
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  FeedbackController,
  IFeedbackOperatorContext
} from "../../../../apps/feedback/feedbackController.js";
import {
  ISubmitFeedbackRequestDto,
  ISubmitFeedbackResponseDto
} from "../../../../apps/feedback/feedbackTypes.js";

export async function handleSubmitFeedback(
  ctx: IFeedbackOperatorContext,
  body: ISubmitFeedbackRequestDto & { patrolId?: number }
): Promise<StandardResult<ISubmitFeedbackResponseDto>> {
  return FeedbackController.handleSubmitFeedback(ctx, body);
}
