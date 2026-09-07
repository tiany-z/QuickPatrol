import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";
import { IPromoteToPublicSpaceDto } from "../../../../apps/feedback/officialReplyTypes.js";

export async function handlePromoteToPublic(
  ctx: IOfficialReplyContext,
  body: IPromoteToPublicSpaceDto
): Promise<StandardResult<{ message: string }>> {
  return OfficialReplyController.handlePromoteToPublic(ctx, body);
}
