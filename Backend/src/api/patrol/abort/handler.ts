/**
 * M30: 异常工单终止作废端点处理器
 * POST /api/patrol/abort
 */

import { StandardResult } from "../../../shared/flow/result.js";
import {
  PatrolDetailController,
  IPatrolDetailOperatorContext
} from "../../../apps/patrol/patrolDetailController.js";
import {
  IAbortPatrolRequestDto,
  IAbortPatrolResponseDto
} from "../../../apps/patrol/patrolDetailTypes.js";

export async function handleAbortPatrol(
  ctx: IPatrolDetailOperatorContext,
  body: IAbortPatrolRequestDto & { patrolId?: number }
): Promise<StandardResult<IAbortPatrolResponseDto>> {
  return PatrolDetailController.handleAbortPatrol(ctx, body);
}
