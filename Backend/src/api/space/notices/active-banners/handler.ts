import { StandardResult } from "../../../../shared/flow/result.js";
import { SpaceNoticeController } from "../../../../apps/space/spaceNoticeController.js";
import { ITopNoticeBannerDto } from "../../../../apps/space/postLikeTypes.js";

const controller = new SpaceNoticeController();

export async function handleGetActiveBanners(
  ctx: { schoolId: number }
): Promise<StandardResult<ITopNoticeBannerDto[]>> {
  return controller.handleGetActiveBanners(ctx);
}
