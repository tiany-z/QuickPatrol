/**
 * M16: 创建岗位职能标签处理函数
 * POST /api/org/tags/create
 */

import { TagService } from "../../../../services/org/tagService.js";
import { ICreateTagDto } from "../../../../services/org/tagTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../../../shared/flow/result.js";

export async function handleCreateTag(
  ctx: { schoolId: number; role: number },
  body: ICreateTagDto
): Promise<StandardResult<any>> {
  try {
    // 权限校验：仅限科室主管或校管 (role >= 3)
    if (ctx.role < 3) {
      return returnError("权限不足: 仅限主管或管理员维护岗位标签");
    }

    if (!body || !body.name || body.name.trim() === "") {
      return returnError("缺少参数: 标签名称不能为空");
    }

    const tag = await TagService.createTag(ctx.schoolId, body);
    return returnSuccess(tag);
  } catch (err: any) {
    return returnError(`创建岗位标签失败: ${err.message}`);
  }
}
