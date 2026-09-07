/**
 * 高校后勤巡查e速办 v4.0 - POST /api/v4/notification/app-feed/ack-read 路由 Handler
 */

import { StandardResult } from "../../../../../shared/flow/result.js";
import { AppFeedController } from "../../../../../hub/appFeedController.js";
import { IAppFeedHttpCtx } from "../../../../../hub/appFeedTypes.js";

const controller = new AppFeedController();

export async function handleBatchAckRead(
  ctx: { schoolId: number; userId: number; userRole?: number },
  body?: any
): Promise<StandardResult<any>> {
  const httpCtx: IAppFeedHttpCtx = {
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    body
  };
  return controller.handleBatchAckRead(httpCtx);
}
