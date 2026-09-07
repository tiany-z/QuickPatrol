/**
 * 高校后勤巡查e速办 v4.0 - M28: 质检复核到场核验与合格/驳回状态机服务
 * 严格遵照模块架构设计，覆盖 Table 17 patrols_review 物理流转、双轨状态机推进与 M25 聊天室穿透
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RowLockManager } from "../../shared/lock/rowLockManager.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { getRedisClient } from "../../shared/cache/redis.js";
import { PatrolService } from "./patrolService.js";
import { ChatService } from "../chat/chatService.js";
import {
  IPatrolReviewEntity,
  ISubmitPatrolReviewRequestDto,
  ISubmitPatrolReviewResponseDto,
  IPatrolReviewHistoryResponseDto,
  PatrolReviewPassedEnum
} from "./patrolReviewTypes.js";
import {
  assertCanReviewPatrol,
  validateReviewRemark,
  verifyReviewImages,
  IReviewerContext
} from "./reviewUtils.js";

// 测试沙箱内存缓存 Table 17: patrols_review
const mockReviewRecordsMap = new Map<number, IPatrolReviewEntity>();
let mockReviewIdCounter = 6500;

// 记录 7 天自动好评定时器 (内存沙箱模拟)
const mockAutoFeedbackTimers = new Map<number, { scheduledAt: number; schoolId: number }>();

export class PatrolReviewService {
  /**
   * 注册测试沙箱复核记录
   */
  public static mockRegisterReviewRecord(record: Omit<IPatrolReviewEntity, "id">): IPatrolReviewEntity {
    const id = ++mockReviewIdCounter;
    const entity: IPatrolReviewEntity = { id, ...record };
    mockReviewRecordsMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱指定复核记录
   */
  public static getMockReviewRecord(id: number): IPatrolReviewEntity | undefined {
    return mockReviewRecordsMap.get(id);
  }

  /**
   * 获取所有测试沙箱复核记录
   */
  public static getAllMockReviewRecords(): IPatrolReviewEntity[] {
    return Array.from(mockReviewRecordsMap.values());
  }

  /**
   * 获取指定工单的自动评价预定时间戳
   */
  public static getMockAutoFeedbackTimer(patrolId: number): { scheduledAt: number; schoolId: number } | undefined {
    return mockAutoFeedbackTimers.get(patrolId);
  }

  /**
   * 清空测试沙箱全部质检复核数据
   */
  public static clearMockData(): void {
    mockReviewRecordsMap.clear();
    mockReviewIdCounter = 6500;
    mockAutoFeedbackTimers.clear();
  }

  /**
   * 1. 提交质检复核到场核验主方法 (合格办结/驳回返工双轨状态机)
   */
  public static async submitPatrolReview(
    schoolId: number,
    patrolId: number,
    reviewer: IReviewerContext,
    dto: ISubmitPatrolReviewRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<ISubmitPatrolReviewResponseDto> {
    const requestId = `req_review_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1.1 申请工单行级排他锁 (防并发复核竞争)
    const lockRes = await RowLockManager.acquireRowLock(
      schoolId,
      "patrols",
      patrolId,
      "UPDATE",
      requestId,
      3000
    );

    if (lockRes.status === 0 || !lockRes.data) {
      throw new Error("CONCURRENT_LOCK_BUSY: 系统繁忙，正在处理当前工单，请稍后重试");
    }

    try {
      // 1.2 前置参数校验
      if (!dto || (dto.isPassed !== 0 && dto.isPassed !== 1)) {
        throw new Error("PARAM_ERROR: isPassed 必须为 0 (驳回) 或 1 (合格)");
      }

      const isPassed = Number(dto.isPassed) === 1 ? PatrolReviewPassedEnum.PASSED : PatrolReviewPassedEnum.REJECTED;
      const cleanRemark = validateReviewRemark(isPassed, dto.remark);
      const validatedImages = verifyReviewImages(dto.images);

      // 1.3 查询工单现状并核验
      let patrol: any = PatrolService.getMockPatrol(patrolId);
      if (!patrol && getMySQLPool()) {
        const pRes = await executeQuery(
          `SELECT id, status, currentHandlerId, title, schoolId FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
          [patrolId, schoolId]
        );
        if (pRes.status === 1 && pRes.data && pRes.data.length > 0) {
          patrol = pRes.data[0];
        }
      }

      if (!patrol) {
        throw new Error("PATROL_NOT_FOUND: 目标工单不存在或无权访问");
      }

      // 1.4 前置硬门禁断言：状态门禁、审修分离原则、质检角色权限校验
      assertCanReviewPatrol(reviewer, patrol);

      const now = new Date();
      const nowIso = now.toISOString();

      // 1.5 步骤 1: 写入质检复核记录表 Table 17 patrols_review
      const reviewRecord = this.mockRegisterReviewRecord({
        schoolId,
        patrolId,
        reviewerId: reviewer.id,
        isPassed,
        remark: cleanRemark,
        imagesJson: validatedImages,
        createdAt: nowIso
      });

      if (getMySQLPool()) {
        await executeQuery(
          `INSERT INTO patrols_review (id, schoolId, patrolId, reviewerId, isPassed, remark, imagesJson, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reviewRecord.id,
            schoolId,
            patrolId,
            reviewer.id,
            isPassed,
            cleanRemark,
            JSON.stringify(validatedImages),
            now
          ]
        );
      }

      // 1.6 步骤 2: 双轨原子跃迁工单状态
      let newStatus: number;
      let autoFeedbackScheduledAt: string | undefined;

      if (isPassed === PatrolReviewPassedEnum.PASSED) {
        // [轨道 A: 合格办结] 跃迁 2 -> 3 (已结案待评价)
        newStatus = 3;
        PatrolService.updateMockPatrol(patrolId, {
          status: 3,
          completedAt: nowIso
        });

        if (getMySQLPool()) {
          await executeQuery(
            `UPDATE patrols SET status = 3, completedAt = NOW(), updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
            [patrolId, schoolId]
          );
        }

        // 挂载 7 天超时自动五星好评定时任务 (7 * 24 * 3600 * 1000)
        const autoFeedbackTimestamp = now.getTime() + 7 * 86400 * 1000;
        autoFeedbackScheduledAt = new Date(autoFeedbackTimestamp).toISOString();
        mockAutoFeedbackTimers.set(patrolId, {
          scheduledAt: autoFeedbackTimestamp,
          schoolId
        });

        // 联动 Redis 运维缓存与 SLA ZSET
        const redis = getRedisClient();
        if (redis) {
          try {
            await redis.zrem(`tenant:${schoolId}:patrol:overdue_sla`, String(patrolId));
            await redis.zadd(`tenant:${schoolId}:patrol:auto_feedback`, autoFeedbackTimestamp, String(patrolId));
          } catch {
            // 容错降级
          }
        }
      } else {
        // [轨道 B: 质检驳回] 退回 2 -> 1 (进行中返工)，保留原责任师傅 currentHandlerId 不变
        newStatus = 1;
        PatrolService.updateMockPatrol(patrolId, {
          status: 1
        });

        if (getMySQLPool()) {
          await executeQuery(
            `UPDATE patrols SET status = 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
            [patrolId, schoolId]
          );
        }
      }

      // 1.7 步骤 3: 穿透联动 M25 聊天室下发进度通报卡片
      await this.injectReviewChatNotice(schoolId, patrolId, isPassed, cleanRemark);

      // 1.8 步骤 4: 记录安全审计日志
      await AuditLogger.log(
        schoolId,
        reviewer.id,
        isPassed === PatrolReviewPassedEnum.PASSED ? "PATROL_REVIEW_PASS" : "PATROL_REVIEW_REJECT",
        "patrols_review",
        clientIp,
        {
          reviewId: reviewRecord.id,
          patrolId,
          isPassed,
          newStatus,
          remark: cleanRemark
        }
      );

      return {
        reviewId: reviewRecord.id,
        patrolId,
        isPassed,
        newStatus,
        reviewedAt: nowIso,
        autoFeedbackScheduledAt
      };
    } finally {
      // 1.9 释放行级锁
      await RowLockManager.releaseRowLock(schoolId, "patrols", patrolId, requestId, true);
    }
  }

  /**
   * 2. 查询指定工单的质检复核多轮流水大盘
   */
  public static async getReviewHistory(
    schoolId: number,
    patrolId: number
  ): Promise<IPatrolReviewHistoryResponseDto> {
    // 2.1 获取工单当前状态
    let patrol: any = PatrolService.getMockPatrol(patrolId);
    if (!patrol && getMySQLPool()) {
      const pRes = await executeQuery(
        `SELECT id, status, schoolId FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
        [patrolId, schoolId]
      );
      if (pRes.status === 1 && pRes.data && pRes.data.length > 0) {
        patrol = pRes.data[0];
      }
    }

    if (!patrol) {
      throw new Error("PATROL_NOT_FOUND: 目标工单不存在或无权访问");
    }

    // 2.2 获取多轮复核记录
    let records: IPatrolReviewEntity[] = Array.from(mockReviewRecordsMap.values())
      .filter((r) => r.schoolId === schoolId && r.patrolId === patrolId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (records.length === 0 && getMySQLPool()) {
      const dbRes = await executeQuery(
        `SELECT id, schoolId, patrolId, reviewerId, isPassed, remark, imagesJson, createdAt
         FROM patrols_review
         WHERE schoolId = ? AND patrolId = ?
         ORDER BY createdAt ASC`,
        [schoolId, patrolId]
      );
      if (dbRes.status === 1 && dbRes.data) {
        records = dbRes.data.map((row: any) => ({
          id: row.id,
          schoolId: row.schoolId,
          patrolId: row.patrolId,
          reviewerId: row.reviewerId,
          isPassed: Number(row.isPassed),
          remark: row.remark,
          imagesJson: typeof row.imagesJson === "string" ? JSON.parse(row.imagesJson) : row.imagesJson || [],
          createdAt: new Date(row.createdAt).toISOString()
        }));
      }
    }

    return {
      patrolId,
      totalRounds: records.length,
      latestStatus: Number(patrol.status),
      records: records.map((r) => ({
        id: r.id,
        schoolId: r.schoolId,
        patrolId: r.patrolId,
        reviewerId: r.reviewerId,
        reviewerName: `质检员_${r.reviewerId}`,
        isPassed: r.isPassed,
        remark: r.remark,
        images: r.imagesJson,
        createdAt: r.createdAt
      }))
    };
  }

  /**
   * 内部辅助：联动 M25 聊天室下发质检复核卡片 (type: 2 进度卡片)
   */
  private static async injectReviewChatNotice(
    schoolId: number,
    patrolId: number,
    isPassed: number,
    remark: string
  ): Promise<void> {
    try {
      for (let i = 1; i <= 10000; i++) {
        const room = ChatService.getMockRoom(i);
        if (room && room.schoolId === schoolId && room.patrolId === patrolId) {
          const content =
            isPassed === PatrolReviewPassedEnum.PASSED
              ? "【质检复核合格】 经质检专家到场实地复核，施工整改质量达标，工单已办结并进入师生评价环节。"
              : `【质检复核驳回返工】 经质检专家到场复核，整改未达标，批复意见：${remark}。请责任师傅立即返工整改！`;

          await ChatService.sendMessage(schoolId, 0, 9 as any, {
            chatRoomId: room.id,
            type: 2, // 2: 工单进度卡片
            content
          });
          break;
        }
      }
    } catch {
      // 容错不阻塞主事务
    }
  }
}
