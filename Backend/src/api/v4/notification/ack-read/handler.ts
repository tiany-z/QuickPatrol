/**
 * 高校后勤巡查e速办 v4.0 - POST /api/v4/notification/ack-read 路由 Handler
 */

import { StandardResult } from "../../../../shared/flow/result.js";
import { NotificationController, INotificationHttpCtx } from "../../../../hub/notificationController.js";

const controller = new NotificationController();

export async function handleAckRead(
  ctx: { schoolId: number; userId: number; userRole?: number },
  body?: any,
  query?: any,
  params?: any
): Promise<StandardResult<any>> {
  const httpCtx: INotificationHttpCtx = {
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    body,
    query,
    params
  };
  return controller.handleAckRead(httpCtx);
}
