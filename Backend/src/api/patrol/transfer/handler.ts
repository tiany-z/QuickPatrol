/**
 * M24: 现场协同改派与转交处理函数
 * POST /api/patrol/transfer
 */

import { AcceptController } from "../../../apps/patrol/acceptController.js";
import { ITransferPatrolRequest, ITransferPatrolResponseDto } from "../../../apps/patrol/stateMachineTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleTransferPatrol(
  operator: { schoolId: number; userId: number; role?: number; ip?: string },
  body: ITransferPatrolRequest
): Promise<StandardResult<ITransferPatrolResponseDto>> {
  return AcceptController.handleTransfer(operator, body);
}
