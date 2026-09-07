import { StandardResult } from "../../../../shared/flow/result.js";
import { SpaceNoticeController } from "../../../../apps/space/spaceNoticeController.js";
import { IToggleLikeResponseDto } from "../../../../apps/space/postLikeTypes.js";

const controller = new SpaceNoticeController();

export async function handleToggleLike(
  ctx: { schoolId: number; userId: number },
  body?: any,
  params?: any
): Promise<StandardResult<IToggleLikeResponseDto>> {
  return controller.handleToggleLike(ctx, body, params);
}
