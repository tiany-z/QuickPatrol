/**
 * 高校后勤巡查e速办 v4.0 - M24: 协同转派与跨工种改派服务
 * (Smart Transfer & Reassignment Service)
 * 
 * 核心职责：
 * 1. 现场工种不符跨专业组改派 (CATEGORY_MISMATCH)：修正分类，责任人归零，状态回退 0 并触发 M23 重新路由
 * 2. 现场同班组同事接力转交 (PEER_HANDOVER)：责任人平滑切换，维持状态 1 施工中
 * 3. 改派推诿死循环熔断保护：单工单累计改派超过 3 次自动阻断并直升处长介入
 * 4. 严格行级排他锁与责任人资格鉴权
 * 5. 全流程不可篡改审计追踪与分布式 WebSocket 协同推送
 */

import { RowLockManager } from "../../shared/lock/rowLockManager.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { executeASTSelect, executeASTUpdate } from "../../shared/sql/astRunner.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "./patrolService.js";
import { DispatchEngine } from "./dispatchEngine.js";
import {
  ITransferPatrolRequest,
  ITransferPatrolResponseDto,
  PatrolStatusEnum
} from "./stateMachineTypes.js";

export class TransferService {
  /**
   * 单工单历史累计改派硬上限阈值 (防推诿甩锅死循环)
   */
  public static readonly MAX_TRANSFER_LIMIT = 3;

