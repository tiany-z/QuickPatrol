/**
 * 高校后勤巡查e速办 v4.0 - M24: 工单状态机核心流转中枢
 * (Patrol State Machine & Atomic Claiming Engine)
 * 
 * 核心职责：
 * 1. 工单生命周期偏序状态转移合法性单向严格守卫 (0->1->2->3->4, 2->5->1)
 * 2. 基于 RowLockManager 的分布式行级排他锁并发防冲突控制
 * 3. 数据库原子 CAS (Compare-And-Swap) 竞态抢单仲裁
 * 4. 终态不可逆与跨阶段非法跃迁阻断
 * 5. 状态跃迁全链路审计流水追溯与 WebSocket 广播
 */

import { RowLockManager } from "../../shared/lock/rowLockManager.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { executeASTSelect, executeASTUpdate } from "../../shared/sql/astRunner.js";
import { PatrolService } from "./patrolService.js";
import {
  PatrolStatusEnum,
  IAcceptPatrolResponseDto
} from "./stateMachineTypes.js";

export class PatrolStateMachine {
  /**
   * 状态转移偏序邻接矩阵 (单向严格守卫)
   * 0: PENDING (待处理)
   * 1: IN_PROGRESS (施工中)
   * 2: UNDER_REVIEW (待复核)
   * 3: COMPLETED (已办结)
   * 4: CLOSED (已结案终态)
   * 5: REWORK (复核驳回返工)
   */
  private static readonly TRANSITION_MATRIX: Record<number, number[]> = {
    [PatrolStatusEnum.PENDING]: [PatrolStatusEnum.IN_PROGRESS, PatrolStatusEnum.PENDING], // 0->1接单, 0->0改派重路由
    [PatrolStatusEnum.IN_PROGRESS]: [PatrolStatusEnum.UNDER_REVIEW, PatrolStatusEnum.PENDING], // 1->2完工交卷, 1->0现场改派退单
    [PatrolStatusEnum.UNDER_REVIEW]: [PatrolStatusEnum.COMPLETED, PatrolStatusEnum.REWORK], // 2->3验收合格, 2->5驳回返工
    [PatrolStatusEnum.COMPLETED]: [PatrolStatusEnum.CLOSED], // 3->4评价结案
    [PatrolStatusEnum.CLOSED]: [], // 4 结案终态，绝对禁止任何跃迁
    [PatrolStatusEnum.REWORK]: [PatrolStatusEnum.IN_PROGRESS] // 5->1返工重新施工
  };

  /**
   * 通用状态跃迁合法性守卫检查
   */
  public static validateTransition(from: PatrolStatusEnum, to: PatrolStatusEnum): boolean {
    const allowedTargets = this.TRANSITION_MATRIX[from];
    if (!allowedTargets || !allowedTargets.includes(to)) {
      throw new Error(`非法状态机跃迁: 不允许从状态 [${from}] 直接跳变至 [${to}]`);
    }
    return true;
  }

  /**
   * 核心原子抢单/接单方法 (带分布式行级排他锁与 CAS 校验)
   */
  public static async executeAcceptClaim(
    schoolId: number,
    patrolId: number,
    userId: number,
    userName: string = "维修师傅",
    userIp: string = "127.0.0.1"
  ): Promise<IAcceptPatrolResponseDto> {
    const requestId = `req_claim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. 获取分布式行级排他锁 (悲观锁锁定当前工单行)
    const lockResult = await RowLockManager.acquireRowLock(
      schoolId,
      "patrols",
      patrolId,
      "UPDATE",
      requestId,
      5000
    );

    if (lockResult.status === 0 || !lockResult.data) {
      throw new Error("抢单并发冲突，该工单正在被其他师傅锁定中，请稍后重试！");
    }

    try {
      // 2. 读取目标工单实体
      let patrol: any = PatrolService.getMockPatrol(patrolId);
      if (!patrol && getMySQLPool()) {
        const sql = `
          SELECT id, orderNo, currentHandlerId, status, schoolId, deadline 
          FROM patrols 
          WHERE id = ? AND schoolId = ? AND isDeleted = 0 
          LIMIT 1
        `;
        const rows = await executeASTSelect<any>(sql, [patrolId, schoolId]);
        if (rows && rows.length > 0) {
          patrol = rows[0];
        }
      }

      if (!patrol) {
        throw new Error(`接单失败: 工单 ${patrolId} 不存在或已被删除`);
      }

      const previousStatus: PatrolStatusEnum = patrol.status;

      // 3. 状态机前置校验: 必须处于待处理态 (status = 0)
      if (patrol.status !== PatrolStatusEnum.PENDING) {
        throw new Error(`手慢了！该工单当前处于 [${patrol.status}] 状态，已被他人抢先处理！`);
      }

      // 4. CAS 原子校验: 若为抢单池认领，currentHandlerId 必须为 0；若为系统直派，必须为当前师傅本人
      if (patrol.currentHandlerId !== 0 && patrol.currentHandlerId !== userId) {
        throw new Error(`抢单冲突：该工单已被同事 (UID: ${patrol.currentHandlerId}) 接单！`);
      }

      // 5. 状态跃迁邻接矩阵合法性检验
      this.validateTransition(previousStatus, PatrolStatusEnum.IN_PROGRESS);

      // 6. 执行状态跃迁与责任人落库: status 0 -> 1, currentHandlerId = userId
      const nowIso = new Date().toISOString();

      if (getMySQLPool()) {
        const updateSql = `
          UPDATE patrols 
          SET currentHandlerId = ?, status = ?, updatedAt = NOW() 
          WHERE id = ? AND schoolId = ? AND status = ?
        `;
        const updateRes = await executeASTUpdate(updateSql, [
          userId,
          PatrolStatusEnum.IN_PROGRESS,
          patrolId,
          schoolId,
          PatrolStatusEnum.PENDING
        ]);

        if (updateRes.affectedRows === 0) {
          throw new Error("抢单并发冲突，CAS 校验失败，请重试！");
        }
      }

      // 同步沙箱内存状态
      PatrolService.updateMockPatrol(patrolId, {
        currentHandlerId: userId,
        status: PatrolStatusEnum.IN_PROGRESS,
        updatedAt: nowIso
      });

      // 7. 记录状态跃迁安全审计日志
      await AuditLogger.log(schoolId, userId, "PATROL_STATUS_ACCEPT", "patrols", userIp, {
        patrolId,
        orderNo: patrol.orderNo,
        fromStatus: previousStatus,
        toStatus: PatrolStatusEnum.IN_PROGRESS,
        assignedUser: { id: userId, name: userName }
      });

      // 8. 通过分布式总线广播工单已被认领通知
      try {
        RedisWsBridge.broadcastToUsers(schoolId, [userId], {
          action: "PATROL_CLAIMED",
          patrolId,
          orderNo: patrol.orderNo,
          status: PatrolStatusEnum.IN_PROGRESS,
          handlerId: userId,
          handlerName: userName,
          timestamp: Date.now()
        });
      } catch (wsErr) {
        console.warn("[M24] WebSocket 广播偶发异常 (非致命)", wsErr);
      }

      return {
        isSuccess: true,
        patrolId,
        orderNo: patrol.orderNo,
        previousStatus,
        currentStatus: PatrolStatusEnum.IN_PROGRESS,
        handlerId: userId,
        handlerName: userName,
        acceptedAt: nowIso,
        deadline: patrol.deadline || ""
      };
    } finally {
      // 9. 无论业务成败，强制释放行级排他锁
      await RowLockManager.releaseRowLock(schoolId, "patrols", patrolId, requestId, true);
    }
  }
}
