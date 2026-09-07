/**
 * M31: 凭客户端持有的 Vault Tokens 批量免密查询诉求进展端点处理器
 * POST /api/v4/feedback/appeals/batch-query-by-tokens
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  FeedbackAppealController,
  IFeedbackAppealContext
} from "../../../../apps/feedback/feedbackAppealController.js";
import { IAnonymousAppealDetailDto } from "../../../../apps/feedback/feedbackAppealTypes.js";

export async function handleBatchQueryByTokens(
  ctx: IFeedbackAppealContext,
  body: { vaultTokens: string[] }
): Promise<StandardResult<IAnonymousAppealDetailDto[]>> {
  return FeedbackAppealController.handleBatchQueryByTokens(ctx, body);
}
