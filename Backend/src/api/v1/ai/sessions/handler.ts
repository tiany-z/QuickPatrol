/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/ai/sessions 路由 Handler
 */

import { aiSessionController } from "../../../../controllers/aiSessionController.js";
import { returnSuccess, StandardResult } from "../../../../shared/flow/result.js";

export async function handleSessionsRoute(
  req: any,
  res: any,
  query: any,
  userPayload: any
): Promise<StandardResult<any>> {
  const result = await aiSessionController.handleSessionsRoute(req, res, query, userPayload);
  return returnSuccess(result);
}
