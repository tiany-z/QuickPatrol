/**
 * 高校后勤巡查e速办 v4.0 - GET /api/v4/notification/sessions 路由 Handler
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import { NotificationController, INotificationHttpCtx } from "../../../../hub/notificationController.js";

const controller = new NotificationController();

export async function handleGetSessions(
  ctx: { schoolId: number; userId: number; userRole?: number },
  query?: any
): Promise<StandardResult<any>> {
  const httpCtx: INotificationHttpCtx = {
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    query
  };
  return controller.handleGetSessions(httpCtx);
}
