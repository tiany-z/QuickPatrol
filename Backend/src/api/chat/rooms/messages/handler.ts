import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatMessageController } from "../../../../apps/chat/chatMessageController.js";
import { ISendMessageResponseDto } from "../../../../apps/chat/chatMessageTypes.js";

const controller = new ChatMessageController();

export async function handleSendMessage(
  ctx: { schoolId: number; userId: number; role?: number },
  body?: any,
  params?: any
): Promise<StandardResult<ISendMessageResponseDto>> {
  return controller.handleSendMessage(ctx, body, params);
}
