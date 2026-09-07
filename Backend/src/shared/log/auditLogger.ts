/**
 * M19: 多租户不可篡改运维审计日志中枢 (Audit Logger Substrate)
 * 
 * 核心设计哲学：
 * 1. 只增不减 (Append-Only)：严禁提供任何修改或物理删除能力
 * 2. 差异快照 (Diff Snapshot)：精细化记录变更字段前置/后置差分
 * 3. 双轨驱动：生产环境直连 MySQL AST 驱动，离线/测试环境内存沙箱自愈
 */

import { executeASTInsert, executeASTSelect } from "../sql/index.js";
import { getMySQLPool } from "../db/mysql.js";
import { TerminalLogger } from "../index.js";
import { IAuditLogItemDto, IAuditLogQueryDto, IOperationLogEntity } from "../../services/admin/batchTypes.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";

export interface IRecordLogParam {
  schoolId: number;
  operatorUserId: number;
  action: string;
  module: "User" | "Department" | "Tag" | "Permission" | "Patrol" | "AI";
  ip?: string;
  payload: any;
}

// 内存测试沙箱审计日志桩点字典
const mockOperationLogsMap = new Map<number, IOperationLogEntity>();
let mockLogIdCounter = 1;

export class AuditLogger {
  /**
   * 清空测试沙箱审计日志
   */
  public static clearMockLogs(): void {
    mockOperationLogsMap.clear();
    mockLogIdCounter = 1;
  }

  /**
   * 获取测试沙箱审计日志全量快照
   */
  public static getMockLogsMap(): Map<number, IOperationLogEntity> {
    return mockOperationLogsMap;
  }

  /**
   * 获取测试沙箱审计日志全量列表
   */
  public static getMockLogs(): IOperationLogEntity[] {
    return Array.from(mockOperationLogsMap.values());
  }

  /**
   * 记录审计日志 (兼容式快捷入口)
   */
  public static async log(
    schoolId: number,
    operatorUserId: number,
    action: string,
    module: "User" | "Department" | "Tag" | "Permission" | "Patrol" | "AI" | string,
    ip?: string,
    payload?: any
  ): Promise<number> {
    return this.recordLog({
      schoolId,
      operatorUserId,
      action,
      module: (module as any) || "Patrol",
      ip,
      payload
    });
  }

  /**
   * 记录审计日志 (单向追加，不可篡改)
   */
  public static async recordLog(param: IRecordLogParam): Promise<number> {
    const payloadStr = JSON.stringify(param.payload || {});
    const clientIp = param.ip || "127.0.0.1";

    const id = mockLogIdCounter++;
    const entity: IOperationLogEntity = {
      id,
      schoolId: param.schoolId,
      userId: param.operatorUserId,
      action: param.action,
      module: param.module,
      ip: clientIp,
      payloadJson: payloadStr,
      createdAt: new Date().toISOString()
    };
    mockOperationLogsMap.set(id, entity);

    if (getMySQLPool()) {
      const insertSql = `
        INSERT INTO operation_logs (schoolId, userId, action, module, ip, payloadJson, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;

      try {
        const res: any = await executeASTInsert(insertSql, [
          param.schoolId,
          param.operatorUserId,
          param.action,
          param.module,
          clientIp,
          payloadStr
        ]);
        const insertId = res?.data?.[0]?.insertId || res?.insertId || id;
        return Number(insertId);
      } catch (err: any) {
        TerminalLogger.error(`[M19 审计日志失败] ${err.message}`, "Audit");
        return id;
      }
    } else {
      return id;
    }
  }

  /**
   * 分页检索多租户安全审计日志 (只读安全端点)
   */
  public static async queryLogs(
    schoolId: number,
    query: IAuditLogQueryDto
  ): Promise<{ total: number; list: IAuditLogItemDto[] }> {
    const { module, action, operatorUserId, page = 1, pageSize = 20 } = query;
    const offset = Math.max(0, (page - 1) * pageSize);

    if (getMySQLPool()) {
      const conditions = ["l.schoolId = ?"];
      const params: any[] = [schoolId];

      if (module) {
        conditions.push("l.module = ?");
        params.push(module);
      }
      if (action) {
        conditions.push("l.action = ?");
        params.push(action);
      }
      if (operatorUserId) {
        conditions.push("l.userId = ?");
        params.push(operatorUserId);
      }

      const whereClause = conditions.join(" AND ");

      const countSql = `SELECT COUNT(1) AS total FROM operation_logs l WHERE ${whereClause}`;
      const countRes: any = await executeASTSelect(countSql, params);
      const total = countRes[0]?.total || 0;

      const sql = `
        SELECT 
          l.id, l.schoolId, l.userId, l.action, l.module, l.ip, l.payloadJson, l.createdAt,
          u.realName AS operatorName, u.phone AS operatorPhone
        FROM operation_logs l
        LEFT JOIN users u ON l.userId = u.id AND l.schoolId = u.schoolId
        WHERE ${whereClause}
        ORDER BY l.createdAt DESC
        LIMIT ? OFFSET ?
      `;

      const listRes: any = await executeASTSelect(sql, [...params, pageSize, offset]);

      const formatted: IAuditLogItemDto[] = listRes.map((item: any) => ({
        logId: item.id,
        schoolId: item.schoolId,
        action: item.action,
        actionDesc: `[${item.module}] 执行了 ${item.action}`,
        module: item.module,
        ip: item.ip,
        operator: {
          userId: item.userId,
          realName: item.operatorName || `用户_${item.userId}`,
          phone: item.operatorPhone || ""
        },
        payload: item.payloadJson ? JSON.parse(item.payloadJson) : {},
        createdAt: item.createdAt
      }));

      return { total, list: formatted };
    } else {
      // 内存沙箱检索与筛选
      let matched: IOperationLogEntity[] = [];
      for (const log of mockOperationLogsMap.values()) {
        if (log.schoolId !== schoolId) continue;
        if (module && log.module !== module) continue;
        if (action && log.action !== action) continue;
        if (operatorUserId && log.userId !== operatorUserId) continue;
        matched.push(log);
      }

      // 按时间倒序排序
      matched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const total = matched.length;
      const sliced = matched.slice(offset, offset + pageSize);

      const list: IAuditLogItemDto[] = sliced.map((item) => {
        const u = WeChatAuthService.getMockUser(item.userId);
        return {
          logId: item.id,
          schoolId: item.schoolId,
          action: item.action,
          actionDesc: `[${item.module}] 执行了 ${item.action}`,
          module: item.module,
          ip: item.ip,
          operator: {
            userId: item.userId,
            realName: u?.realName || `用户_${item.userId}`,
            phone: u?.phone || ""
          },
          payload: item.payloadJson ? JSON.parse(item.payloadJson) : {},
          createdAt: item.createdAt
        };
      });

      return { total, list };
    }
  }
}
