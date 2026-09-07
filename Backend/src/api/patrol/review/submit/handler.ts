/**
 * M28: 质检复核到场核验端点处理器
 * POST /api/patrol/review/submit
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  PatrolReviewController,
  IReviewOperatorContext
} from "../../../../apps/patrol/patrolReviewController.js";
import {
  ISubmitPatrolReviewRequestDto,
  ISubmitPatrolReviewResponseDto
} from "../../../../apps/patrol/patrolReviewTypes.js";

export async function handleSubmitPatrolReview(
  ctx: IReviewOperatorContext,
  body: ISubmitPatrolReviewRequestDto & { patrolId?: number }
): Promise<StandardResult<ISubmitPatrolReviewResponseDto>> {
  return PatrolReviewController.handleSubmitPatrolReview(ctx, body);
}
