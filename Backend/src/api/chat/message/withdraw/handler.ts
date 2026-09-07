/**
 * M25: 撤回消息处理函数
 * POST /api/chat/message/withdraw
 */

import { ChatController, IChatOperatorContext } from "../../../../apps/chat/chatController.js";
import { IWithdrawMessageRequest, IWithdrawMessageResponseDto } from "../../../../apps/chat/chatTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleWithdrawMessage(
  operator: IChatOperatorContext,
  body: IWithdrawMessageRequest
): Promise<StandardResult<IWithdrawMessageResponseDto>> {
  return ChatController.handleWithdrawMessage(operator, body);
}
