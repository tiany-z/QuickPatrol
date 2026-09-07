import { StandardResult } from "../../../../shared/flow/result.js";
import { PostCommentController, ICommentContext } from "../../../../apps/space/postCommentController.js";

const controller = new PostCommentController();

export async function handleDeleteComment(
  ctx: ICommentContext,
  body: any
): Promise<StandardResult<any>> {
  return controller.handleDeleteComment(ctx, body);
}
