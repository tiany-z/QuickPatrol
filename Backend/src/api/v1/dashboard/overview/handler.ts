/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/dashboard/overview 路由 Handler
 */

import { macroDashboardController } from "../../../../controllers/macroDashboardController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetOverviewRoute(
  req: any,
  res: any,
  query: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await macroDashboardController.handleGetOverview(req, res, query, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "大盘数据获取失败");
  }
  return returnSuccess(result.data);
}
