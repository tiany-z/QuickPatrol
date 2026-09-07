import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";
import { IClaimAppealDto } from "../../../../apps/feedback/officialReplyTypes.js";

export async function handleClaimAppeal(
  ctx: IOfficialReplyContext,
  body: IClaimAppealDto
): Promise<StandardResult<{ message: string }>> {
  return OfficialReplyController.handleClaimAppeal(ctx, body);
}
