/**
 * M25: 标记已读处理函数
 * POST /api/chat/room/mark-read
 */

import { ChatController, IChatOperatorContext } from "../../../../apps/chat/chatController.js";
import { IMarkReadRequest } from "../../../../apps/chat/chatTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleMarkRead(
  operator: IChatOperatorContext,
  body: IMarkReadRequest
): Promise<StandardResult<{ success: boolean }>> {
  return ChatController.handleMarkRead(operator, body);
}
