/**
 * M21: 隐患工单提报处理器
 * POST /api/patrol/create
 */

import { PatrolController } from "../../../apps/patrol/patrolController.js";
import { ICreatePatrolRequest } from "../../../apps/patrol/patrolTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleCreatePatrol(
  ctx: { schoolId: number; userId: number; role?: number; ip?: string },
  body: ICreatePatrolRequest
): Promise<StandardResult<any>> {
  return PatrolController.createPatrol(ctx, body);
}
