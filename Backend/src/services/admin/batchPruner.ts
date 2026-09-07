/**
 * M19: 基于 Flow Lock 探针的批量安全预检剪枝算法
 * (Batch Safety Pre-Check Pruning Engine)
 * 
 * 核心设计：
 * 批量处理包含封禁或角色重置时，前置探针扫描所有候选人员名下在办工单 (status IN 0, 1, 2)
 * 将存在在办工单的被阻断人员与无单安全人员精准剥离，实现智能剪枝容错
 */

import { executeASTSelect } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { WorklistAggregator } from "../org/worklistAggregator.js";

export interface IPruneResult {
  safeUserIds: number[];
  blockedUserMap: Map<number, number>; // userId -> activeCount
}

export async function pruneBlockedUsers(
  schoolId: number,
  candidateUserIds: number[]
): Promise<IPruneResult> {
  if (!candidateUserIds || candidateUserIds.length === 0) {
    return { safeUserIds: [], blockedUserMap: new Map() };
  }

  const blockedMap = new Map<number, number>();

  if (getMySQLPool()) {
    const inClause = candidateUserIds.join(",");
    const sql = `
      SELECT currentHandlerId, currentReviewerId, COUNT(1) AS activeCount
      FROM patrols
      WHERE schoolId = ? 
        AND isDeleted = 0 
        AND status IN (0, 1, 2)
        AND (currentHandlerId IN (${inClause}) OR currentReviewerId IN (${inClause}))
      GROUP BY currentHandlerId, currentReviewerId
    `;

    const rows: any = await executeASTSelect(sql, [schoolId]);

    for (const r of rows) {
      const activeCount = Number(r.activeCount || 1);
      if (r.currentHandlerId && candidateUserIds.includes(r.currentHandlerId)) {
        const prev = blockedMap.get(r.currentHandlerId) || 0;
        blockedMap.set(r.currentHandlerId, prev + activeCount);
      }
      if (r.currentReviewerId && candidateUserIds.includes(r.currentReviewerId)) {
        const prev = blockedMap.get(r.currentReviewerId) || 0;
        blockedMap.set(r.currentReviewerId, prev + activeCount);
      }
    }
  } else {
    // 内存测试沙箱探测
    const mockPatrols = WorklistAggregator.getMockPatrolsMap();
    const candidateSet = new Set(candidateUserIds);

    for (const p of mockPatrols.values()) {
      if (
        p.schoolId === schoolId &&
        p.isDeleted === 0 &&
        (p.status === 0 || p.status === 1 || p.status === 2)
      ) {
        if (p.currentHandlerId && candidateSet.has(p.currentHandlerId)) {
          const prev = blockedMap.get(p.currentHandlerId) || 0;
          blockedMap.set(p.currentHandlerId, prev + 1);
        }
        if (p.currentReviewerId && candidateSet.has(p.currentReviewerId)) {
          const prev = blockedMap.get(p.currentReviewerId) || 0;
          blockedMap.set(p.currentReviewerId, prev + 1);
        }
      }
    }
  }

  const safeUserIds = candidateUserIds.filter((id) => !blockedMap.has(id));
  return { safeUserIds, blockedUserMap: blockedMap };
}
