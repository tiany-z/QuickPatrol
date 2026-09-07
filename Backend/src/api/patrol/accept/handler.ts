/**
 * M24: 师傅接单 / 抢单处理函数
 * POST /api/patrol/accept
 */

import { AcceptController } from "../../../apps/patrol/acceptController.js";
import { IAcceptPatrolRequest, IAcceptPatrolResponseDto } from "../../../apps/patrol/stateMachineTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleAcceptPatrol(
  operator: { schoolId: number; userId: number; role?: number; ip?: string; realName?: string },
  body: IAcceptPatrolRequest
): Promise<StandardResult<IAcceptPatrolResponseDto>> {
  return AcceptController.handleAccept(operator, body);
}
