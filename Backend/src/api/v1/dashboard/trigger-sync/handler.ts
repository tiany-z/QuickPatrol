/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/dashboard/trigger-sync 路由 Handler
 */

import { macroDashboardController } from "../../../../controllers/macroDashboardController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleTriggerSyncRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await macroDashboardController.handleTriggerSync(req, res, body, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "触发差分同步失败");
  }
  return returnSuccess(result.data);
}
