/**
 * M23: 智能网格派单与路由决策引擎
 * (Grid Dispatch & Auto-Routing Engine)
 * 
 * 核心设计与工业级特性：
 * 1. 四维权限张量最特异加权优选算法 (Specificity-First Scorer: Level 3 ~ Level 0)
 * 2. 随岗不随人：职能标签直通穿透与公共抢单池广播 (Task Pool Broadcast)
 * 3. 责任人实时在办负荷自适应均衡轮转调度 (Least-Loaded Balancer)
 * 4. 防漏单自愈熔断机制 (Orphan Fallback Circuit，直派校级一把手 + 红色审计)
 * 5. 全分布式 Redis Pub/Sub 与 M06 WebSocket 网关跨节点秒级声光震动广播
 * 6. 双轨环境自适应 (MySQL AST 与内存沙箱自愈)
 */

import { executeASTSelect, executeASTUpdate } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { TagService } from "../../services/org/tagService.js";
import { PermissionService } from "../../services/admin/permissionService.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "./patrolService.js";
import {
  IDispatchDecisionResult,
  IHandlerWorkloadSnapshot
} from "./dispatchTypes.js";

export class DispatchEngine {
  /**
   * 核心派单执行主入口
   * 输入工单特征向量 (schoolId, patrolId, campusId, categoryId)，输出最优派单决策
   */
  /**
   * 结构化参数调用入口
   */
  public static async dispatchWorkOrder(params: {
    schoolId: number;
    patrolId: number;
    campusId: number;
    categoryId: number;
    options?: { forceLeastLoaded?: boolean };
  }): Promise<IDispatchDecisionResult> {
    return this.executeDispatch(
      params.schoolId,
      params.patrolId,
      params.campusId,
      params.categoryId,
      params.options
    );
  }

  public static async executeDispatch(
    schoolId: number,
    patrolId: number,
    campusId: number,
    categoryId: number,
    options?: { forceLeastLoaded?: boolean }
  ): Promise<IDispatchDecisionResult> {
    // 1. 查询工单基础信息 (优先内存沙箱 -> 数据库)
    let patrol: any = PatrolService.getMockPatrol(patrolId);
    if (!patrol && getMySQLPool()) {
      const sql = `SELECT id, orderNo, title, priorityLevel, deadline, location1, location2 FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`;
      const rows = await executeASTSelect<any>(sql, [patrolId, schoolId]);
      if (rows && rows.length > 0) {
        patrol = rows[0];
      }
    }

    if (!patrol) {
      throw new Error(`派单失败: 工单 ${patrolId} 不存在`);
    }

    // 2. 检索四维权限矩阵并执行特异性加权得分仲裁 (Specificity Scorer)
    // 得分: (campusId = c ? 2 : 0) + (categoryId = k ? 1 : 0) -> [0..3]
    const matchedRule = await this.resolveSpecificityRule(schoolId, campusId, categoryId);

    // 3. 情况 A: 命中有效派单规则
    if (matchedRule) {
      const score = matchedRule.specificityScore as 0 | 1 | 2 | 3;

      // 3.1 命中个人直派模式 (userId > 0)
      if (matchedRule.userId && matchedRule.userId > 0) {
        const targetUser = await this.verifyUserAvailability(schoolId, matchedRule.userId);
        if (targetUser) {
          return await this.assignDirectUser(schoolId, patrol, targetUser, score, false);
        }
      }

      // 3.2 命中职能岗位标签模式 (tagId > 0)
      if (matchedRule.tagId && matchedRule.tagId > 0) {
        return await this.dispatchByTag(
          schoolId,
          patrol,
          matchedRule.tagId,
          matchedRule.tagName || "维修专班",
          score,
          options?.forceLeastLoaded ?? false
        );
      }
    }

    // 4. 情况 B: 规则缺失，触发防漏单安全熔断自愈 (Orphan Fallback Circuit)
    return await this.handleOrphanFallback(schoolId, patrol, "四维权限矩阵中无任何可用匹配规则");
  }

