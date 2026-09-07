/**
 * M25: 发送即时消息处理函数
 * POST /api/chat/message/send
 */

import { ChatController, IChatOperatorContext } from "../../../../apps/chat/chatController.js";
import { ISendMessageRequest, ISendMessageResponseDto } from "../../../../apps/chat/chatTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleSendMessage(
  operator: IChatOperatorContext,
  body: ISendMessageRequest
): Promise<StandardResult<ISendMessageResponseDto>> {
  return ChatController.handleSendMessage(operator, body);
}
