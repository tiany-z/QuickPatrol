import { StandardResult } from "../../../../shared/flow/result.js";
import { ChatSessionController } from "../../../../apps/chat/chatSessionController.js";

const controller = new ChatSessionController();

export async function handleGetSessions(
  ctx: { schoolId: number; userId: number; userRole?: number },
  query?: any
): Promise<StandardResult<any>> {
  return controller.handleGetSessions({
    schoolId: ctx.schoolId,
    userId: ctx.userId,
    userRole: ctx.userRole ?? 0,
    query
  });
}
