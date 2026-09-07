import { StandardResult } from "../../../shared/flow/result.js";
import { SpaceFeedController } from "../../../apps/space/spaceFeedController.js";
import { IPublicFeedListDto } from "../../../apps/space/spaceFeedTypes.js";

const controller = new SpaceFeedController();

export async function handleGetFeeds(ctx: {
  schoolId: number;
  schoolCode?: string;
  query?: any;
}): Promise<StandardResult<IPublicFeedListDto>> {
  return controller.handleGetFeeds(ctx);
}
