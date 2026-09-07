/**
 * M25: 获取用户会话列表大盘处理函数
 * GET /api/chat/sessions
 */

import { ChatController, IChatOperatorContext } from "../../../apps/chat/chatController.js";
import { IChatSessionSummaryDto } from "../../../apps/chat/chatTypes.js";
import { StandardResult } from "../../../shared/flow/result.js";

export async function handleGetSessions(
  operator: IChatOperatorContext
): Promise<StandardResult<IChatSessionSummaryDto[]>> {
  return ChatController.handleGetSessions(operator);
}
