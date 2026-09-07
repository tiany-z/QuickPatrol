import { StandardResult } from "../../../../shared/flow/result.js";
import { SpaceFeedController } from "../../../../apps/space/spaceFeedController.js";
import { IGuestCommentResponseDto } from "../../../../apps/space/spaceFeedTypes.js";

const controller = new SpaceFeedController();

export async function handleGuestComment(ctx: {
  schoolId: number;
  body?: any;
  params?: any;
}): Promise<StandardResult<IGuestCommentResponseDto>> {
  return controller.handleGuestComment(ctx);
}
