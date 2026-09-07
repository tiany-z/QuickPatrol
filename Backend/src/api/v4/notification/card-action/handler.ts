/**
 * 高校后勤巡查e速办 v4.0 - POST /api/v4/notification/card-action 路由 Handler
 * (Card Action Execution Handler)
 */

import { CardMutationController, IChatHttpCtx } from "../../../../hub/cardMutationController.js";
import { CardMutationService } from "../../../../hub/cardMutationService.js";

let defaultService: CardMutationService | null = null;
let defaultController: CardMutationController | null = null;

function getController(): CardMutationController {
  if (!defaultController) {
    defaultService = new CardMutationService();
    defaultController = new CardMutationController(defaultService);
  }
  return defaultController;
}

export async function handleCardAction(
  userCtx: { schoolId: number; userId: number; userRole?: number },
  body: any
): Promise<any> {
  const controller = getController();
  const ctx: IChatHttpCtx = {
    schoolId: userCtx.schoolId,
    userId: userCtx.userId,
    userRole: userCtx.userRole,
    body
  };
  return controller.handleCardAction(ctx);
}
