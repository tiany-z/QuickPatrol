/**
 * M17: Flow Lock 多实体在办工单排查中枢引擎
 * (Multi-Entity Active Patrol Probe Engine)
 * 
 * 核心设计准则：
 * 在办工单定义：status IN (0, 1, 2) (待派发、处理中、待复核)
 * 探针全面覆盖施工人、验收人、物化路径全子树部门、岗位职能标签
 */

import { executeASTSelect } from "../sql/index.js";
import { getMySQLPool } from "../db/mysql.js";
import { getRedisClient } from "../cache/redis.js";
import { IActivePatrolProbeResult } from "./flowLockTypes.js";
import { WorklistAggregator } from "../../services/org/worklistAggregator.js";
import { DepartmentService } from "../../services/org/departmentService.js";

export class FlowLockEngine {
  /**
   * 用户维度在办工单探针 (排查施工人或复核人)
   */
  public static async probeUserActivePatrols(
    schoolId: number,
    userId: number,
    sampleLimit: number = 5
  ): Promise<IActivePatrolProbeResult> {
    if (getMySQLPool()) {
      const sql = `
        SELECT id, orderNo, title, status, priority, createdAt
        FROM patrols
        WHERE schoolId = ? 
          AND isDeleted = 0 
          AND status IN (0, 1, 2)
          AND (currentHandlerId = ? OR currentReviewerId = ?)
        ORDER BY priority DESC, id ASC
        LIMIT ?
      `;

      const countSql = `
        SELECT COUNT(1) AS total
        FROM patrols
        WHERE schoolId = ? 
          AND isDeleted = 0 
          AND status IN (0, 1, 2)
          AND (currentHandlerId = ? OR currentReviewerId = ?)
      `;

      const [rows, countRows]: any = await Promise.all([
        executeASTSelect(sql, [schoolId, userId, userId, sampleLimit]),
        executeASTSelect(countSql, [schoolId, userId, userId])
      ]);

      const activeCount = countRows[0]?.total || 0;
      return {
        hasActivePatrols: activeCount > 0,
        activeCount,
        samplePatrols: rows || []
      };
    } else {
      // 内存测试沙箱检索
      const mockPatrols = WorklistAggregator.getMockPatrolsMap();
      const matched: any[] = [];

      for (const p of mockPatrols.values()) {
        if (
          p.schoolId === schoolId &&
          p.isDeleted === 0 &&
          (p.status === 0 || p.status === 1 || p.status === 2) &&
          (p.currentHandlerId === userId || p.currentReviewerId === userId)
        ) {
          matched.push(p);
        }
      }

      matched.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.id - b.id;
      });

