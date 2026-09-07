import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";
import { ISendThanksCardRequestDto, ISendThanksCardResponseDto } from "../../../../apps/feedback/officialReplyTypes.js";

export async function handleSendThanksCard(
  ctx: IOfficialReplyContext,
  body: ISendThanksCardRequestDto
): Promise<StandardResult<ISendThanksCardResponseDto>> {
  return OfficialReplyController.handleSendThanksCard(ctx, body);
}
