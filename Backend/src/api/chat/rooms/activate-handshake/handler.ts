import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatRoomController } from "../../../../apps/chat/chatRoomController.js";
import { IActivateHandshakeResponseDto } from "../../../../apps/chat/chatRoomTypes.js";

const controller = new ChatRoomController();

export async function handleActivateHandshake(
  ctx: { schoolId: number; userId: number },
  body?: any,
  params?: any
): Promise<StandardResult<IActivateHandshakeResponseDto>> {
  return controller.handleActivateHandshake(ctx, body, params);
}
