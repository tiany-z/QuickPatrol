/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/schedules/day 路由 Handler
 */

import { scheduleController } from "../../../../controllers/scheduleController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetDayRoute(
  req: any,
  res: any,
  query: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await scheduleController.handleGetDay(req, res, query, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "获取日时刻表失败");
  }
  return returnSuccess(result.data);
}
