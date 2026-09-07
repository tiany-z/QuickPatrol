import { ChatGroupController, IChatHttpCtx } from "../../../../../apps/chat/chatGroupController.js";
import { StandardResult } from "../../../../../shared/flow/result.js";

const controller = new ChatGroupController();

export async function handleToggleMute(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
  return controller.toggleMute(ctx);
}
