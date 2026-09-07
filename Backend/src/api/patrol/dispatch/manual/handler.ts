/**
 * M23: 手动指定派单与改派业务处理器
 * POST /api/patrol/dispatch/manual
 */

import { DispatchController } from "../../../../apps/patrol/dispatchController.js";
import { IManualDispatchRequest } from "../../../../apps/patrol/dispatchTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleManualDispatch(
  ctx: { schoolId: number; userId: number; role?: number; ip?: string },
  body: IManualDispatchRequest
): Promise<StandardResult<any>> {
  return DispatchController.handleManualDispatch(ctx, body);
}
