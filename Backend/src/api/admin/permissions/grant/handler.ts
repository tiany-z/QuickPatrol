/**
 * M18: 棋盘单元格批量授权端点业务逻辑
 * POST /api/admin/permissions/grant
 */

import { PermissionService } from "../../../../services/admin/permissionService.js";
import { IBatchGrantPermissionRequest } from "../../../../services/admin/permissionTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleGrantPermissions(
  ctx: { schoolId: number; role: number },
  body: IBatchGrantPermissionRequest
): Promise<StandardResult<any> & { success?: boolean; code?: number; message?: string }> {
  try {
    if (ctx.role < 4) {
      return {
        success: false,
        status: 0,
        code: 403,
        content: "越权阻断: 仅限学校管理员 (role >= 4) 执行业务权限网格化指派",
        message: "越权阻断: 仅限学校管理员 (role >= 4) 执行业务权限网格化指派"
      };
    }

    if (!body || !body.targetId || !body.gridPoints || body.gridPoints.length === 0) {
      return {
        success: false,
        status: 0,
        code: 400,
        content: "参数缺失: 必须指定被授权对象 (targetId) 与目标坐标点 (gridPoints)",
        message: "参数缺失: 必须指定被授权对象 (targetId) 与目标坐标点 (gridPoints)"
      };
    }

    const result = await PermissionService.batchGrantPermissions(ctx.schoolId, body);
    return {
      success: true,
      status: 1,
      code: 200,
      data: result,
      content: "success",
      message: "success"
    };
  } catch (err: any) {
    return {
      success: false,
      status: 0,
      code: 500,
      content: `网格授权失败: ${err.message}`,
      message: `网格授权失败: ${err.message}`
    };
  }
}