  /**
   * 检索特异性最优规则 (支持 MySQL AST 排序与内存沙箱探针)
   */
  private static async resolveSpecificityRule(
    schoolId: number,
    campusId: number,
    categoryId: number
  ): Promise<{ ruleId: number; userId: number; tagId: number | null; specificityScore: number; tagName?: string } | null> {
    if (getMySQLPool()) {
      const matchSql = `
        SELECT 
          p.id AS ruleId, p.userId, p.tagId, p.campusId, p.categoryId,
          ( (p.campusId = ?)*2 + (p.categoryId = ?)*1 ) AS specificityScore,
          t.name AS tagName
        FROM permissions p
        LEFT JOIN tags t ON t.id = p.tagId AND t.schoolId = p.schoolId
        WHERE p.schoolId = ?
          AND (p.campusId = ? OR p.campusId = 0)
          AND (p.categoryId = ? OR p.categoryId = 0)
          AND p.type = 1
        ORDER BY specificityScore DESC, p.id DESC
        LIMIT 1
      `;
      const rows: any = await executeASTSelect(matchSql, [
        campusId, categoryId,
        schoolId,
        campusId, categoryId
      ]);
      if (rows && rows.length > 0) {
        return {
          ruleId: rows[0].ruleId,
          userId: Number(rows[0].userId || 0),
          tagId: rows[0].tagId ? Number(rows[0].tagId) : null,
          specificityScore: Number(rows[0].specificityScore || 0),
          tagName: rows[0].tagName
        };
      }
      return null;
    }

    // 内存沙箱计算
    const opt = await PermissionService.resolveOptimalHandler(schoolId, campusId, categoryId, 1);
    if (!opt) return null;

    let specificityScore = 0;
    if (opt.matchType === "EXACT_BOTH") specificityScore = 3;
    else if (opt.matchType === "CAMPUS_ONLY") specificityScore = 2;
    else if (opt.matchType === "CATEGORY_ONLY") specificityScore = 1;

    let tagName = "维修班组";
    if (opt.tagId) {
      const tag = await TagService.getTagById(schoolId, opt.tagId);
      if (tag) tagName = tag.name;
    }

    return {
      ruleId: opt.ruleId,
      userId: opt.userId,
      tagId: opt.tagId,
      specificityScore,
      tagName
    };
  }

  /**
   * 岗位标签分发逻辑：支持抢单池广播模式与负载均衡直派模式
   */
  private static async dispatchByTag(
    schoolId: number,
    patrol: any,
    tagId: number,
    tagName: string,
    ruleScore: 0 | 1 | 2 | 3,
    forceLeastLoaded: boolean
  ): Promise<IDispatchDecisionResult> {
    // 1. 获取该标签名下持证在岗人员列表
    const userIds = await TagService.resolveTagOnDutyUsers(schoolId, tagId);

    // 2. 过滤有效未封禁在岗人员
    const validMembers: any[] = [];
    for (const uid of userIds) {
      const u = await this.verifyUserAvailability(schoolId, uid);
      if (u) {
        validMembers.push(u);
      }
    }

    if (validMembers.length === 0) {
      // 标签下无在岗人员，触发熔断
      return await this.handleOrphanFallback(schoolId, patrol, `职能标签 [${tagName}] 下无任何在岗维修人员`);
    }

    const candidateIds = validMembers.map((m) => m.id);

    // 3. 策略判断：抢单池广播 vs 负荷均衡直派
    if (!forceLeastLoaded) {
      // 3.1 抢单池广播模式 (Pool Broadcast) - 保留 currentHandlerId = 0
      this.updatePatrolHandlerId(schoolId, patrol.id, 0);

      // 下发分布式广播帧
      await RedisWsBridge.broadcastToUsers(schoolId, candidateIds, {
        event: "WORK_ORDER_DISPATCHED",
        schoolId,
        patrolId: patrol.id,
        orderNo: patrol.orderNo,
        title: patrol.title,
        campusName: "当前校区",
        location: `${patrol.location1 || ""} ${patrol.location2 || ""}`.trim(),
        categoryName: tagName,
        priorityLevel: patrol.priorityLevel ?? 1,
        deadline: patrol.deadline || "",
        dispatchType: "POOL_BROADCAST",
        vibratePattern: patrol.priorityLevel === 2 ? "heavy" : "medium",
        soundAlert: true
      });

      // 记录审计留痕
      await AuditLogger.log(schoolId, 0, "DISPATCH_BROADCAST_POOL", "Patrol", "127.0.0.1", {
        patrolId: patrol.id,
        tagId,
        tagName,
        candidateCount: candidateIds.length
      });

      return {
        patrolId: patrol.id,
        orderNo: patrol.orderNo,
        dispatchMode: "TAG_POOL",
        assignedUserId: 0,
        assignedUserName: `公共抢单池 (${tagName})`,
        targetTagId: tagId,
        targetTagName: tagName,
        matchedRuleLevel: ruleScore,
        candidateUserIds: candidateIds,
        dispatchedAt: new Date().toISOString(),
        isFallback: false
      };
    } else {
      // 3.2 自适应在办负荷均衡直派模式 (Least-Loaded Balancer)
      const optimalUser = await this.selectLeastLoadedUser(schoolId, validMembers);
      return await this.assignDirectUser(schoolId, patrol, optimalUser, ruleScore, false, tagId, tagName);
    }
  }

