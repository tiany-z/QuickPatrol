/**
 * M25: 游标拉取消息历史处理函数
 * GET /api/chat/message/list
 */

import { ChatController, IChatOperatorContext } from "../../../../apps/chat/chatController.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetMessages(
  operator: IChatOperatorContext,
  query: { chatRoomId?: number | string; cursorId?: number | string; limit?: number | string }
): Promise<StandardResult<any[]>> {
  return ChatController.handleGetMessages(operator, query);
}
