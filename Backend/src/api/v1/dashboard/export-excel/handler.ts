/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/dashboard/export-excel 路由 Handler
 */

import { macroDashboardController } from "../../../../controllers/macroDashboardController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleExportExcelRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await macroDashboardController.handleExportExcel(req, res, body, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "工单Excel导出失败");
  }
  return returnSuccess(result.data);
}
