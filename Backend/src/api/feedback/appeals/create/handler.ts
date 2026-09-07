/**
 * M31: 提交师生诉求建言端点处理器
 * POST /api/v4/feedback/appeals
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  FeedbackAppealController,
  IFeedbackAppealContext
} from "../../../../apps/feedback/feedbackAppealController.js";
import {
  ICreateAppealRequestDto,
  ICreateAppealResponseDto
} from "../../../../apps/feedback/feedbackAppealTypes.js";

export async function handleCreateAppeal(
  ctx: IFeedbackAppealContext,
  body: ICreateAppealRequestDto
): Promise<StandardResult<ICreateAppealResponseDto>> {
  return FeedbackAppealController.handleSubmitAppeal(ctx, body);
}
