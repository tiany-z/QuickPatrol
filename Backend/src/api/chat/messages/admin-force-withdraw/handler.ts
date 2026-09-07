/**
 * M38: 管理员强制撤回处理函数
 * POST /api/v4/chat/messages/admin-force-withdraw
 */

import { ChatWithdrawController, IChatHttpCtx } from "../../../../apps/chat/chatWithdrawController.js";
import { returnError, returnSuccess, StandardResult } from "../../../../shared/flow/result.js";

const controller = new ChatWithdrawController();

export async function handleAdminForceWithdraw(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
  const res = await controller.adminForceWithdraw(ctx);
  if (res.code === 200) {
    return returnSuccess(res.data, res.message || "管理员强制撤回成功");
  }
  return returnError(res.message || "管理员强制撤回失败");
}
