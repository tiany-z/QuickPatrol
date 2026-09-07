/**
 * M38: 撤回消息处理函数
 * POST /api/v4/chat/messages/withdraw
 */

import { ChatWithdrawController, IChatHttpCtx } from "../../../../apps/chat/chatWithdrawController.js";
import { StandardResult } from "../../../../shared/flow/result.js";

const controller = new ChatWithdrawController();

export async function handleWithdrawMessage(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
  return controller.handleWithdraw(ctx);
}
