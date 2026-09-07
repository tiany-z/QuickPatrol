import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";
import { IAssignDeptDto } from "../../../../apps/feedback/officialReplyTypes.js";

export async function handleForceAssignDept(
  ctx: IOfficialReplyContext,
  body: IAssignDeptDto
): Promise<StandardResult<{ message: string }>> {
  return OfficialReplyController.handleForceAssignDept(ctx, body);
}
