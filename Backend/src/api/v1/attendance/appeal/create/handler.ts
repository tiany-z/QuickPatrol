/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/attendance/appeal/create 路由 Handler
 */

import { attendanceController } from "../../../../../controllers/attendanceController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../../shared/flow/result.js";

export async function handleCreateAppealRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await attendanceController.handleCreateAppeal(req, res, body, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "提交补卡申诉失败");
  }
  return returnSuccess(result.data);
}
