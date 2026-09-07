import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatRoomController } from "../../../../apps/chat/chatRoomController.js";
import { IChatRoomMetaDto } from "../../../../apps/chat/chatRoomTypes.js";

const controller = new ChatRoomController();

export async function handleGetRoomMeta(
  ctx: { schoolId: number; userId: number; role?: number },
  params?: any,
  query?: any
): Promise<StandardResult<IChatRoomMetaDto>> {
  return controller.handleGetRoomMeta(ctx, params, query);
}
