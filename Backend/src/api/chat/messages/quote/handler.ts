/**
 * M39: 发送引用消息处理函数
 * POST /api/v4/chat/messages/quote
 */

import { ChatQuoteController, IChatHttpCtx } from "../../../../apps/chat/chatQuoteController.js";
import { StandardResult } from "../../../../shared/flow/result.js";

const controller = new ChatQuoteController();

export async function handleSendQuoteMessage(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
  return controller.handleSendQuote(ctx);
}
