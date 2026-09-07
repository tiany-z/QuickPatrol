/**
 * 高校后勤巡查e速办 v4.0 - M26: 延期申请核心业务调度与事务中枢服务
 * (Patrol Delay Approval & Lifecycle Extension Service)
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { RowLockManager } from "../../shared/lock/rowLockManager.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "./patrolService.js";
import { ChatService } from "../chat/chatService.js";
import {
  IPatrolDelayRecordEntity,
  PatrolDelayStatusEnum,
  ICreateDelayApplyRequestDto,
  ICreateDelayApplyResponseDto,
  IReviewDelayApplyRequestDto,
  IReviewDelayApplyResponseDto,
  IPatrolDelayHistoryResponseDto,
  IPatrolDelayItemDto
} from "./delayTypes.js";
import { calculateNewDeadline, evaluateRequiredRole } from "./delayAlgorithm.js";

// 内存测试沙箱延期申请字典 (支持单测脱机无依赖执行)
const mockDelayRecordsMap = new Map<number, IPatrolDelayRecordEntity>();
let mockDelayIdCounter = 8800;

export class DelayService {
  /**
   * 注册虚拟延期记录 (用于离线单元测试)
   */
  public static mockRegisterDelayRecord(
    record: Partial<IPatrolDelayRecordEntity> & { schoolId: number; patrolId: number; applicantId: number }
  ): IPatrolDelayRecordEntity {
    const id = record.id || ++mockDelayIdCounter;
    const entity: IPatrolDelayRecordEntity = {
      id,
      schoolId: record.schoolId,
      patrolId: record.patrolId,
      applicantId: record.applicantId,
      reason: record.reason || "现场复杂工况申请顺延",
      delayHours: record.delayHours || 24,
      oldDeadline: record.oldDeadline || new Date().toISOString(),
      newDeadline: record.newDeadline || new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      status: (record.status !== undefined ? record.status : PatrolDelayStatusEnum.PENDING) as any,
      reviewerId: record.reviewerId || 0,
      reviewRemark: record.reviewRemark || "",
      reviewedAt: record.reviewedAt || null,
      createdAt: record.createdAt || new Date().toISOString()
    };
    mockDelayRecordsMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱指定记录
   */
  public static getMockDelayRecord(id: number): IPatrolDelayRecordEntity | undefined {
    return mockDelayRecordsMap.get(id);
  }

  /**
   * 清空测试沙箱全部延期数据
   */
  public static clearMockData(): void {
    mockDelayRecordsMap.clear();
    mockDelayIdCounter = 8800;
  }

  /**
   * 1. 师傅提交延期申请
   */
  public static async createDelayApply(
    schoolId: number,
    patrolId: number,
    applicantId: number,
    dto: ICreateDelayApplyRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<ICreateDelayApplyResponseDto> {
    const requestId = `req_delay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1.1 申请针对该工单的排他行级锁 (防止弱网并发重放提交)
    const lockRes = await RowLockManager.acquireRowLock(
      schoolId,
      "patrols",
      patrolId,
      "UPDATE",
      requestId,
      3000
    );

    if (lockRes.status === 0 || !lockRes.data) {
      throw new Error("CONCURRENT_LOCK_BUSY: 系统繁忙，正在处理该工单请求，请稍后重试");
    }

    try {
      // 1.2 查询工单现状
      let patrol: any = PatrolService.getMockPatrol(patrolId);
      if (!patrol && getMySQLPool()) {
        const pRes = await executeQuery(
          `SELECT id, status, currentHandlerId, deadline, title FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
          [patrolId, schoolId]
        );
        if (pRes.status === 1 && pRes.data && pRes.data.length > 0) {
          patrol = pRes.data[0];
        }
      }

      if (!patrol) {
        throw new Error("PATROL_NOT_FOUND: 工单不存在或无权限访问");
      }

      // 1.3 状态门禁：必须处于进行中 (status = 1)
      if (Number(patrol.status) !== 1) {
        throw new Error(`INVALID_PATROL_STATUS: 仅处理中的工单可申请延期 (当前状态: ${patrol.status})`);
      }

      // 1.4 责任人一致性检查：只有接单师傅可以发起
      if (Number(patrol.currentHandlerId) !== applicantId) {
        throw new Error("FORBIDDEN_NOT_CURRENT_HANDLER: 只有当前接单责任人有权发起延期申请");
      }

      // 1.5 延期时长合法性检查
      if (!dto.delayHours || dto.delayHours <= 0 || dto.delayHours > 168) {
        throw new Error("INVALID_DELAY_HOURS: 申请顺延时长须在 1~168 小时之间");
      }

      if (!dto.reason || dto.reason.trim().length < 5) {
        throw new Error("PARAM_ERROR: 请至少输入 5 个字符的客观原因说明");
      }

      // 1.6 在审唯一性检查 (Single Pending Constraint)：当前工单不能有 status = 0 的记录
      let hasPending = false;
      for (const r of mockDelayRecordsMap.values()) {
        if (r.schoolId === schoolId && r.patrolId === patrolId && r.status === PatrolDelayStatusEnum.PENDING) {
          hasPending = true;
          break;
        }
      }

      if (!hasPending && getMySQLPool()) {
        const pendingRes = await executeQuery(
          `SELECT COUNT(1) AS pendingCount FROM patrol_delay_records WHERE schoolId = ? AND patrolId = ? AND status = 0`,
          [schoolId, patrolId]
        );
        if (pendingRes.status === 1 && pendingRes.data && Number(pendingRes.data[0]?.pendingCount) > 0) {
          hasPending = true;
        }
      }

      if (hasPending) {
        throw new Error("PENDING_DELAY_EXISTS: 当前已有待审核的延期申请，严禁重复提交");
      }

      // 1.7 累计申请上限熔断检测
      const history = await this.getDelayHistory(schoolId, patrolId);
      if (history.approvedCount >= 5 || history.cumulativeDelayHours + dto.delayHours > 360) {
        throw new Error("CUMULATIVE_DELAY_LIMIT_REACHED: 累计延期次数或总工期已达系统硬熔断线，无法继续申请");
      }

      // 1.8 截止时限顺延动力学模型计算
      const oldDeadlineDate = patrol.deadline ? new Date(patrol.deadline) : new Date();
      const targetDeadlineDate = calculateNewDeadline(
        oldDeadlineDate.getTime(),
        dto.delayHours,
        Date.now()
      );

      // 1.9 序列化客观原因及照片附件快照
      const fullReasonPayload = JSON.stringify({
        text: dto.reason.trim(),
        evidenceImages: dto.evidenceImages || []
      });

      // 1.10 写入 patrol_delay_records
      const newRecord = this.mockRegisterDelayRecord({
        schoolId,
        patrolId,
        applicantId,
        reason: fullReasonPayload,
        delayHours: dto.delayHours,
        oldDeadline: oldDeadlineDate.toISOString(),
        newDeadline: targetDeadlineDate.toISOString(),
        status: PatrolDelayStatusEnum.PENDING,
        createdAt: new Date().toISOString()
      });

      if (getMySQLPool()) {
        await executeQuery(
          `INSERT INTO patrol_delay_records 
           (schoolId, patrolId, applicantId, reason, delayHours, oldDeadline, newDeadline, status, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
          [
            schoolId,
            patrolId,
            applicantId,
            fullReasonPayload,
            dto.delayHours,
            oldDeadlineDate,
            targetDeadlineDate
          ]
        );
      }

      // 1.11 记录不可篡改审计流水
      await AuditLogger.log(schoolId, applicantId, "PATROL_DELAY_APPLY", "patrol_delay_records", clientIp, {
        patrolId,
        applyId: newRecord.id,
        delayHours: dto.delayHours
      });

      return {
        applyId: newRecord.id,
        patrolId,
        status: PatrolDelayStatusEnum.PENDING,
        oldDeadline: oldDeadlineDate.toISOString(),
        predictedDeadline: targetDeadlineDate.toISOString(),
        createdAt: newRecord.createdAt
      };
    } finally {
      // 释放行级排他锁
      await RowLockManager.releaseRowLock(schoolId, "patrols", patrolId, requestId, true);
    }
  }

  /**
   * 2. 学校管理员审批延期申请 (同意 / 驳回)
   */
  public static async reviewDelayApply(
    schoolId: number,
    applyId: number,
    reviewerId: number,
    reviewerRole: number,
    dto: IReviewDelayApplyRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<IReviewDelayApplyResponseDto> {
    const requestId = `req_review_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const lockRes = await RowLockManager.acquireRowLock(
      schoolId,
      "patrol_delay_records",
      applyId,
      "UPDATE",
      requestId,
      3000
    );

    if (lockRes.status === 0 || !lockRes.data) {
      throw new Error("CONCURRENT_REVIEW_CONFLICT: 审批处理中，请勿重复操作");
    }

    try {
      // 2.1 查询申请记录并校验
      let record: IPatrolDelayRecordEntity | undefined = mockDelayRecordsMap.get(applyId);
      if (!record && getMySQLPool()) {
        const rRes = await executeQuery(
          `SELECT * FROM patrol_delay_records WHERE id = ? AND schoolId = ? LIMIT 1`,
          [applyId, schoolId]
        );
        if (rRes.status === 1 && rRes.data && rRes.data.length > 0) {
          record = rRes.data[0];
        }
      }

      if (!record) {
        throw new Error("DELAY_RECORD_NOT_FOUND: 延期申请记录不存在");
      }

      // 2.2 幂等性校验：只能审批处于待审核 (0) 状态的记录
      if (record.status !== PatrolDelayStatusEnum.PENDING) {
        throw new Error(`ALREADY_REVIEWED: 申请已被处理，当前状态为: ${record.status}`);
      }

      // 2.3 阶梯阈值自动升级判定
      const history = await this.getDelayHistory(schoolId, record.patrolId);
      const approvedCount = history.approvedCount;
      const cumulativeHours = history.cumulativeDelayHours + record.delayHours;
      const requiredRole = evaluateRequiredRole(approvedCount, cumulativeHours);

      if (reviewerRole < requiredRole) {
        throw new Error("INSUFFICIENT_PERMISSION: 累计延期超限，须由后勤分管处长终审");
      }

      const now = new Date();
      let effectiveDeadline = new Date(record.oldDeadline);

      if (dto.action === PatrolDelayStatusEnum.APPROVED) {
        // 同意延期：动力学校准最新截止时限
        effectiveDeadline = calculateNewDeadline(
          new Date(record.oldDeadline).getTime(),
          record.delayHours,
          now.getTime()
        );

        record.status = PatrolDelayStatusEnum.APPROVED;
        record.reviewerId = reviewerId;
        record.reviewRemark = dto.reviewRemark ? dto.reviewRemark.trim() : "同意顺延";
        record.newDeadline = effectiveDeadline.toISOString();
        record.reviewedAt = now.toISOString();

        // 同步更新工单主表 deadline
        PatrolService.updateMockPatrol(record.patrolId, {
          deadline: effectiveDeadline.toISOString()
        });

        if (getMySQLPool()) {
          await executeQuery(
            `UPDATE patrol_delay_records 
             SET status = 1, reviewerId = ?, reviewRemark = ?, newDeadline = ?, reviewedAt = ?
             WHERE id = ? AND schoolId = ?`,
            [reviewerId, record.reviewRemark, effectiveDeadline, now, applyId, schoolId]
          );

          await executeQuery(
            `UPDATE patrols SET deadline = ? WHERE id = ? AND schoolId = ?`,
            [effectiveDeadline, record.patrolId, schoolId]
          );
        }

        // 审计日志
        await AuditLogger.log(schoolId, reviewerId, "PATROL_DELAY_APPROVE", "patrol_delay_records", clientIp, {
          patrolId: record.patrolId,
          applyId,
          newDeadline: effectiveDeadline.toISOString()
        });

        // 联动 M25 聊天室下发工单进度卡片
        await this.injectDelayChatNotice(
          schoolId,
          record.patrolId,
          true,
          record.delayHours,
          effectiveDeadline,
          record.reviewRemark
        );
      } else {
        // 驳回延期
        if (!dto.reviewRemark || dto.reviewRemark.trim().length === 0) {
          throw new Error("PARAM_ERROR: 驳回延期申请时必须填写审核批注");
        }

        record.status = PatrolDelayStatusEnum.REJECTED;
        record.reviewerId = reviewerId;
        record.reviewRemark = dto.reviewRemark.trim();
        record.reviewedAt = now.toISOString();

        if (getMySQLPool()) {
          await executeQuery(
            `UPDATE patrol_delay_records 
             SET status = 2, reviewerId = ?, reviewRemark = ?, reviewedAt = ?
             WHERE id = ? AND schoolId = ?`,
            [reviewerId, record.reviewRemark, now, applyId, schoolId]
          );
        }

        // 审计日志
        await AuditLogger.log(schoolId, reviewerId, "PATROL_DELAY_REJECT", "patrol_delay_records", clientIp, {
          patrolId: record.patrolId,
          applyId,
          reason: record.reviewRemark
        });

        // 联动 M25 聊天室下发驳回通知
        await this.injectDelayChatNotice(
          schoolId,
          record.patrolId,
          false,
          record.delayHours,
          effectiveDeadline,
          record.reviewRemark
        );
      }

      // 获取审批人姓名
      const reviewerUser = WeChatAuthService.getMockUserById(reviewerId);
      const reviewerName = reviewerUser?.realName || "后勤管理处";

      return {
        applyId,
        patrolId: record.patrolId,
        finalStatus: dto.action,
        effectiveDeadline: effectiveDeadline.toISOString(),
        reviewerName,
        reviewedAt: now.toISOString()
      };
    } finally {
      await RowLockManager.releaseRowLock(schoolId, "patrol_delay_records", applyId, requestId, true);
    }
  }

  /**
   * 3. 查询单工单全量延期历史流水与聚合指标
   */
  public static async getDelayHistory(
    schoolId: number,
    patrolId: number
  ): Promise<IPatrolDelayHistoryResponseDto> {
    if (getMySQLPool()) {
      const sql = `
        SELECT 
          d.*, 
          u.realName AS applicantName, 
          u.phone AS applicantPhone,
          r.realName AS reviewerName
        FROM patrol_delay_records d
        LEFT JOIN users u ON d.applicantId = u.id AND d.schoolId = u.schoolId
        LEFT JOIN users r ON d.reviewerId = r.id AND d.schoolId = r.schoolId
        WHERE d.schoolId = ? AND d.patrolId = ?
        ORDER BY d.id DESC
      `;
      const res = await executeQuery(sql, [schoolId, patrolId]);
      if (res.status === 1 && res.data) {
        return this.aggregateDelayHistory(patrolId, res.data);
      }
    }

    // 内存沙箱查询
    const list: IPatrolDelayRecordEntity[] = [];
    for (const r of mockDelayRecordsMap.values()) {
      if (r.schoolId === schoolId && r.patrolId === patrolId) {
        list.push(r);
      }
    }
    list.sort((a, b) => b.id - a.id);
    return this.aggregateDelayHistory(patrolId, list);
  }

  /**
   * 4. 查询全校待审核的延期申请列表 (管理端大盘)
   */
  public static async getPendingApplies(schoolId: number): Promise<IPatrolDelayItemDto[]> {
    const history = await this.getDelayHistory(schoolId, 0);
    // 从 mock 字典中提取全部 status = 0
    const pendings: IPatrolDelayItemDto[] = [];
    for (const r of mockDelayRecordsMap.values()) {
      if (r.schoolId === schoolId && r.status === PatrolDelayStatusEnum.PENDING) {
        const applicant = WeChatAuthService.getMockUserById(r.applicantId);
        pendings.push({
          applyId: r.id,
          applicantId: r.applicantId,
          applicantName: applicant?.realName || "维修师傅",
          applicantPhone: applicant?.phone || "",
          reason: r.reason,
          evidenceImages: [],
          delayHours: r.delayHours,
          oldDeadline: r.oldDeadline,
          newDeadline: r.newDeadline,
          status: r.status,
          statusText: "待审核",
          reviewerId: 0,
          reviewerName: "-",
          reviewRemark: "",
          reviewedAt: null,
          createdAt: r.createdAt
        });
      }
    }
    return pendings;
  }

  // ---------------- 私有辅助函数 ----------------

  private static aggregateDelayHistory(patrolId: number, rows: any[]): IPatrolDelayHistoryResponseDto {
    let approvedCount = 0;
    let cumulativeDelayHours = 0;
    let hasPendingApply = false;

    const statusTexts = ["待审核", "已批准", "已驳回"];

    const records: IPatrolDelayItemDto[] = rows.map((r: any) => {
      if (r.status === PatrolDelayStatusEnum.APPROVED) {
        approvedCount++;
        cumulativeDelayHours += Number(r.delayHours || 0);
      }
      if (r.status === PatrolDelayStatusEnum.PENDING) {
        hasPendingApply = true;
      }

      let parsedReason = r.reason || "";
      let evidenceImages: string[] = [];
      try {
        const obj = JSON.parse(r.reason);
        if (obj && typeof obj === "object") {
          parsedReason = obj.text || r.reason;
          evidenceImages = Array.isArray(obj.evidenceImages) ? obj.evidenceImages : [];
        }
      } catch {
        // 普通纯文本格式
      }

      const applicantUser = r.applicantName ? null : WeChatAuthService.getMockUserById(r.applicantId);
      const reviewerUser = r.reviewerName ? null : WeChatAuthService.getMockUserById(r.reviewerId);

      return {
        applyId: Number(r.id),
        applicantId: Number(r.applicantId),
        applicantName: r.applicantName || applicantUser?.realName || "维修师傅",
        applicantPhone: r.applicantPhone || applicantUser?.phone || "",
        reason: parsedReason,
        evidenceImages,
        delayHours: Number(r.delayHours),
        oldDeadline: typeof r.oldDeadline === "string" ? r.oldDeadline : new Date(r.oldDeadline).toISOString(),
        newDeadline: typeof r.newDeadline === "string" ? r.newDeadline : new Date(r.newDeadline).toISOString(),
        status: Number(r.status) as any,
        statusText: statusTexts[r.status] || "未知",
        reviewerId: Number(r.reviewerId || 0),
        reviewerName: r.reviewerName || reviewerUser?.realName || (r.reviewerId ? "后勤管理员" : "-"),
        reviewRemark: r.reviewRemark || "",
        reviewedAt: r.reviewedAt ? (typeof r.reviewedAt === "string" ? r.reviewedAt : new Date(r.reviewedAt).toISOString()) : null,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(r.createdAt).toISOString()
      };
    });

    return {
      patrolId,
      totalApplyCount: records.length,
      approvedCount,
      cumulativeDelayHours,
      hasPendingApply,
      records
    };
  }

  /**
   * 联动 M25 聊天室下发进度卡片
   */
  private static async injectDelayChatNotice(
    schoolId: number,
    patrolId: number,
    isApproved: boolean,
    delayHours: number,
    newDeadline: Date,
    remark: string
  ): Promise<void> {
    try {
      // 查找对应工单会话室
      for (let i = 1; i <= 10000; i++) {
        const room = ChatService.getMockRoom(i);
        if (room && room.schoolId === schoolId && room.patrolId === patrolId) {
          const title = isApproved ? "【工期顺延通知】" : "【延期申请已驳回】";
          const summary = isApproved
            ? `管理处已批准延期 ${delayHours} 小时，预计完工时间更新为：${newDeadline.toLocaleString()}`
            : `延期申请未通过，批复意见：${remark}`;

          await ChatService.sendMessage(schoolId, 0, 9 as any, {
            chatRoomId: room.id,
            type: 2, // 2: 工单进度卡片
            content: `${title} ${summary}`
          });
          break;
        }
      }
    } catch {
      // 容错不阻塞主事务
    }
  }
}
