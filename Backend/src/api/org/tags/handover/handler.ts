/**
 * M16: 岗位职能标签一键无缝交接处理函数
 * POST /api/org/tags/handover
 */

import { TagService } from "../../../../services/org/tagService.js";
import { IHandoverTagRequest } from "../../../../services/org/tagTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleHandoverTag(
  ctx: { schoolId: number; role: number },
  body: IHandoverTagRequest
): Promise<StandardResult<any>> {
  try {
    // 权限校验：仅限学校管理员 (role >= 4) 操作
    if (ctx.role < 4) {
      return returnError("权限不足: 仅限学校管理员执行岗位人员交接");
    }

    if (!body || !body.tagId || !body.fromUserId || !body.toUserId) {
      return returnError("参数缺失: 必须指定 tagId, fromUserId 与 toUserId");
    }

    const result = await TagService.handoverTag(
      ctx.schoolId,
      body.tagId,
      body.fromUserId,
      body.toUserId
    );

    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`岗位交接失败: ${err.message}`);
  }
}
