/**
 * M39: 极远源消息上下文切片查询处理函数
 * GET /api/v4/chat/rooms/context-slice
 */

import { ChatQuoteController, IChatHttpCtx } from "../../../../apps/chat/chatQuoteController.js";
import { StandardResult } from "../../../../shared/flow/result.js";

const controller = new ChatQuoteController();

export async function handleGetContextSlice(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
  return controller.handleGetContextSlice(ctx);
}
