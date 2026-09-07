import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatSessionController } from "../../../../apps/chat/chatSessionController.js";

const controller = new ChatSessionController();

export async function handleTogglePin(
  ctx: { schoolId: number; userId: number; userRole?: number },
  body?: any,
  query?: any
): Promise<StandardResult<any>> {
  return controller.handleTogglePin({
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    body,
    query
  });
}
