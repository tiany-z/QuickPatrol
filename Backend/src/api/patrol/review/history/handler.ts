/**
 * M28: 查询质检复核历史端点处理器
 * GET /api/patrol/review/history
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  PatrolReviewController,
  IReviewOperatorContext
} from "../../../../apps/patrol/patrolReviewController.js";
import { IPatrolReviewHistoryResponseDto } from "../../../../apps/patrol/patrolReviewTypes.js";

export async function handleGetReviewHistory(
  ctx: IReviewOperatorContext,
  query: Record<string, any>
): Promise<StandardResult<IPatrolReviewHistoryResponseDto>> {
  const patrolId = Number(query.patrolId || query.id);
  return PatrolReviewController.handleGetReviewHistory(ctx, patrolId);
}
