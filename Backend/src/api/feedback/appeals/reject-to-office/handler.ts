import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";
import { IRejectDeptDto } from "../../../../apps/feedback/officialReplyTypes.js";

export async function handleRejectToOffice(
  ctx: IOfficialReplyContext,
  body: IRejectDeptDto
): Promise<StandardResult<{ message: string }>> {
  return OfficialReplyController.handleRejectToOffice(ctx, body);
}
