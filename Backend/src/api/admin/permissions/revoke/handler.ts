/**
 * M18: 收回网格单项授权端点业务逻辑
 * POST /api/admin/permissions/revoke
 */

import { PermissionService } from "../../../../services/admin/permissionService.js";
import { IRevokePermissionRequest } from "../../../../services/admin/permissionTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleRevokePermission(
  ctx: { schoolId: number; role: number },
  body: IRevokePermissionRequest
): Promise<StandardResult<any> & { success?: boolean; code?: number; message?: string }> {
  try {
    if (ctx.role < 4) {
      return {
        success: false,
        status: 0,
        code: 403,
        content: "越权阻断: 仅限学校管理员 (role >= 4) 收回权限",
        message: "越权阻断: 仅限学校管理员 (role >= 4) 收回权限"
      };
    }

    if (!body || !body.ruleId) {
      return {
        success: false,
        status: 0,
        code: 400,
        content: "参数缺失: 必须指定待收回的授权规则 ID (ruleId)",
        message: "参数缺失: 必须指定待收回的授权规则 ID (ruleId)"
      };
    }

    const ok = await PermissionService.revokePermission(ctx.schoolId, body.ruleId);
    return {
      success: ok,
      status: ok ? 1 : 0,
      code: ok ? 200 : 404,
      data: { success: ok, ruleId: body.ruleId },
      content: ok ? "success" : "未找到指定的权限规则或已被收回",
      message: ok ? "success" : "未找到指定的权限规则或已被收回"
    };
  } catch (err: any) {
    return {
      success: false,
      status: 0,
      code: 500,
      content: `权限收回失败: ${err.message}`,
      message: `权限收回失败: ${err.message}`
    };
  }
}
