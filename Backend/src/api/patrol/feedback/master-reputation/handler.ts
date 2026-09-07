/**
 * M29: 查询师傅口碑画像端点处理器
 * GET /api/patrol/feedback/master-reputation
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  FeedbackController,
  IFeedbackOperatorContext
} from "../../../../apps/feedback/feedbackController.js";
import { IMasterReputationProfileDto } from "../../../../apps/feedback/feedbackTypes.js";

export async function handleGetMasterReputation(
  ctx: IFeedbackOperatorContext,
  query: Record<string, any>
): Promise<StandardResult<IMasterReputationProfileDto>> {
  const masterId = Number(query.masterId || query.handlerId || query.id);
  return FeedbackController.handleGetMasterReputation(ctx, masterId);
}
