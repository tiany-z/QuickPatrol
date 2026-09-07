import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";
import { ISubmitReplyRequestDto, ISubmitReplyResponseDto } from "../../../../apps/feedback/officialReplyTypes.js";

export async function handleSubmitReply(
  ctx: IOfficialReplyContext,
  body: ISubmitReplyRequestDto
): Promise<StandardResult<ISubmitReplyResponseDto>> {
  return OfficialReplyController.handleSubmitReply(ctx, body);
}
