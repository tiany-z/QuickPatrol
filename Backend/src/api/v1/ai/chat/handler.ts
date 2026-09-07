/**
 * 高校后勤巡查e速办 v4.0 - /api/v1/ai/chat 路由 Handler
 */

import { aiChatController } from "../../../../controllers/aiChatController.js";
import { returnSuccess, StandardResult } from "../../../../shared/flow/result.js";

export async function handleStreamChatRoute(
  req: any,
  res: any,
  body: any,
  userPayload: any
): Promise<StandardResult<any>> {
  if (res) {
    await aiChatController.handleStreamChat(req, res, body, userPayload);
    return returnSuccess({ streamHandled: true });
  }
  return returnSuccess({ message: "未提供 res 对象" });
}
