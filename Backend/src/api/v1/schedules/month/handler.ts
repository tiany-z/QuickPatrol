/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/schedules/month 路由 Handler
 */

import { scheduleController } from "../../../../controllers/scheduleController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetMonthRoute(
  req: any,
  res: any,
  query: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await scheduleController.handleGetMonth(req, res, query, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "获取月历失败");
  }
  return returnSuccess(result.data);
}
