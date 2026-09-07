/**
 * M27: 师傅现场完工交卷端点处理器
 * POST /api/patrol/handle/submit
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  PatrolHandleController,
  IHandleOperatorContext
} from "../../../../apps/patrol/patrolHandleController.js";
import {
  ISubmitPatrolHandleRequestDto,
  ISubmitPatrolHandleResponseDto
} from "../../../../apps/patrol/patrolHandleTypes.js";

export async function handleSubmitPatrolHandle(
  ctx: IHandleOperatorContext,
  body: ISubmitPatrolHandleRequestDto
): Promise<StandardResult<ISubmitPatrolHandleResponseDto>> {
  return PatrolHandleController.handleSubmitPatrolHandle(ctx, body);
}
