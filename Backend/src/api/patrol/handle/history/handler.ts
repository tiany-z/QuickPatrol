/**
 * M27: 查询施工整改历史端点处理器
 * GET /api/patrol/handle/history
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import {
  PatrolHandleController,
  IHandleOperatorContext
} from "../../../../apps/patrol/patrolHandleController.js";
import { IPatrolHandleHistoryResponseDto } from "../../../../apps/patrol/patrolHandleTypes.js";

export async function handleGetHandleHistory(
  ctx: IHandleOperatorContext,
  query: Record<string, any>
): Promise<StandardResult<IPatrolHandleHistoryResponseDto>> {
  const patrolId = Number(query.patrolId || query.id);
  return PatrolHandleController.handleGetHandleHistory(ctx, patrolId);
}
