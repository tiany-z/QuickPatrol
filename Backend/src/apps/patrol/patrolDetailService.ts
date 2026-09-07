/**
 * 高校后勤巡查e速办 v4.0 - M30: 巡查工单综合大宽表视图与全景详情对比轴服务
 * (Patrol Detail Panoramic View & Multi-Source Assembly Service)
 * 
 * 核心架构特性：
 * 1. 预编译只读视图 v_patrol_details 零 Join 消耗快速映射
 * 2. 9 维多角色动态操作权限掩码 (evaluatePatrolActionPermissions) 权威计算
 * 3. 延期申请/现场整改/质检验收/满意度评价 4 路流水并行并发聚合 (Promise.all)
 * 4. 修复前后实拍双图视差比对模型 (visualPair Before-After Model) 提取
 * 5. 全生命周期时序大事件节点汇聚与全景时间轴构建 (Timeline Node Builder)
 * 6. 敏感身份与手机号动态数据脱敏屏障 (Privacy Fence)
 * 7. 异常工单终止作废协议 (abortPatrol) 与 M25 会话穿透锁定、SLA 队列剔除与审计留痕
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { getRedisClient } from "../../shared/cache/redis.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { SchoolService } from "../../services/school/schoolService.js";
import { PatrolService } from "./patrolService.js";
import { DelayService } from "./delayService.js";
import { PatrolHandleService } from "./patrolHandleService.js";
import { PatrolReviewService } from "./patrolReviewService.js";
import { FeedbackService } from "../feedback/feedbackService.js";
import { ChatService } from "../chat/chatService.js";
import { evaluatePatrolActionPermissions } from "./permissionEvaluator.js";
import {
  IVPatrolDetailEntity,
  IPatrolPanoramicDetailDto,
  IBeforeAfterPairDto,
  IPatrolTimelineNodeDto,
  IAbortPatrolRequestDto,
  IAbortPatrolResponseDto
} from "./patrolDetailTypes.js";

const STATUS_TEXT_MAP: Record<number, string> = {
  0: "待派单",
  1: "施工中",
  2: "待复核",
  3: "已办结",
  4: "已废弃",
  5: "返工中"
};

const PRIORITY_TEXT_MAP: Record<number, string> = {
  1: "一般",
  2: "重要",
  3: "紧急",
  4: "特急"
};

export class PatrolDetailService {
  /**
   * 1. 查询工单综合全景详情与动态权限操作矩阵 (秒开主聚合接口)
   */
  public static async getPanoramicDetail(
    schoolId: number,
    patrolId: number,
    currentUser: { id: number; role: number; permissions?: string[] }
  ): Promise<IPatrolPanoramicDetailDto> {
    if (!schoolId || !patrolId) {
      throw new Error("PARAM_ERROR: 缺少必要的高校或工单标识参数");
    }

    // 1.1 从预编译宽表视图 v_patrol_details 检索基础投影或回退内存沙箱
    const baseEntity = await this.queryVPatrolDetailEntity(schoolId, patrolId);

    // 1.2 跨租户物理隔离门禁校验
    if (baseEntity.schoolId !== schoolId) {
      throw new Error("CROSS_TENANT_FORBIDDEN: 跨校区或跨租户越权拦截");
    }

    // 1.3 并行并发聚合四大下游流水 (延期流水、完工整改、质检复核、服务评价)
    const [delayHistory, handleHistory, reviewHistory, feedbackRecord] = await Promise.all([
      DelayService.getDelayHistory(schoolId, patrolId).catch(() => ({
        patrolId,
        totalApplyCount: 0,
        approvedCount: 0,
        cumulativeDelayHours: 0,
        hasPendingApply: false,
        records: []
      })),
      PatrolHandleService.getHandleHistory(schoolId, patrolId).catch(() => ({
        patrolId,
        totalRounds: 0,
        cumulativeDurationHours: 0,
        records: []
      })),
      PatrolReviewService.getReviewHistory(schoolId, patrolId).catch(() => ({
        patrolId,
        totalRounds: 0,
        latestStatus: baseEntity.status,
        records: []
      })),
      FeedbackService.getFeedbackDetail(schoolId, patrolId).catch(() => null)
    ]);

    const hasFeedback = Boolean(feedbackRecord && (feedbackRecord as any).feedbackId);

    // 1.4 计算九维动态操作权限掩码
    const permissions = evaluatePatrolActionPermissions(
      currentUser,
      {
        status: baseEntity.status,
        creatorId: baseEntity.creatorId,
        currentHandlerId: baseEntity.currentHandlerId,
        deadline: baseEntity.deadline
      },
      hasFeedback
    );

    // 1.5 隐私围栏安全防护 (当事人保护：非提报人、非当前师傅、非管理员则动态脱敏手机号)
    const isDirectParty =
      currentUser.id === baseEntity.creatorId ||
      (baseEntity.currentHandlerId && currentUser.id === baseEntity.currentHandlerId) ||
      currentUser.role >= 3 ||
      (currentUser.permissions && currentUser.permissions.includes("admin"));

    const maskPhone = (phone?: string | null): string => {
      if (!phone) return "";
      if (isDirectParty) return phone;
      return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
    };

    // 1.6 解析原始提报图片集合
    let rawImages: string[] = [];
    const mockPatrol = PatrolService.getMockPatrol(patrolId);
    if (mockPatrol) {
      try {
        rawImages = typeof mockPatrol.imagesJson === "string"
          ? JSON.parse(mockPatrol.imagesJson)
          : (mockPatrol.imagesJson || []);
      } catch {
        rawImages = Array.isArray(mockPatrol.imagesJson) ? mockPatrol.imagesJson : [];
      }
    }

    // 1.7 提取施工前后对比视差双图 (visualPair)
    const beforeImageUrl = rawImages.length > 0 ? rawImages[0] : "";
    const latestHandleRecord = handleHistory.records && handleHistory.records.length > 0
      ? handleHistory.records[0]
      : null;
    const afterImageUrl = latestHandleRecord && latestHandleRecord.images && latestHandleRecord.images.length > 0
      ? latestHandleRecord.images[0]
      : "";

    const visualPair: IBeforeAfterPairDto = {
      hasPair: Boolean(beforeImageUrl && afterImageUrl),
      beforeImageUrl,
      afterImageUrl
    };

    // 1.8 构建全息时序生命周期时间轴
    const timeline = this.buildTimelineNodes({
      baseEntity,
      delayRecords: delayHistory.records || [],
      handleRecords: handleHistory.records || [],
      reviewRecords: reviewHistory.records || [],
      feedbackRecord
    });

    const statusText = STATUS_TEXT_MAP[baseEntity.status] || "未知状态";
    const priorityText = PRIORITY_TEXT_MAP[baseEntity.priorityLevel] || "常规";

    return {
      patrolId: baseEntity.patrolId,
      orderNo: baseEntity.orderNo,
      schoolId: baseEntity.schoolId,
      schoolName: baseEntity.schoolName,
      campusName: baseEntity.campusName,
      categoryName: baseEntity.categoryName,
      title: baseEntity.title,
      desc: baseEntity.desc,
      location: `${baseEntity.location1 || ""} ${baseEntity.location2 || ""}`.trim(),
      status: baseEntity.status,
      statusText,
      priorityLevel: baseEntity.priorityLevel,
      priorityText,
      deadline: typeof baseEntity.deadline === "string" ? baseEntity.deadline : new Date(baseEntity.deadline).toISOString(),
      createdAt: typeof baseEntity.createdAt === "string" ? baseEntity.createdAt : new Date(baseEntity.createdAt).toISOString(),
      creator: {
        id: baseEntity.creatorId,
        name: baseEntity.creatorRealName,
        phone: maskPhone(baseEntity.creatorPhone)
      },
      handler: baseEntity.currentHandlerId ? {
        id: baseEntity.currentHandlerId,
        name: baseEntity.handlerRealName || "维修师傅",
        phone: maskPhone(baseEntity.handlerPhone)
      } : null,
      permissions,
      visualPair,
      images: rawImages,
      timeline,
      delayRecordsCount: delayHistory.records ? delayHistory.records.length : 0,
      handleRoundsCount: handleHistory.records ? handleHistory.records.length : 0,
      reviewRoundsCount: reviewHistory.records ? reviewHistory.records.length : 0,
      hasFeedback
    };
  }

  /**
   * 2. 异常废单工单终止作废协议 (终态归档闭环)
   */
  public static async abortPatrol(
    schoolId: number,
    patrolId: number,
    operator: { id: number; role: number; realName?: string },
    dto: IAbortPatrolRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<IAbortPatrolResponseDto> {
    if (!dto.reason || dto.reason.trim().length < 5) {
      throw new Error("PARAM_ERROR: 请至少输入 5 个字符的客观作废原因说明");
    }

    // 2.1 查询当前工单状态
    let patrol: any = PatrolService.getMockPatrol(patrolId);
    if (!patrol && getMySQLPool()) {
      const qRes = await executeQuery(
        `SELECT id, schoolId, status, currentHandlerId, title FROM patrols WHERE id = ? AND schoolId = ? LIMIT 1`,
        [patrolId, schoolId]
      );
      if (qRes.status === 1 && qRes.data && qRes.data.length > 0) {
        patrol = qRes.data[0];
      }
    }

    if (!patrol) {
      throw new Error("PATROL_NOT_FOUND: 目标巡查工单不存在或无权访问");
    }

    if (patrol.schoolId !== schoolId) {
      throw new Error("CROSS_TENANT_FORBIDDEN: 跨校区或跨租户越权拦截");
    }

    const currentStatus = Number(patrol.status);

    // 2.2 终态不可逆约束：已办结 (status >= 3) 禁止作废
    if (currentStatus === 3) {
      throw new Error("CANNOT_ABORT_COMPLETED_PATROL: 已办结或质检合格工单禁止作废归档");
    }
    if (currentStatus === 4) {
      throw new Error("PATROL_ALREADY_ABORTED: 当前工单已处于作废终态");
    }

    // 2.3 作废发起权限仲裁：主管/管理员 (role >= 3) 或 当前接单施工师傅 (status === 1)
    const isAdmin = operator.role >= 3;
    const isCurrentHandler = currentStatus === 1 && Number(patrol.currentHandlerId) === operator.id;

    if (!isAdmin && !isCurrentHandler) {
      throw new Error("FORBIDDEN_CANNOT_ABORT: 仅后勤管理员或当前接单施工师傅有权申请/执行工单作废");
    }

    // 2.4 更新物理表与测试沙箱状态为 4 (已废弃)
    if (getMySQLPool()) {
      await executeQuery(
        `UPDATE patrols SET status = 4, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [patrolId, schoolId]
      );
    }
    PatrolService.updateMockPatrol(patrolId, { status: 4 as any });

    // 2.5 剔除 Redis SLA 超时监控队列与自动好评定时器
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.zrem(`tenant:${schoolId}:patrol:overdue_sla`, String(patrolId));
        await redis.zrem(`tenant:${schoolId}:patrol:auto_feedback`, String(patrolId));
        await redis.zrem(`school:${schoolId}:patrol:zset:auto_feedback`, String(patrolId));
      } catch {
        // 容错降级
      }
    }

    // 2.6 穿透协同聊天室：向 M25 会话注入关闭卡片并封存会话
    await this.injectAbortChatNotice(schoolId, patrolId, dto.reason.trim());

    // 2.7 记录审计日志
    await AuditLogger.log(
      schoolId,
      operator.id,
      "PATROL_ABORTED",
      "Patrol",
      clientIp,
      {
        patrolId,
        reason: dto.reason.trim(),
        operatorName: operator.realName || `用户_${operator.id}`,
        previousStatus: currentStatus
      }
    );

    const nowIso = new Date().toISOString();
    return {
      patrolId,
      status: 4,
      statusText: "已废弃",
      abortedAt: nowIso
    };
  }

  /**
   * 内部方法：从 v_patrol_details 只读宽表视图检索或安全回退
   */
  private static async queryVPatrolDetailEntity(
    schoolId: number,
    patrolId: number
  ): Promise<IVPatrolDetailEntity> {
    if (getMySQLPool()) {
      const dbRes = await executeQuery(
        `SELECT * FROM v_patrol_details WHERE schoolId = ? AND patrolId = ? LIMIT 1`,
        [schoolId, patrolId]
      );
      if (dbRes.status === 1 && dbRes.data && dbRes.data.length > 0) {
        const row = dbRes.data[0];
        return {
          patrolId: Number(row.patrolId || row.id),
          orderNo: row.orderNo || `LCU-${patrolId}`,
          schoolId: Number(row.schoolId),
          schoolName: row.schoolName || "高校后勤校区",
          schoolCode: row.schoolCode || "DEMO",
          campusId: Number(row.campusId || 1),
          campusName: row.campusName || "主校区",
          categoryId: Number(row.categoryId || 1),
          categoryName: row.categoryName || "日常报修",
          creatorId: Number(row.creatorId),
          creatorRealName: row.creatorRealName || `师生_${row.creatorId}`,
          creatorPhone: row.creatorPhone || "",
          currentHandlerId: Number(row.currentHandlerId || 0),
          handlerRealName: row.handlerRealName || null,
          handlerPhone: row.handlerPhone || null,
          title: row.title || "报修事项",
          desc: row.desc || "",
          location1: row.location1 || "",
          location2: row.location2 || "",
          status: Number(row.status),
          priorityLevel: Number(row.priorityLevel || 1),
          isPublic: Number(row.isPublic || 1),
          deadline: row.deadline || new Date(Date.now() + 86400000).toISOString(),
          createdAt: row.createdAt || new Date().toISOString(),
          updatedAt: row.updatedAt || new Date().toISOString()
        };
      }
    }

    // 回退内存沙箱提取
    const patrol = PatrolService.getMockPatrol(patrolId);
    if (!patrol) {
      throw new Error("PATROL_NOT_FOUND: 目标巡查工单不存在或无权访问");
    }

    const schoolRes = await SchoolService.getSchoolById(schoolId).catch(() => null);
    const school = schoolRes && schoolRes.data ? schoolRes.data : { name: "示范高校", code: "DEMO_UNIV" };
    const creator = WeChatAuthService.getMockUserById(patrol.creatorId);
    const handler = patrol.currentHandlerId ? WeChatAuthService.getMockUserById(patrol.currentHandlerId) : null;
    const cat = PatrolService.getMockCategoriesMap().get(patrol.categoryId);

    return {
      patrolId: patrol.id,
      orderNo: patrol.orderNo,
      schoolId: patrol.schoolId,
      schoolName: school.name,
      schoolCode: school.code,
      campusId: patrol.campusId,
      campusName: "主校区",
      categoryId: patrol.categoryId,
      categoryName: cat?.name || "综合维修",
      creatorId: patrol.creatorId,
      creatorRealName: creator?.realName || `师生_${patrol.creatorId}`,
      creatorPhone: creator?.phone || "13800000001",
      currentHandlerId: patrol.currentHandlerId || 0,
      handlerRealName: handler?.realName || null,
      handlerPhone: handler?.phone || null,
      title: patrol.title,
      desc: patrol.desc,
      location1: patrol.location1,
      location2: patrol.location2,
      status: patrol.status,
      priorityLevel: patrol.priorityLevel,
      isPublic: patrol.isPublic,
      deadline: patrol.deadline || new Date(Date.now() + 86400000).toISOString(),
      createdAt: patrol.createdAt,
      updatedAt: patrol.updatedAt
    };
  }

  /**
   * 内部方法：构建全景时间轴
   */
  private static buildTimelineNodes(params: {
    baseEntity: IVPatrolDetailEntity;
    delayRecords: any[];
    handleRecords: any[];
    reviewRecords: any[];
    feedbackRecord: any | null;
  }): IPatrolTimelineNodeDto[] {
    const { baseEntity, delayRecords, handleRecords, reviewRecords, feedbackRecord } = params;
    const nodes: IPatrolTimelineNodeDto[] = [];

    // 1. 提报立项节点 (CREATED)
    nodes.push({
      stageKey: "CREATED",
      title: "工单提报立项",
      timestamp: typeof baseEntity.createdAt === "string" ? baseEntity.createdAt : new Date(baseEntity.createdAt).toISOString(),
      operatorName: baseEntity.creatorRealName,
      summaryText: `师生提报隐患工单：${baseEntity.title}`
    });

    // 2. 接单认领节点 (ACCEPTED)
    if (baseEntity.status >= 1 || (baseEntity.currentHandlerId && baseEntity.currentHandlerId > 0)) {
      nodes.push({
        stageKey: "ACCEPTED",
        title: "师傅接单认领",
        timestamp: typeof baseEntity.updatedAt === "string" ? baseEntity.updatedAt : new Date(baseEntity.updatedAt).toISOString(),
        operatorName: baseEntity.handlerRealName || "维修师傅",
        summaryText: "师傅已抢单或接收派工，进入现场抢修阶段"
      });
    }

    // 3. 延期批准节点 (DELAYED)
    for (const d of delayRecords) {
      if (Number(d.status) === 1) { // 1: APPROVED
        nodes.push({
          stageKey: "DELAYED",
          title: "工期顺延批准",
          timestamp: d.reviewedAt || d.createdAt,
          operatorName: d.reviewerName || "后勤管理处",
          summaryText: `批准工期顺延 ${d.delayHours} 小时，新截止时间：${new Date(d.newDeadline).toLocaleString()}`
        });
      }
    }

    // 4. 现场完工交卷节点 (HANDLED)
    for (const h of handleRecords) {
      nodes.push({
        stageKey: "HANDLED",
        title: "现场整改完工",
        timestamp: h.createdAt,
        operatorName: h.handlerName || "维修师傅",
        summaryText: `师傅提交完工实证，施工耗时 ${h.durationHours} 小时：${h.content || "现场修复完毕"}`
      });
    }

    // 5. 质检核验复核节点 (REVIEWED)
    for (const r of reviewRecords) {
      const isPassed = Number(r.isPassed) === 1;
      nodes.push({
        stageKey: "REVIEWED",
        title: isPassed ? "质检合格办结" : "质检不合格驳回",
        timestamp: r.createdAt,
        operatorName: r.reviewerName || "质检专家",
        summaryText: `质检核验意见：${r.remark || (isPassed ? "合格通过" : "驳回返工")}`
      });
    }

    // 6. 师生服务评价节点 (FEEDBACK)
    if (feedbackRecord && (feedbackRecord as any).feedbackId) {
      nodes.push({
        stageKey: "FEEDBACK",
        title: "满意度服务评价",
        timestamp: feedbackRecord.createdAt,
        operatorName: baseEntity.creatorRealName,
        summaryText: `师生完成综合评价：综合 ${feedbackRecord.score} 星，${feedbackRecord.comment || "整体服务满意"}`
      });
    }

    // 7. 工单异常作废节点 (ABORTED)
    if (baseEntity.status === 4) {
      nodes.push({
        stageKey: "ABORTED",
        title: "工单作废关闭",
        timestamp: typeof baseEntity.updatedAt === "string" ? baseEntity.updatedAt : new Date(baseEntity.updatedAt).toISOString(),
        operatorName: "后勤管理处",
        summaryText: "工单已被标记异常作废终结"
      });
    }

    // 按照时间先后升序排序
    nodes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return nodes;
  }

  /**
   * 内部方法：穿透协同聊天室下发作废卡片并锁定只读
   */
  private static async injectAbortChatNotice(
    schoolId: number,
    patrolId: number,
    reason: string
  ): Promise<void> {
    try {
      for (let i = 1; i <= 10000; i++) {
        const room = ChatService.getMockRoom(i);
        if (room && room.schoolId === schoolId && room.patrolId === patrolId) {
          // 下发作废卡片
          await ChatService.sendMessage(schoolId, 0, 9 as any, {
            chatRoomId: room.id,
            type: 2, // 2: 进度卡片
            content: `【工单已认定作废关闭】 作废原因：${reason}`
          });
          // 锁定会话室只读归档
          ChatService.updateMockRoom(room.id, { isClosed: 1 });
          break;
        }
      }

      if (getMySQLPool()) {
        await executeQuery(
          `UPDATE chat_rooms SET isClosed = 1, updatedAt = NOW() WHERE schoolId = ? AND patrolId = ?`,
          [schoolId, patrolId]
        );
      }
    } catch {
      // 容错降级
    }
  }
}
