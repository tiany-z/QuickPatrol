/**
 * 高校后勤巡查e速办 v4.0 - GET /api/v4/notification/app-feed 路由 Handler
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import { AppFeedController } from "../../../../hub/appFeedController.js";
import { IAppFeedHttpCtx } from "../../../../hub/appFeedTypes.js";

const controller = new AppFeedController();

export async function handleGetFeed(
  ctx: { schoolId: number; userId: number; userRole?: number },
  query?: any
): Promise<StandardResult<any>> {
  const httpCtx: IAppFeedHttpCtx = {
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    query
  };
  return controller.handleGetFeed(httpCtx);
}
