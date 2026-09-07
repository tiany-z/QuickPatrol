/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/schedules/create 路由 Handler
 */

import { scheduleController } from "../../../../controllers/scheduleController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleCreateScheduleRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await scheduleController.handleCreateSchedule(req, res, body, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "创建日程失败");
  }
  return returnSuccess(result.data);
}