      const activeCount = matched.length;
      const samplePatrols = matched.slice(0, sampleLimit).map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        priority: p.priority,
        createdAt: p.createdAt
      }));

      return {
        hasActivePatrols: activeCount > 0,
        activeCount,
        samplePatrols
      };
    }
  }

  /**
   * 部门全子树在办工单探针 (基于物化路径最左前缀穿透扫描)
   */
  public static async probeDepartmentSubtreeActivePatrols(
    schoolId: number,
    departmentId: number,
    sampleLimit: number = 5
  ): Promise<IActivePatrolProbeResult> {
    if (getMySQLPool()) {
      const deptSql = `SELECT path FROM departments WHERE schoolId = ? AND id = ? AND isDeleted = 0 LIMIT 1`;
      const deptRows: any = await executeASTSelect(deptSql, [schoolId, departmentId]);
      if (!deptRows || deptRows.length === 0) {
        return { hasActivePatrols: false, activeCount: 0, samplePatrols: [] };
      }

      const pattern = `${deptRows[0].path}%`;

      const sql = `
        SELECT p.id, p.orderNo, p.title, p.status, p.priority, p.createdAt
        FROM patrols p
        JOIN departments d ON p.departmentId = d.id
        WHERE p.schoolId = ? 
          AND p.isDeleted = 0 
          AND p.status IN (0, 1, 2)
          AND (d.id = ? OR d.path LIKE ?)
        ORDER BY p.priority DESC, p.id ASC
        LIMIT ?
      `;

      const countSql = `
        SELECT COUNT(1) AS total
        FROM patrols p
        JOIN departments d ON p.departmentId = d.id
        WHERE p.schoolId = ? 
          AND p.isDeleted = 0 
          AND p.status IN (0, 1, 2)
          AND (d.id = ? OR d.path LIKE ?)
      `;

      const [rows, countRows]: any = await Promise.all([
        executeASTSelect(sql, [schoolId, departmentId, pattern, sampleLimit]),
        executeASTSelect(countSql, [schoolId, departmentId, pattern])
      ]);

      const activeCount = countRows[0]?.total || 0;
      return {
        hasActivePatrols: activeCount > 0,
        activeCount,
        samplePatrols: rows || []
      };
    } else {
      // 内存测试沙箱检索
      const dept = await DepartmentService.getDepartmentById(schoolId, departmentId);
      if (!dept) {
        return { hasActivePatrols: false, activeCount: 0, samplePatrols: [] };
      }

      const targetPath = dept.path; // 如 "/10/"
      const mockDepts = DepartmentService.getMockDepartmentsMap();
      const subtreeDeptIds = new Set<number>();
      subtreeDeptIds.add(departmentId);

      for (const d of mockDepts.values()) {
        if (
          d.schoolId === schoolId &&
          d.isDeleted === 0 &&
          (d.id === departmentId || (d.path && d.path.startsWith(targetPath)))
        ) {
          subtreeDeptIds.add(d.id);
        }
      }

      const mockPatrols = WorklistAggregator.getMockPatrolsMap();
      const matched: any[] = [];

      for (const p of mockPatrols.values()) {
        if (
          p.schoolId === schoolId &&
          p.isDeleted === 0 &&
          (p.status === 0 || p.status === 1 || p.status === 2) &&
          subtreeDeptIds.has(p.departmentId)
        ) {
          matched.push(p);
        }
      }

      matched.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.id - b.id;
      });

      const activeCount = matched.length;
      const samplePatrols = matched.slice(0, sampleLimit).map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        priority: p.priority,
        createdAt: p.createdAt
      }));

      return {
        hasActivePatrols: activeCount > 0,
        activeCount,
        samplePatrols
      };
    }
  }

  /**
   * 岗位职能标签在办工单探针
   */
  public static async probeTagActivePatrols(
    schoolId: number,
    tagId: number,
    sampleLimit: number = 5
  ): Promise<IActivePatrolProbeResult> {
    if (getMySQLPool()) {
      const sql = `
        SELECT id, orderNo, title, status, priority, createdAt
        FROM patrols
        WHERE schoolId = ? 
          AND isDeleted = 0 
          AND status IN (0, 1, 2)
          AND tagId = ?
        ORDER BY priority DESC, p.id ASC
        LIMIT ?
      `;

      const countSql = `
        SELECT COUNT(1) AS total
        FROM patrols
        WHERE schoolId = ? 
          AND isDeleted = 0 
          AND status IN (0, 1, 2)
          AND tagId = ?
      `;

      const [rows, countRows]: any = await Promise.all([
        executeASTSelect(sql, [schoolId, tagId, sampleLimit]),
        executeASTSelect(countSql, [schoolId, tagId])
      ]);

      const activeCount = countRows[0]?.total || 0;
      return {
        hasActivePatrols: activeCount > 0,
        activeCount,
        samplePatrols: rows || []
      };
    } else {
      // 内存测试沙箱检索
      const mockPatrols = WorklistAggregator.getMockPatrolsMap();
      const matched: any[] = [];

      for (const p of mockPatrols.values()) {
        if (
          p.schoolId === schoolId &&
          p.isDeleted === 0 &&
          (p.status === 0 || p.status === 1 || p.status === 2) &&
          p.tagId === tagId
        ) {
          matched.push(p);
        }
      }

      matched.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.id - b.id;
      });

      const activeCount = matched.length;
      const samplePatrols = matched.slice(0, sampleLimit).map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        priority: p.priority,
        createdAt: p.createdAt
      }));

      return {
        hasActivePatrols: activeCount > 0,
        activeCount,
        samplePatrols
      };
    }
  }
}

/**
 * 基于 Redis 短 TTL 缓存的探针中继包装器
 */
export async function getCachedProbeResult(
  schoolId: number,
  targetType: string,
  targetId: number,
  probeLoader: () => Promise<IActivePatrolProbeResult>
): Promise<IActivePatrolProbeResult> {
  const redis = getRedisClient();
  const cacheKey = `tenant:${schoolId}:flowlock:${targetType}:${targetId}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Redis 异常降级
    }
  }

  const result = await probeLoader();

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 30);
    } catch {
      // 忽略写入异常
    }
  }

  return result;
}
