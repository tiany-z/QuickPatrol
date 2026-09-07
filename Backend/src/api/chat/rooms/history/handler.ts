import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatMessageController } from "../../../../apps/chat/chatMessageController.js";
import { IChatMessageListDto } from "../../../../apps/chat/chatMessageTypes.js";

const controller = new ChatMessageController();

export async function handleGetHistory(
  ctx: { schoolId: number; userId: number },
  query?: any,
  params?: any
): Promise<StandardResult<IChatMessageListDto>> {
  return controller.handleGetHistory(ctx, query, params);
}
