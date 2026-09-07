/**
 * 高校后勤巡查e速办 v4.0 - POST /api/v4/presence/heartbeat 路由 Handler
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import { PresenceController } from "../../../../hub/presenceController.js";
import { IPresenceHttpCtx } from "../../../../hub/presenceTypes.js";

const controller = new PresenceController();

export async function handleHeartbeat(
  ctx: { schoolId: number; userId: number; userRole?: number },
  body?: any
): Promise<StandardResult<any>> {
  const httpCtx: IPresenceHttpCtx = {
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    body
  };
  return controller.handleHeartbeat(httpCtx);
}
