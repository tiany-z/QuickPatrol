import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatSessionController } from "../../../../apps/chat/chatSessionController.js";

const controller = new ChatSessionController();

export async function handleAckRead(
  ctx: { schoolId: number; userId: number; role?: number },
  body?: any,
  params?: any
): Promise<StandardResult<any>> {
  return controller.handleAckRead({
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.role ?? 0,
    body,
    params
  });
}

