import { StandardResult } from "../../../../shared/flow/result.js";
import { SpaceNoticeController } from "../../../../apps/space/spaceNoticeController.js";
import { IPublishNoticeResponseDto } from "../../../../apps/space/postLikeTypes.js";

const controller = new SpaceNoticeController();

export async function handlePublishTopNotice(
  ctx: { schoolId: number; userId: number; role: number },
  body: any
): Promise<StandardResult<IPublishNoticeResponseDto>> {
  return controller.handlePublishTopNotice(ctx, body);
}
