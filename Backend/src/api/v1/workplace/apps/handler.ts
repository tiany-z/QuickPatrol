/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/workplace/apps 路由 Handler
 */

import { workplaceController } from "../../../../controllers/workplaceController.js";
import { returnSuccess, StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetAppsRoute(
  req: any,
  res: any,
  query: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await workplaceController.handleGetApps(req, res, query, userPayload);
  return returnSuccess(result.data);
}
