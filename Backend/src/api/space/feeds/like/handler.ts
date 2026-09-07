import { StandardResult } from "../../../../shared/flow/result.js";
import { SpaceFeedController } from "../../../../apps/space/spaceFeedController.js";
import { IGuestLikeResponseDto } from "../../../../apps/space/spaceFeedTypes.js";

const controller = new SpaceFeedController();

export async function handleLikeFeed(ctx: {
  schoolId: number;
  ip?: string;
  body?: any;
  params?: any;
}): Promise<StandardResult<IGuestLikeResponseDto>> {
  return controller.handleLikeFeed(ctx);
}