  /**
   * 负载均衡选择器：选取当前在办未结案工单加权负荷最小的师傅 (算法 2)
   */
  public static async selectLeastLoadedUser(schoolId: number, candidates: any[]): Promise<any> {
    const candidateIds = candidates.map((c) => c.id);
    const loadMap = new Map<number, number>();

    if (getMySQLPool()) {
      const sql = `
        SELECT currentHandlerId,
               SUM(CASE WHEN priorityLevel = 2 THEN 2.0 ELSE 1.0 END) AS weightedLoad
        FROM patrols
        WHERE schoolId = ? AND currentHandlerId IN (${candidateIds.join(",")})
          AND status IN (1, 2) AND isDeleted = 0
        GROUP BY currentHandlerId
      `;
      const rows: any = await executeASTSelect(sql, [schoolId]);
      for (const r of rows) {
        loadMap.set(Number(r.currentHandlerId), Number(r.weightedLoad) || 0);
      }
    } else {
      // 内存沙箱统计
      const mockList = PatrolService.getAllMockPatrols();
      for (const p of mockList) {
        if (
          p.schoolId === schoolId &&
          candidateIds.includes(p.currentHandlerId) &&
          (p.status === 1 || p.status === 2) &&
          p.isDeleted === 0
        ) {
          const w = p.priorityLevel === 2 ? 2.0 : 1.0;
          loadMap.set(p.currentHandlerId, (loadMap.get(p.currentHandlerId) || 0) + w);
        }
      }
    }

    let minLoad = Number.MAX_VALUE;
    let selected = candidates[0];

    for (const c of candidates) {
      const load = loadMap.get(c.id) || 0;
      if (load < minLoad) {
        minLoad = load;
        selected = c;
      }
    }

    return selected;
  }

