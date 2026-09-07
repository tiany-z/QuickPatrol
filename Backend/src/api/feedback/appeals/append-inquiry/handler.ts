/**
 * M31: 凭借 Vault Token 进行匿名追加追问端点处理器
 * POST /api/v4/feedback/appeals/append-inquiry
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  FeedbackAppealController,
  IFeedbackAppealContext
} from "../../../../apps/feedback/feedbackAppealController.js";
import {
  IAppendInquiryRequestDto,
  IAppendInquiryResponseDto
} from "../../../../apps/feedback/feedbackAppealTypes.js";

export async function handleAppendInquiry(
  ctx: IFeedbackAppealContext,
  body: IAppendInquiryRequestDto
): Promise<StandardResult<IAppendInquiryResponseDto>> {
  return FeedbackAppealController.handleAppendInquiry(ctx, body);
}
