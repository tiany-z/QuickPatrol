/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/workplace/sort 路由 Handler
 */

import { workplaceController } from "../../../../controllers/workplaceController.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleSavePinsRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await workplaceController.handleSavePins(req, res, body, userPayload);
  if (result.code !== 200) {
    return returnError(result.message || "保存置顶失败");
  }
  return returnSuccess(result.data);
}