  /**
   * 直派指定人员并更新状态与推送通知
   */
  public static async assignDirectUser(
    schoolId: number,
    patrol: any,
    targetUser: any,
    score: 0 | 1 | 2 | 3,
    isFallback: boolean,
    tagId?: number,
    tagName?: string
  ): Promise<IDispatchDecisionResult> {
    // 更新工单责任人
    await this.updatePatrolHandlerId(schoolId, patrol.id, targetUser.id);

    // 单播推送至该师傅
    await RedisWsBridge.sendToUser(schoolId, targetUser.id, {
      event: "WORK_ORDER_DISPATCHED",
      schoolId,
      patrolId: patrol.id,
      orderNo: patrol.orderNo,
      title: patrol.title,
      campusName: "当前校区",
      location: `${patrol.location1 || ""} ${patrol.location2 || ""}`.trim(),
      categoryName: tagName || "后勤维保",
      priorityLevel: patrol.priorityLevel ?? 1,
      deadline: patrol.deadline || "",
      dispatchType: "DIRECT",
      vibratePattern: patrol.priorityLevel === 2 ? "heavy" : "medium",
      soundAlert: true
    });

    const action = isFallback ? "DISPATCH_ORPHAN_FALLBACK" : "DISPATCH_DIRECT_ASSIGNED";
    await AuditLogger.log(schoolId, 0, action, "Patrol", "127.0.0.1", {
      patrolId: patrol.id,
      assignedUserId: targetUser.id,
      assignedUserName: targetUser.realName,
      isFallback
    });

    return {
      patrolId: patrol.id,
      orderNo: patrol.orderNo,
      dispatchMode: isFallback ? "ORPHAN_FALLBACK" : "DIRECT_USER",
      assignedUserId: targetUser.id,
      assignedUserName: targetUser.realName,
      targetTagId: tagId,
      targetTagName: tagName,
      matchedRuleLevel: score,
      candidateUserIds: [targetUser.id],
      dispatchedAt: new Date().toISOString(),
      isFallback
    };
  }

  /**
   * 防漏单自愈熔断：保底直派学校超级管理员 (role = 4)
   */
  private static async handleOrphanFallback(
    schoolId: number,
    patrol: any,
    reason: string
  ): Promise<IDispatchDecisionResult> {
    let admin: any = null;

    if (getMySQLPool()) {
      const sql = `SELECT id, realName FROM users WHERE schoolId = ? AND role = 4 AND isBan = 0 AND isDeleted = 0 LIMIT 1`;
      const rows: any = await executeASTSelect(sql, [schoolId]);
      if (rows && rows.length > 0) {
        admin = rows[0];
      }
    }

    if (!admin) {
      // 内存沙箱检索管理员
      for (const u of WeChatAuthService.getMockUsersMap().values()) {
        if (u.schoolId === schoolId && u.role === 4 && (u.isBan || 0) === 0) {
          admin = { id: u.id, realName: u.realName };
          break;
        }
      }
    }

    if (!admin) {
      admin = { id: 888, realName: "后勤总值班调度室" };
    }

    // 写入安全警报流水
    await AuditLogger.log(schoolId, 0, "DISPATCH_ORPHAN_ROUTING_BREACH", "Patrol", "127.0.0.1", {
      patrolId: patrol.id,
      orderNo: patrol.orderNo,
      reason,
      fallbackAdminId: admin.id
    });

    return await this.assignDirectUser(schoolId, patrol, admin, 0, true);
  }

  /**
   * 验证用户在岗与有效性
   */
  private static async verifyUserAvailability(schoolId: number, userId: number): Promise<any | null> {
    if (getMySQLPool()) {
      const sql = `SELECT id, realName, isBan FROM users WHERE id = ? AND schoolId = ? AND isBan = 0 AND isDeleted = 0 LIMIT 1`;
      const rows: any = await executeASTSelect(sql, [userId, schoolId]);
      return (rows && rows.length > 0) ? rows[0] : null;
    }

    const u = WeChatAuthService.getMockUser(userId);
    if (u && u.schoolId === schoolId && (u.isBan || 0) === 0) {
      return { id: u.id, realName: u.realName, isBan: 0 };
    }
    return null;
  }

  /**
   * 更新工单当前责任人
   */
  private static async updatePatrolHandlerId(schoolId: number, patrolId: number, handlerId: number): Promise<void> {
    PatrolService.updateMockPatrol(patrolId, { currentHandlerId: handlerId });

    if (getMySQLPool()) {
      const sql = `UPDATE patrols SET currentHandlerId = ?, updatedAt = NOW() WHERE id = ? AND schoolId = ?`;
      await executeASTUpdate(sql, [handlerId, patrolId, schoolId]);
    }
  }
}
