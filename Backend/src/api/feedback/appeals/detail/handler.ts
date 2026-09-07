import { StandardResult } from "../../../../shared/flow/result.js";
import { OfficialReplyController, IOfficialReplyContext } from "../../../../apps/feedback/officialReplyController.js";

export async function handleGetAppealDetail(
  ctx: IOfficialReplyContext,
  params: { appealId: number | string; clientETag?: string; vaultToken?: string }
): Promise<StandardResult<any>> {
  return OfficialReplyController.handleGetAppealDetail(ctx, params);
}
