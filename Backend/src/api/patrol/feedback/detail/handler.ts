/**
 * M29: 查询工单评价详情端点处理器
 * GET /api/patrol/feedback/detail
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  FeedbackController,
  IFeedbackOperatorContext
} from "../../../../apps/feedback/feedbackController.js";
import { IFeedbackDetailDto } from "../../../../apps/feedback/feedbackTypes.js";

export async function handleGetFeedbackDetail(
  ctx: IFeedbackOperatorContext,
  query: Record<string, any>
): Promise<StandardResult<IFeedbackDetailDto | null>> {
  const patrolId = Number(query.patrolId || query.id);
  return FeedbackController.handleGetFeedbackDetail(ctx, patrolId);
}
