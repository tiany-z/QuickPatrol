/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/attendance/monthly-report 路由 Handler
 */

import { attendanceController } from "../../../../controllers/attendanceController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleMonthlyReportRoute(
  req: any,
  res: any,
  query: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await attendanceController.handleGetMonthlyReport(req, res, query, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "获取月度考勤报表失败");
  }
  return returnSuccess(result.data);
}
