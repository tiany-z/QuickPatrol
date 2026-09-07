/**
 * M38: 调阅撤回存根处理函数
 * GET /api/v4/chat/audit/withdrawn-stubs
 */

import { ChatAuditController, IAuditHttpCtx } from "../../../../apps/chat/chatAuditController.js";
import { StandardResult } from "../../../../shared/flow/result.js";

const controller = new ChatAuditController();

export async function handleGetWithdrawnStubs(ctx: IAuditHttpCtx): Promise<StandardResult<any>> {
  return controller.handleGetAuditStubs(ctx);
}