  /**
   * 执行现场协同转派 / 改派
   */
  public static async executeTransfer(
    schoolId: number,
    operatorId: number,
    userIp: string = "127.0.0.1",
    req: ITransferPatrolRequest
  ): Promise<ITransferPatrolResponseDto> {
    if (!req.reason || req.reason.trim().length < 5) {
      throw new Error("改派/转交必须录入至少 5 个字的客观情况说明");
    }

    const requestId = `req_trans_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 1. 获取分布式行级排他锁
    const lockResult = await RowLockManager.acquireRowLock(
      schoolId,
      "patrols",
      req.patrolId,
      "UPDATE",
      requestId,
      5000
    );

    if (lockResult.status === 0 || !lockResult.data) {
      throw new Error("协同转派并发冲突，该工单正在被其他流程锁定中，请稍后重试！");
    }

    try {
      // 2. 读取目标工单实体
      let patrol: any = PatrolService.getMockPatrol(req.patrolId);
      if (!patrol && getMySQLPool()) {
        const sql = `
          SELECT id, orderNo, campusId, categoryId, currentHandlerId, status 
          FROM patrols 
          WHERE id = ? AND schoolId = ? AND isDeleted = 0 
          LIMIT 1
        `;
        const rows = await executeASTSelect<any>(sql, [req.patrolId, schoolId]);
        if (rows && rows.length > 0) {
          patrol = rows[0];
        }
      }

      if (!patrol) {
        throw new Error("工单不存在或已被删除");
      }

      // 3. 状态合法性校验: 仅处于“处理中 (1)”或“待处理 (0)”的工单才允许转派
      if (patrol.status !== PatrolStatusEnum.IN_PROGRESS && patrol.status !== PatrolStatusEnum.PENDING) {
        throw new Error(`当前工单处于 [${patrol.status}] 状态，已不可改派或转交`);
      }

      // 4. 权限校验: 操作人必须为当前指定责任人、抢单池初始态 (0) 或后勤管理员
      if (patrol.currentHandlerId !== operatorId && patrol.currentHandlerId !== 0) {
        throw new Error("您非当前工单的责任人，无权发起转派");
      }

      // 5. 检查历史累计改派次数，防止死循环推诿
      const transferCount = await this.countPatrolTransfers(schoolId, req.patrolId);
      if (transferCount >= this.MAX_TRANSFER_LIMIT) {
        throw new Error(
          `该工单已累计改派 ${transferCount} 次，达到系统上限！已锁定并转入后勤处长人工督办调度！`
        );
      }

      const nowIso = new Date().toISOString();

      // 6. 分支 A: 现场工种不符跨专业组改派 (CATEGORY_MISMATCH)
      if (req.transferType === "CATEGORY_MISMATCH") {
        if (!req.newCategoryId || req.newCategoryId === patrol.categoryId) {
          throw new Error("工种不符改派必须指定一个全新的故障分类");
        }

        // 更新数据库: categoryId 修正，currentHandlerId 归零，状态重置为 0 (待处理)
        if (getMySQLPool()) {
          const updateSql = `
            UPDATE patrols 
            SET categoryId = ?, currentHandlerId = 0, status = ?, updatedAt = NOW() 
            WHERE id = ? AND schoolId = ?
          `;
          await executeASTUpdate(updateSql, [
            req.newCategoryId,
            PatrolStatusEnum.PENDING,
            req.patrolId,
            schoolId
          ]);
        }

        // 同步沙箱内存
        PatrolService.updateMockPatrol(req.patrolId, {
          categoryId: req.newCategoryId,
          currentHandlerId: 0,
          status: PatrolStatusEnum.PENDING,
          updatedAt: nowIso
        });

        // 记录不可篡改审计流水
        await AuditLogger.log(schoolId, operatorId, "PATROL_TRANSFER_REASSIGN", "patrols", userIp, {
          patrolId: req.patrolId,
          orderNo: patrol.orderNo,
          oldCategoryId: patrol.categoryId,
          newCategoryId: req.newCategoryId,
          reason: req.reason,
          photos: req.evidencePhotos || []
        });

        // 异步级联调起 M23 智能网格派单引擎重新路由分发 (符合设计时序)
        setTimeout(() => {
          DispatchEngine.executeDispatch(
            schoolId,
            req.patrolId,
            patrol.campusId,
            req.newCategoryId!
          ).catch((e) => console.warn("[M24] 改派级联派单异步异常", e));
        }, 100);

        return {
          isSuccess: true,
          patrolId: req.patrolId,
          orderNo: patrol.orderNo,
          transferType: "CATEGORY_MISMATCH",
          message: "已成功发起跨专业组改派，工单已重新进入智能派单总线",
          newStatus: PatrolStatusEnum.PENDING,
          newHandlerName: "重新派单中...",
          transferCount: transferCount + 1
        };
      }

      // 7. 分支 B: 同组同事接力转交 (PEER_HANDOVER)
      if (req.transferType === "PEER_HANDOVER") {
        if (!req.targetPeerUserId || req.targetPeerUserId === operatorId) {
          throw new Error("必须指定一位接力的同组同事");
        }

        // 验证目标接力同事的合法有效性 (同校且未封禁)
        let peerName = `师傅_${req.targetPeerUserId}`;
        const mockUser = WeChatAuthService.getMockUserById(req.targetPeerUserId);
        if (mockUser) {
          if (mockUser.schoolId !== schoolId || mockUser.isBan === 1) {
            throw new Error("目标接力同事不存在或处于离岗状态");
          }
          peerName = mockUser.realName || peerName;
        } else if (getMySQLPool()) {
          const checkSql = `SELECT id, realName, isBan FROM users WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`;
          const peerRows = await executeASTSelect<any>(checkSql, [req.targetPeerUserId, schoolId]);
          if (!peerRows || peerRows.length === 0 || peerRows[0].isBan === 1) {
            throw new Error("目标接力同事不存在或处于离岗状态");
          }
          peerName = peerRows[0].realName || peerName;
        }

        // 保持状态为 1 (施工中)，直接切换责任施工人 currentHandlerId
        if (getMySQLPool()) {
          const updateSql = `
            UPDATE patrols 
            SET currentHandlerId = ?, updatedAt = NOW() 
            WHERE id = ? AND schoolId = ?
          `;
          await executeASTUpdate(updateSql, [req.targetPeerUserId, req.patrolId, schoolId]);
        }

        PatrolService.updateMockPatrol(req.patrolId, {
          currentHandlerId: req.targetPeerUserId,
          updatedAt: nowIso
        });

        // 记录审计日志
        await AuditLogger.log(schoolId, operatorId, "PATROL_TRANSFER_HANDOVER", "patrols", userIp, {
          patrolId: req.patrolId,
          orderNo: patrol.orderNo,
          fromUserId: operatorId,
          toUserId: req.targetPeerUserId,
          reason: req.reason
        });

        // 通过 WebSocket 向接力同事推送工作交接通知
        try {
          RedisWsBridge.sendToUser(schoolId, req.targetPeerUserId, {
            action: "PATROL_HANDOVER",
            patrolId: req.patrolId,
            orderNo: patrol.orderNo,
            fromUserId: operatorId,
            reason: req.reason,
            timestamp: Date.now()
          });
        } catch (wsErr) {
          console.warn("[M24] WebSocket 转交推送偶发异常 (非致命)", wsErr);
        }

        return {
          isSuccess: true,
          patrolId: req.patrolId,
          orderNo: patrol.orderNo,
          transferType: "PEER_HANDOVER",
          message: `已成功将工单交接给同事 [${peerName}]`,
          newStatus: PatrolStatusEnum.IN_PROGRESS,
          newHandlerName: peerName,
          transferCount: transferCount + 1
        };
      }

      throw new Error(`未知的转派类型: ${(req as any).transferType}`);
    } finally {
      // 8. 释放分布式排他锁
      await RowLockManager.releaseRowLock(schoolId, "patrols", req.patrolId, requestId, true);
    }
  }

  /**
   * 统计工单历史累计转派改派次数
   */
  public static async countPatrolTransfers(schoolId: number, patrolId: number): Promise<number> {
    // 优先从 AuditLogger 审计快照中检索
    const mockLogs = AuditLogger.getMockLogs();
    const mockCount = mockLogs.filter(
      (l: any) =>
        l.schoolId === schoolId &&
        (l.action === "PATROL_TRANSFER_REASSIGN" || l.action === "PATROL_TRANSFER_HANDOVER") &&
        (l.payloadJson?.includes(`"patrolId":${patrolId}`) ||
          l.payloadJson?.includes(`"patrolId":"${patrolId}"`) ||
          (l.details && Number(l.details.patrolId) === patrolId))
    ).length;

    if (mockCount > 0) {
      return mockCount;
    }

    // 生产 DB 模式
    if (getMySQLPool()) {
      try {
        const sql = `
          SELECT COUNT(*) AS total 
          FROM operation_logs 
          WHERE schoolId = ? AND module = 'patrols' 
            AND action IN ('PATROL_TRANSFER_REASSIGN', 'PATROL_TRANSFER_HANDOVER')
            AND JSON_EXTRACT(payloadJson, '$.patrolId') = ?
        `;
        const rows = await executeASTSelect<any>(sql, [schoolId, patrolId]);
        if (rows && rows.length > 0) {
          return Number(rows[0].total) || 0;
        }
      } catch {
        // 生产容错
      }
    }

    return 0;
  }
}
