/**
 * M19: 安全审计日志查询端点处理器 (只读安全端点)
 * GET /api/admin/audit-logs
 */

import { AuditLogger } from "../../../shared/log/auditLogger.js";
import { returnSuccess, returnError, StandardResult } from "../../../shared/flow/result.js";

export async function handleQueryAuditLogs(
  ctx: { schoolId: number; role: number },
  query: { module?: string; action?: string; operatorUserId?: string | number; page?: string | number; pageSize?: string | number }
): Promise<StandardResult<any>> {
  try {
    if (ctx.role < 4) {
      return returnError("权限不足: 仅限学校管理员及以上角色查看全校安全审计日志");
    }

    const page = parseInt(String(query.page || "1"), 10);
    const pageSize = parseInt(String(query.pageSize || "20"), 10);
    const operatorUserId = query.operatorUserId ? parseInt(String(query.operatorUserId), 10) : undefined;

    const result = await AuditLogger.queryLogs(ctx.schoolId, {
      module: query.module,
      action: query.action,
      operatorUserId,
      page: isNaN(page) ? 1 : page,
      pageSize: isNaN(pageSize) ? 20 : pageSize
    });

    return returnSuccess(result);
  } catch (err: any) {
    return returnError(`查询审计日志失败: ${err.message}`);
  }
}
