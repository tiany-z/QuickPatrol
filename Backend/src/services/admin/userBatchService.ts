/**
 * M19: 移动端多租户用户批量调度中枢服务 (User Batch Domain Service)
 * 
 * 核心职责：
 * 1. 批量调部门 (SET_DEPARTMENT)、批量改角色 (SET_ROLE)、批量封禁/解封 (BAN_USERS / UNBAN_USERS)
 * 2. 50 人硬限额与自适应事务切片分批 (Adaptive Chunking)
 * 3. 垂直越权与防自我反噬双重防御屏障
 * 4. 融合 M17 FlowLock 的安全剪枝分批 (resilient 容错模式 vs strict 严格模式)
 * 5. 全字段增量不可篡改审计日志流水 (`operation_logs`)
 */

import { executeASTSelect, executeASTUpdate } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { pruneBlockedUsers } from "./batchPruner.js";
import {
  IBatchUpdateResultDto,
  IBatchUpdateUsersRequest,
  IBlockedUserDetailDto
} from "./batchTypes.js";
import { WeChatAuthService } from "../auth/wechatAuthService.js";
import { TerminalLogger } from "../../shared/index.js";

export class UserBatchService {
  /**
   * 批量更新人员属性 (集成 Flow Lock 智能剪枝与不可篡改审计日志)
   */
  public static async executeBatchUpdate(
    schoolId: number,
    operatorUserId: number,
    operatorIp: string,
    req: IBatchUpdateUsersRequest,
    operatorRole?: number
  ): Promise<IBatchUpdateResultDto> {
    const { targetUserIds, actionType, mode = "resilient", reason = "" } = req;

    if (!targetUserIds || targetUserIds.length === 0) {
      throw new Error("必须指定至少一个被操作人员");
    }

    if (targetUserIds.length > 50) {
      throw new Error("单次批量操作人员数量不得超过 50 人");
    }

    // 防自我反噬保护
    if (actionType === "BAN_USERS" && targetUserIds.includes(operatorUserId)) {
      throw new Error("安全拦截: 严禁将自己的账号纳入批量封禁名单！");
    }

    // 1. 读取前置旧快照
    let oldUsers: any[] = [];

    if (getMySQLPool()) {
      const inClause = targetUserIds.join(",");
      const queryOldSql = `
        SELECT id, realName, nickName, departmentId, role, isBan 
        FROM users 
        WHERE schoolId = ? AND id IN (${inClause}) AND isDeleted = 0
      `;
      oldUsers = await executeASTSelect(queryOldSql, [schoolId]);
    } else {
      // 内存沙箱提取
      const mockUsersMap = WeChatAuthService.getMockUsersMap();
      for (const uid of targetUserIds) {
        const u = mockUsersMap.get(uid);
        if (u && u.schoolId === schoolId && u.isDeleted === 0) {
          oldUsers.push({
            id: u.id,
            realName: u.realName,
            nickName: u.nickName,
            departmentId: u.departmentId,
            role: u.role,
            isBan: u.isBan
          });
        }
      }
    }

    if (!oldUsers || oldUsers.length === 0) {
      throw new Error("未找到指定的有效用户记录");
    }

    // 垂直法定角色越权防护 (No-Upward-Modification)
    if (operatorRole !== undefined && operatorRole < 9) {
      for (const u of oldUsers) {
        if (Number(u.role) >= operatorRole) {
          throw new Error("垂直越权拦截: 严禁修改平级或上级人员的属性！");
        }
      }
    }

    // 2. 若涉及封禁，前置调用 Flow Lock 探针剪枝
    let safeUserIds = [...targetUserIds];
    const blockedDetails: IBlockedUserDetailDto[] = [];

    if (actionType === "BAN_USERS") {
      const pruneRes = await pruneBlockedUsers(schoolId, targetUserIds);
      safeUserIds = pruneRes.safeUserIds;

      for (const [blockedUid, count] of pruneRes.blockedUserMap.entries()) {
        const u = oldUsers.find((o) => o.id === blockedUid);
        blockedDetails.push({
          userId: blockedUid,
          userName: u ? (u.realName || u.nickName) : `用户_${blockedUid}`,
          activeWorkOrderCount: count,
          reason: `该员工名下尚有 ${count} 张在办巡查工单`
        });
      }

      if (mode === "strict" && blockedDetails.length > 0) {
        throw new Error(
          `严格模式阻断: 列表中有 ${blockedDetails.length} 名人员存在在办工单，操作已全量回滚`
        );
      }
    }

    if (safeUserIds.length === 0) {
      return {
        totalRequested: targetUserIds.length,
        successCount: 0,
        blockedCount: blockedDetails.length,
        affectedUserIds: [],
        blockedUsers: blockedDetails,
        auditLogId: 0
      };
    }

    // 3. 构建待更新字段
    const updateFields: Record<string, any> = {};
    if (actionType === "SET_DEPARTMENT") {
      if (req.departmentId === undefined) throw new Error("缺少目标 departmentId");
      updateFields.departmentId = req.departmentId;
    } else if (actionType === "SET_ROLE") {
      if (req.role === undefined) throw new Error("缺少目标 role");
      updateFields.role = req.role;
    } else if (actionType === "BAN_USERS") {
      updateFields.isBan = 1;
    } else if (actionType === "UNBAN_USERS") {
      updateFields.isBan = 0;
    }

    // 4. 执行更新
    if (getMySQLPool()) {
      const CHUNK_SIZE = 20;
      for (let i = 0; i < safeUserIds.length; i += CHUNK_SIZE) {
        const chunkIds = safeUserIds.slice(i, i + CHUNK_SIZE);
        const setClauses = Object.keys(updateFields).map((f) => `\`${f}\` = ?`).join(", ");
        const setValues = Object.values(updateFields);
        const inPlaceholders = chunkIds.map(() => "?").join(",");

        const updateSql = `
          UPDATE users 
          SET ${setClauses}, updatedAt = NOW() 
          WHERE schoolId = ? AND id IN (${inPlaceholders}) AND isDeleted = 0
        `;
        await executeASTUpdate(updateSql, [...setValues, schoolId, ...chunkIds]);
      }
    } else {
      // 内存沙箱逐个应用变更
      for (const uid of safeUserIds) {
        WeChatAuthService.updateMockUser(uid, updateFields);
      }
    }

    // 5. 写入不可篡改审计日志
    const auditLogId = await AuditLogger.recordLog({
      schoolId,
      operatorUserId,
      action: `BATCH_${actionType}`,
      module: "User",
      ip: operatorIp,
      payload: {
        affectedCount: safeUserIds.length,
        affectedUserIds: safeUserIds,
        changes: updateFields,
        reason,
        blockedCount: blockedDetails.length,
        blockedList: blockedDetails
      }
    });

    TerminalLogger.info(
      `[M19 批量调度] 管理员 ${operatorUserId} 成功批量执行 ${actionType} (受影响: ${safeUserIds.length}, 拦截: ${blockedDetails.length})`,
      "BatchOps"
    );

    return {
      totalRequested: targetUserIds.length,
      successCount: safeUserIds.length,
      blockedCount: blockedDetails.length,
      affectedUserIds: safeUserIds,
      blockedUsers: blockedDetails,
      auditLogId
    };
  }
}
