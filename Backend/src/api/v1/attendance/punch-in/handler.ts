/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/attendance/punch-in 路由 Handler
 */

import { attendanceController } from "../../../../controllers/attendanceController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handlePunchInRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await attendanceController.handlePunchIn(req, res, body, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "打卡失败");
  }
  return returnSuccess(result.data);
}
