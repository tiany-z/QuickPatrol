/**
 * 高校后勤巡查e速办 v4.0 - M29: 满意度核心业务中枢与超时自动好评结案引擎
 * (Feedback Service & Auto-Settlement Engine)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RowLockManager } from "../../shared/lock/rowLockManager.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { getRedisClient } from "../../shared/cache/redis.js";
import { PatrolService } from "../patrol/patrolService.js";
import { ChatService } from "../chat/chatService.js";
import { ContentSanitizer } from "./contentSanitizer.js";
import {
  IFeedbackEntity,
  ISubmitFeedbackRequestDto,
  ISubmitFeedbackResponseDto,
  IFeedbackDetailDto,
  IMasterReputationProfileDto
} from "./feedbackTypes.js";

// 测试沙箱内存存储 Table 10: feedbacks
const mockFeedbacksMap = new Map<number, IFeedbackEntity>();
let mockFeedbackIdCounter = 7500;

export class FeedbackService {
  /**
   * 注册测试沙箱评价记录
   */
  public static mockRegisterFeedback(feedback: Omit<IFeedbackEntity, "id"> & { id?: number }): IFeedbackEntity {
    const id = feedback.id || ++mockFeedbackIdCounter;
    const entity: IFeedbackEntity = { ...feedback, id };
    mockFeedbacksMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱指定评价
   */
  public static getMockFeedback(id: number): IFeedbackEntity | undefined {
    return mockFeedbacksMap.get(id);
  }

  /**
   * 根据工单ID获取评价记录
   */
  public static getMockFeedbackByPatrolId(schoolId: number, patrolId: number): IFeedbackEntity | undefined {
    for (const f of mockFeedbacksMap.values()) {
      if (f.schoolId === schoolId && f.patrolId === patrolId) {
        return f;
      }
    }
    return undefined;
  }

  /**
   * 获取测试沙箱所有评价
   */
  public static getAllMockFeedbacks(): IFeedbackEntity[] {
    return Array.from(mockFeedbacksMap.values());
  }

  /**
   * 清空测试沙箱全部评价数据
   */
  public static clearMockData(): void {
    mockFeedbacksMap.clear();
    mockFeedbackIdCounter = 7500;
  }

  /**
   * 1. 师生主动提交满意度评价
   */
  public static async submitFeedback(
    schoolId: number,
    patrolId: number,
    evaluatorId: number,
    dto: ISubmitFeedbackRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<ISubmitFeedbackResponseDto> {
    const requestId = `req_feedback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1.1 申请工单行级排他锁 (防并发重复评价打分)
    const lockRes = await RowLockManager.acquireRowLock(
      schoolId,
      "patrols",
      patrolId,
      "UPDATE",
      requestId,
      3000
    );

    if (lockRes.status === 0 || !lockRes.data) {
      throw new Error("CONCURRENT_LOCK_BUSY: 系统繁忙，正在处理当前工单评价，请稍后重试");
    }

    try {
      // 1.2 查询工单现状并校验
      let patrol: any = PatrolService.getMockPatrol(patrolId);
      if (!patrol && getMySQLPool()) {
        const pRes = await executeQuery(
          `SELECT id, status, creatorId, currentHandlerId, title FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
          [patrolId, schoolId]
        );
        if (pRes.status === 1 && pRes.data && pRes.data.length > 0) {
          patrol = pRes.data[0];
        }
      }

      if (!patrol) {
        throw new Error("PATROL_NOT_FOUND: 目标工单不存在");
      }

      // 1.3 状态机门禁：工单必须处于已办结/已复核状态 (status = 3)
      if (Number(patrol.status) !== 3) {
        throw new Error(`STATUS_CONFLICT: 工单尚未由质检人员办结复核(当前状态:${patrol.status})，暂不可评价`);
      }

      // 1.4 提报人身份硬隔离门禁：仅原提报人有权打分
      if (Number(patrol.creatorId) !== Number(evaluatorId)) {
        throw new Error("FORBIDDEN_NOT_CREATOR: 权限不足，只有工单原提报师生有权对维修服务进行打分");
      }

      // 1.5 重复评价前置与唯一键校验
      const existing = this.getMockFeedbackByPatrolId(schoolId, patrolId);
      if (existing) {
        throw new Error("FEEDBACK_ALREADY_EXISTS: 该工单服务已完成评价，严禁重复提交");
      }

      if (getMySQLPool()) {
        const checkDb = await executeQuery(
          `SELECT id FROM feedbacks WHERE schoolId = ? AND patrolId = ? LIMIT 1`,
          [schoolId, patrolId]
        );
        if (checkDb.status === 1 && checkDb.data && checkDb.data.length > 0) {
          throw new Error("FEEDBACK_ALREADY_EXISTS: 该工单服务已完成评价，严禁重复提交");
        }
      }

      // 1.6 四维星级评分防御性截断与默认值对齐 (1~5)
      const parsedScore = Number(dto.score || 5);
      const score = Math.max(1, Math.min(5, isNaN(parsedScore) ? 5 : Math.floor(parsedScore)));
      const speedScore = Math.max(
        1,
        Math.min(5, dto.speedScore !== undefined ? Math.floor(Number(dto.speedScore)) : score)
      );
      const qualityScore = Math.max(
        1,
        Math.min(5, dto.qualityScore !== undefined ? Math.floor(Number(dto.qualityScore)) : score)
      );
      const attitudeScore = Math.max(
        1,
        Math.min(5, dto.attitudeScore !== undefined ? Math.floor(Number(dto.attitudeScore)) : score)
      );

      // 1.7 评语 DFA 脱敏清洗与标签过滤
      const rawComment = dto.comment ? String(dto.comment).trim() : "满意";
      const { cleanText } = ContentSanitizer.filterText(rawComment);
      const cleanTags = Array.isArray(dto.tags)
        ? dto.tags.filter((t) => typeof t === "string" && t.trim().length > 0).slice(0, 5)
        : [];

      const now = new Date();
      const nowIso = now.toISOString();

      // 1.8 写入 feedbacks 底表
      const feedbackRecord = this.mockRegisterFeedback({
        schoolId,
        patrolId,
        userId: evaluatorId,
        score,
        speedScore,
        qualityScore,
        attitudeScore,
        comment: cleanText,
        tagsJson: cleanTags,
        isAutoPassed: 0,
        createdAt: nowIso
      });

      if (getMySQLPool()) {
        await executeQuery(
          `INSERT INTO feedbacks 
           (id, schoolId, patrolId, userId, score, speedScore, qualityScore, attitudeScore, comment, tagsJson, isAutoPassed, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            feedbackRecord.id,
            schoolId,
            patrolId,
            evaluatorId,
            score,
            speedScore,
            qualityScore,
            attitudeScore,
            cleanText,
            JSON.stringify(cleanTags),
            now
          ]
        );
      }

      // 1.9 清理 Redis 中挂载的 7 天超时自动好评任务
      const redis = getRedisClient();
      if (redis) {
        try {
          await redis.zrem(`school:${schoolId}:patrol:zset:auto_feedback`, String(patrolId));
          await redis.zrem(`tenant:${schoolId}:patrol:auto_feedback`, String(patrolId));
        } catch {
          // 容错降级
        }
      }

      // 1.10 穿透 M25 聊天室：下发致谢卡片并永久封锁会话输入
      await this.injectFeedbackChatNoticeAndLock(schoolId, patrolId, score, cleanText);

      // 1.11 差评熔断告警 (score <= 2 或任意子维度 <= 2)
      let isNegativeAlertTriggered = false;
      if (score <= 2 || speedScore <= 2 || qualityScore <= 2 || attitudeScore <= 2) {
        isNegativeAlertTriggered = true;
        await this.triggerNegativeFeedbackAlert(
          schoolId,
          patrolId,
          Number(patrol.currentHandlerId || 0),
          score,
          cleanText,
          clientIp
        );
      }

      // 1.12 正常审计留痕
      await AuditLogger.log(schoolId, evaluatorId, "PATROL_FEEDBACK_SUBMIT", "feedbacks", clientIp, {
        feedbackId: feedbackRecord.id,
        patrolId,
        score,
        isNegativeAlertTriggered
      });

      return {
        feedbackId: feedbackRecord.id,
        patrolId,
        effectiveScore: score,
        isNegativeAlertTriggered,
        evaluatedAt: nowIso
      };
    } finally {
      // 1.13 释放行级锁
      await RowLockManager.releaseRowLock(schoolId, "patrols", patrolId, requestId, true);
    }
  }

  /**
   * 2. 执行 7 天超时系统自动五星好评代结
   */
  public static async executeAutoFeedbackSettlement(
    schoolId: number,
    patrolId: number
  ): Promise<void> {
    // 检查是否已有评价 (若已评则幂等忽略)
    const existing = this.getMockFeedbackByPatrolId(schoolId, patrolId);
    if (existing) {
      return;
    }

    if (getMySQLPool()) {
      const checkDb = await executeQuery(
        `SELECT id FROM feedbacks WHERE schoolId = ? AND patrolId = ? LIMIT 1`,
        [schoolId, patrolId]
      );
      if (checkDb.status === 1 && checkDb.data && checkDb.data.length > 0) {
        return;
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const record = this.mockRegisterFeedback({
      schoolId,
      patrolId,
      userId: 0, // 系统自动代结标记为 0
      score: 5,
      speedScore: 5,
      qualityScore: 5,
      attitudeScore: 5,
      comment: "超时未评，系统默认全五星好评",
      tagsJson: ["系统默认好评"],
      isAutoPassed: 1, // 明确标记系统代结
      createdAt: nowIso
    });

    if (getMySQLPool()) {
      await executeQuery(
        `INSERT IGNORE INTO feedbacks 
         (id, schoolId, patrolId, userId, score, speedScore, qualityScore, attitudeScore, comment, tagsJson, isAutoPassed, createdAt)
         VALUES (?, ?, ?, 0, 5, 5, 5, 5, '超时未评，系统默认全五星好评', '["系统默认好评"]', 1, ?)`,
        [record.id, schoolId, patrolId, now]
      );
    }

    // 清理 Redis
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.zrem(`school:${schoolId}:patrol:zset:auto_feedback`, String(patrolId));
        await redis.zrem(`tenant:${schoolId}:patrol:auto_feedback`, String(patrolId));
      } catch {
        // 容错降级
      }
    }

    // 穿透 M25 聊天室下发自动代结卡片并封存
    await this.injectAutoFeedbackNoticeAndLock(schoolId, patrolId);

    // 审计留痕
    await AuditLogger.log(schoolId, 0, "PATROL_AUTO_FEEDBACK_SETTLED", "feedbacks", "127.0.0.1", {
      feedbackId: record.id,
      patrolId,
      score: 5
    });
  }

  /**
   * 3. 查询指定工单的评价详情
   */
  public static async getFeedbackDetail(
    schoolId: number,
    patrolId: number
  ): Promise<IFeedbackDetailDto | null> {
    const mem = this.getMockFeedbackByPatrolId(schoolId, patrolId);
    if (mem) {
      return {
        feedbackId: mem.id,
        patrolId: mem.patrolId,
        evaluatorId: mem.userId,
        evaluatorName: mem.userId === 0 ? "系统自动结案" : `师生_${mem.userId}`,
        score: mem.score,
        speedScore: mem.speedScore,
        qualityScore: mem.qualityScore,
        attitudeScore: mem.attitudeScore,
        comment: mem.comment,
        tags: mem.tagsJson || [],
        isAutoPassed: mem.isAutoPassed === 1,
        createdAt: mem.createdAt
      };
    }

    if (getMySQLPool()) {
      const dbRes = await executeQuery(
        `SELECT f.*, u.realName, u.username
         FROM feedbacks f
         LEFT JOIN users u ON f.userId = u.id
         WHERE f.schoolId = ? AND f.patrolId = ? LIMIT 1`,
        [schoolId, patrolId]
      );
      if (dbRes.status === 1 && dbRes.data && dbRes.data.length > 0) {
        const r = dbRes.data[0];
        let tags: string[] = [];
        try {
          tags = typeof r.tagsJson === "string" ? JSON.parse(r.tagsJson) : r.tagsJson || [];
        } catch {
          tags = [];
        }

        return {
          feedbackId: r.id,
          patrolId: r.patrolId,
          evaluatorId: r.userId,
          evaluatorName: r.userId === 0 ? "系统自动结案" : (r.realName || r.username || `师生_${r.userId}`),
          score: r.score,
          speedScore: r.speedScore,
          qualityScore: r.qualityScore,
          attitudeScore: r.attitudeScore,
          comment: r.comment,
          tags,
          isAutoPassed: Number(r.isAutoPassed) === 1,
          createdAt: new Date(r.createdAt).toISOString()
        };
      }
    }

    return null;
  }

  /**
   * 4. 师傅个人口碑档案与星级画像聚合推导 (Reputation Profile)
   */
  public static async getMasterReputationProfile(
    schoolId: number,
    masterId: number
  ): Promise<IMasterReputationProfileDto> {
    // 找出所有归属该师傅的评价记录
    const masterPatrolIds = new Set<number>();

    // 内存沙箱检索该师傅关联工单
    for (let i = 1; i <= 20000; i++) {
      const p = PatrolService.getMockPatrol(i);
      if (p && p.schoolId === schoolId && Number(p.currentHandlerId) === Number(masterId)) {
        masterPatrolIds.add(p.id);
      }
    }

    let records = Array.from(mockFeedbacksMap.values()).filter(
      (f) => f.schoolId === schoolId && masterPatrolIds.has(f.patrolId)
    );

    if (records.length === 0 && getMySQLPool()) {
      const dbRes = await executeQuery(
        `SELECT f.score, f.speedScore, f.qualityScore, f.attitudeScore, f.tagsJson
         FROM feedbacks f
         INNER JOIN patrols p ON f.patrolId = p.id
         WHERE f.schoolId = ? AND p.currentHandlerId = ?`,
        [schoolId, masterId]
      );
      if (dbRes.status === 1 && dbRes.data) {
        records = dbRes.data.map((r: any) => ({
          ...r,
          tagsJson: typeof r.tagsJson === "string" ? JSON.parse(r.tagsJson) : r.tagsJson || []
        }));
      }
    }

    if (records.length === 0) {
      return {
        masterId,
        masterName: `师傅_${masterId}`,
        totalEvaluations: 0,
        averageScore: 5.0,
        dimensionAverages: {
          speed: 5.0,
          quality: 5.0,
          attitude: 5.0
        },
        positiveRate: 100,
        topTags: [],
        nps: 100
      };
    }

    const total = records.length;
    let sumScore = 0;
    let sumSpeed = 0;
    let sumQuality = 0;
    let sumAttitude = 0;
    let positiveCount = 0;
    let promotersCount = 0;
    let detractorsCount = 0;
    const tagCountMap = new Map<string, number>();

    for (const r of records) {
      sumScore += r.score;
      sumSpeed += r.speedScore;
      sumQuality += r.qualityScore;
      sumAttitude += r.attitudeScore;

      if (r.score >= 4) positiveCount++;
      if (r.score === 5) promotersCount++;
      if (r.score <= 3) detractorsCount++;

      const tags = Array.isArray(r.tagsJson) ? r.tagsJson : [];
      for (const t of tags) {
        tagCountMap.set(t, (tagCountMap.get(t) || 0) + 1);
      }
    }

    const averageScore = Math.round((sumScore / total) * 10) / 10;
    const avgSpeed = Math.round((sumSpeed / total) * 10) / 10;
    const avgQuality = Math.round((sumQuality / total) * 10) / 10;
    const avgAttitude = Math.round((sumAttitude / total) * 10) / 10;
    const positiveRate = Math.round((positiveCount / total) * 100);
    const nps = Math.round(((promotersCount - detractorsCount) / total) * 100);

    const sortedTags = Array.from(tagCountMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      masterId,
      masterName: `师傅_${masterId}`,
      totalEvaluations: total,
      averageScore,
      dimensionAverages: {
        speed: avgSpeed,
        quality: avgQuality,
        attitude: avgAttitude
      },
      positiveRate,
      topTags: sortedTags,
      nps
    };
  }

  /**
   * 内部辅助：触发低星差评熔断告警
   */
  private static async triggerNegativeFeedbackAlert(
    schoolId: number,
    patrolId: number,
    handlerId: number,
    score: number,
    comment: string,
    clientIp: string
  ): Promise<void> {
    await AuditLogger.log(schoolId, 0, "NEGATIVE_FEEDBACK_ALERT", "patrols", clientIp, {
      alertLevel: "HIGH_URGENT",
      patrolId,
      score,
      handlerId,
      comment,
      prompt: "请维修科室主管于 24 小时内致电师生完成回访跟进"
    });

    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.publish(
          `school:${schoolId}:admin:quality_alerts`,
          JSON.stringify({
            eventType: "NEGATIVE_FEEDBACK",
            patrolId,
            score,
            comment,
            timestamp: Date.now()
          })
        );
      } catch {
        // 容错
      }
    }
  }

  /**
   * 内部辅助：穿透 M25 聊天室注入致谢卡片并彻底置为已封存
   */
  private static async injectFeedbackChatNoticeAndLock(
    schoolId: number,
    patrolId: number,
    score: number,
    cleanComment: string
  ): Promise<void> {
    try {
      for (let i = 1; i <= 10000; i++) {
        const room = ChatService.getMockRoom(i);
        if (room && room.schoolId === schoolId && room.patrolId === patrolId) {
          const stars = "★".repeat(score) + "☆".repeat(5 - score);
          await ChatService.sendMessage(schoolId, 0, 9 as any, {
            chatRoomId: room.id,
            type: 2, // 2: 工单进度系统卡片
            content: `【师生已完成服务评价】 评分：${stars} (${score}.0分) “${cleanComment.slice(0, 30)}”。服务已圆满闭环，会话已安全归档封存。`
          });

          // 物理封锁会话输入
          room.isClosed = 1;
          if (getMySQLPool()) {
            await executeQuery(
              `UPDATE chat_rooms SET isClosed = 1 WHERE id = ? AND schoolId = ?`,
              [room.id, schoolId]
            );
          }
          break;
        }
      }
    } catch {
      // 容错
    }
  }

  /**
   * 内部辅助：超时自动代结聊天室卡片与只读封存
   */
  private static async injectAutoFeedbackNoticeAndLock(
    schoolId: number,
    patrolId: number
  ): Promise<void> {
    try {
      for (let i = 1; i <= 10000; i++) {
        const room = ChatService.getMockRoom(i);
        if (room && room.schoolId === schoolId && room.patrolId === patrolId) {
          await ChatService.sendMessage(schoolId, 0, 9 as any, {
            chatRoomId: room.id,
            type: 2, // 2: 工单进度系统卡片
            content: `【系统自动好评结案】 师生超过 7 天未予评价，系统已按默认全五星好评结算。工单彻底归档，会话已封存。`
          });

          room.isClosed = 1;
          if (getMySQLPool()) {
            await executeQuery(
              `UPDATE chat_rooms SET isClosed = 1 WHERE id = ? AND schoolId = ?`,
              [room.id, schoolId]
            );
          }
          break;
        }
      }
    } catch {
      // 容错
    }
  }
}
