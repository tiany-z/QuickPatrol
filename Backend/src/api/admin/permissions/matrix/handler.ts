/**
 * M18: 获取全校四维权限棋盘网格端点处理器
 * GET /api/admin/permissions/matrix
 */

import { PermissionService } from "../../../../services/admin/permissionService.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleGetPermissionMatrix(
  ctx: { schoolId: number; role: number }
): Promise<StandardResult<any> & { success?: boolean; code?: number; message?: string }> {
  try {
    // 权限校验：仅限科室主管或学校管理员 (role >= 3)
    if (ctx.role < 3) {
      return {
        success: false,
        status: 0,
        code: 403,
        content: "权限不足: 仅限管理人员 (role >= 3) 查看权限调度大盘",
        message: "权限不足: 仅限管理人员 (role >= 3) 查看权限调度大盘"
      } as any;
    }

    const matrix = await PermissionService.getPermissionGridMatrix(ctx.schoolId);
    return {
      success: true,
      status: 1,
      code: 200,
      data: matrix,
      content: "success",
      message: "success"
    };
  } catch (err: any) {
    return {
      success: false,
      status: 0,
      code: 500,
      content: `获取权限棋盘大盘失败: ${err.message}`,
      message: `获取权限棋盘大盘失败: ${err.message}`
    };
  }
}
