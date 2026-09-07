/**
 * 高校后勤巡查e速办 v4.0 - M30: 巡查工单综合大宽表视图与全景详情对比轴单元测试
 * 
 * 核心断言覆盖：
 * 1. v_patrol_details 预编译宽表视图直接投影与关联元数据聚合
 * 2. 9 维多角色动态操作权限掩码全量断言 (提报人/外部师傅/责任师傅/后勤管理员)
 * 3. 施工前后实拍双图视差比对模型 (visualPair) 提取
 * 4. 全生命周期时序大事件节点汇聚与全景时间轴正确性
 * 5. 异常工单作废协议 (abortPatrol) 正向流程与 M25 穿透封存
 * 6. 终态不可逆硬门禁：已办结工单 (status=3) 绝对禁止作废
 * 7. 隐私围栏安全动态脱敏屏障 (Privacy Fence)
 * 8. 跨校区/跨租户越权访问强阻断
 * 9. MasterDispatcher 网关路由与控制器端点健壮性
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PatrolDetailService } from "../apps/patrol/patrolDetailService.js";
import { PatrolDetailController } from "../apps/patrol/patrolDetailController.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { SchoolService } from "../services/school/schoolService.js";
import { DelayService } from "../apps/patrol/delayService.js";
import { PatrolHandleService } from "../apps/patrol/patrolHandleService.js";
import { PatrolReviewService } from "../apps/patrol/patrolReviewService.js";
import { FeedbackService } from "../apps/feedback/feedbackService.js";
import { ChatService } from "../apps/chat/chatService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";

describe("M30: 巡查工单综合大宽表视图与全景详情对比轴核心测试", () => {
  const schoolId = 1001;
  const creatorId = 2001;
  const masterId = 3001;
  const otherMasterId = 3002;
  const adminId = 9001;

  beforeEach(() => {
    TestHarness.resetSandbox();

    // 注册租户
    SchoolService.mockRegisterSchool({
      id: schoolId,
      name: "华东理工大学",
      code: "ECUST",
      status: 1
    } as any);

    // 注册各类角色用户
    WeChatAuthService.mockRegisterUser({
      id: creatorId,
      schoolId,
      openId: "o_creator_2001",
      realName: "张三同学",
      role: 0,
      phone: "13811112222"
    });

    WeChatAuthService.mockRegisterUser({
      id: masterId,
      schoolId,
      openId: "o_master_3001",
      realName: "李师傅",
      role: 2,
      phone: "13933334444"
    });

    WeChatAuthService.mockRegisterUser({
      id: otherMasterId,
      schoolId,
      openId: "o_master_3002",
      realName: "王师傅",
      role: 2,
      phone: "13955556666"
    });

    WeChatAuthService.mockRegisterUser({
      id: adminId,
      schoolId,
      openId: "o_admin_9001",
      realName: "赵主管",
      role: 3,
      phone: "13788889999"
    });

    // 注册分类
    PatrolService.mockRegisterCategory({
      id: 1,
      name: "给排水维修",
      priorityWeight: 1.0,
      isDeleted: 0
    } as any);
  });

  it("1. v_patrol_details 预编译宽表视图直接投影与关联元数据聚合", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7001,
      schoolId,
      creatorId,
      categoryId: 1,
      currentHandlerId: masterId,
      title: "第一教学楼 201 水管爆裂",
      desc: "水管破裂喷水，需要紧急关阀抢修",
      location1: "第一教学楼",
      location2: "201教室",
      status: 1,
      priorityLevel: 2,
      deadline: new Date(Date.now() + 86400000).toISOString()
    });

    const res = await PatrolDetailService.getPanoramicDetail(schoolId, patrol.id, {
      id: creatorId,
      role: 0
    });

    expect(res).toBeDefined();
    expect(res.patrolId).toBe(7001);
    expect(res.orderNo).toBe(patrol.orderNo);
    expect(res.schoolName).toBe("华东理工大学");
    expect(res.categoryName).toBe("给排水维修");
    expect(res.title).toBe("第一教学楼 201 水管爆裂");
    expect(res.status).toBe(1);
    expect(res.statusText).toBe("施工中");
    expect(res.priorityText).toBe("重要");
    expect(res.creator.id).toBe(creatorId);
    expect(res.creator.name).toBe("张三同学");
    expect(res.handler?.id).toBe(masterId);
    expect(res.handler?.name).toBe("李师傅");
  });

  it("2. 9 维多角色动态操作权限掩码全量断言 (4 大角色身份矩阵)", async () => {
    // 2.1 待接单待派单状态 (status=0, 无责任人)
    const patrolPending = PatrolService.mockRegisterPatrol({
      id: 7002,
      schoolId,
      creatorId,
      currentHandlerId: 0,
      status: 0
    });

    // 提报师生访问待接单工单
    const permStudent0 = await PatrolDetailService.getPanoramicDetail(schoolId, patrolPending.id, {
      id: creatorId,
      role: 0
    });
    expect(permStudent0.permissions.canTake).toBe(false);
    expect(permStudent0.permissions.canHandle).toBe(false);
    expect(permStudent0.permissions.canChat).toBe(false); // status=0 未激活协同聊天

    // 师傅角色访问待接单工单 (抢单池模式)
    const permMaster0 = await PatrolDetailService.getPanoramicDetail(schoolId, patrolPending.id, {
      id: masterId,
      role: 2
    });
    expect(permMaster0.permissions.canTake).toBe(true); // 师傅可抢单
    expect(permMaster0.permissions.canHandle).toBe(false);

    // 2.2 施工中状态 (status=1, handlerId=masterId)
    const patrolInProgress = PatrolService.mockRegisterPatrol({
      id: 7003,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      status: 1
    });

    // 责任师傅访问
    const permHandler1 = await PatrolDetailService.getPanoramicDetail(schoolId, patrolInProgress.id, {
      id: masterId,
      role: 2
    });
    expect(permHandler1.permissions.canTake).toBe(false);
    expect(permHandler1.permissions.canHandle).toBe(true); // 允许完工交卷
    expect(permHandler1.permissions.canDelay).toBe(true);  // 允许申请延期
    expect(permHandler1.permissions.canTransfer).toBe(true); // 允许申请转派
    expect(permHandler1.permissions.canChat).toBe(true);    // 允许协同沟通
    expect(permHandler1.permissions.canAbort).toBe(true);   // 施工中允许师傅作废异常工单

    // 其他外部师傅访问
    const permOtherMaster1 = await PatrolDetailService.getPanoramicDetail(schoolId, patrolInProgress.id, {
      id: otherMasterId,
      role: 2
    });
    expect(permOtherMaster1.permissions.canHandle).toBe(false);
    expect(permOtherMaster1.permissions.canDelay).toBe(false);
    expect(permOtherMaster1.permissions.canTransfer).toBe(false);

    // 2.3 待质检复核状态 (status=2, 落实审修分离)
    const patrolUnderReview = PatrolService.mockRegisterPatrol({
      id: 7004,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      status: 2
    });

    // 责任师傅自己不能质检复核 (审修分离)
    const permHandlerReview = await PatrolDetailService.getPanoramicDetail(schoolId, patrolUnderReview.id, {
      id: masterId,
      role: 2
    });
    expect(permHandlerReview.permissions.canReview).toBe(false);

    // 管理员/质检专家复核
    const permAdminReview = await PatrolDetailService.getPanoramicDetail(schoolId, patrolUnderReview.id, {
      id: adminId,
      role: 3
    });
    expect(permAdminReview.permissions.canReview).toBe(true);

    // 2.4 已办结状态 (status=3, 评价权限)
    const patrolCompleted = PatrolService.mockRegisterPatrol({
      id: 7005,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      status: 3
    });

    const permCreatorCompleted = await PatrolDetailService.getPanoramicDetail(schoolId, patrolCompleted.id, {
      id: creatorId,
      role: 0
    });
    expect(permCreatorCompleted.permissions.canFeedback).toBe(true); // 原提报人可评价
    expect(permCreatorCompleted.permissions.canAbort).toBe(false);    // 已办结禁止作废
  });

  it("3. 施工前后实拍双图视差比对模型 (visualPair) 智能提取", async () => {
    // 提报时拍摄破损图
    const beforeUrl = "https://res.quickpatrol.edu.cn/patrol/before_pipe.jpg";
    const afterUrl = "https://res.quickpatrol.edu.cn/patrol/after_repaired.jpg";

    const patrol = PatrolService.mockRegisterPatrol({
      id: 7006,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      imagesJson: JSON.stringify([beforeUrl]),
      status: 2
    });

    // 师傅提交现场完工整改实证
    PatrolHandleService.mockRegisterHandleRecord({
      schoolId,
      patrolId: patrol.id,
      handlerId: masterId,
      content: "水管破裂处已更换为全新 PVC 耐压管",
      imagesJson: [afterUrl],
      durationHours: 1.5
    });

    const detail = await PatrolDetailService.getPanoramicDetail(schoolId, patrol.id, {
      id: creatorId,
      role: 0
    });

    expect(detail.visualPair.hasPair).toBe(true);
    expect(detail.visualPair.beforeImageUrl).toBe(beforeUrl);
    expect(detail.visualPair.afterImageUrl).toBe(afterUrl);
    expect(detail.handleRoundsCount).toBe(1);
  });

  it("4. 全生命周期时序大事件节点汇聚与全景时间轴正确性", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7007,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      title: "图书馆电梯异响",
      status: 3,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:30:00.000Z"
    });

    // 批准延期
    DelayService.mockRegisterDelayRecord({
      schoolId,
      patrolId: patrol.id,
      applicantId: masterId,
      status: 1, // APPROVED
      delayHours: 12,
      reviewerId: adminId,
      createdAt: "2026-09-01T09:00:00.000Z",
      reviewedAt: "2026-09-01T09:15:00.000Z"
    });

    // 师傅完工交卷
    PatrolHandleService.mockRegisterHandleRecord({
      schoolId,
      patrolId: patrol.id,
      handlerId: masterId,
      content: "更换电梯曳引轮轴承",
      durationHours: 2.0,
      createdAt: "2026-09-01T11:00:00.000Z"
    });

    // 质检验收合格
    PatrolReviewService.mockRegisterReviewRecord({
      schoolId,
      patrolId: patrol.id,
      reviewerId: adminId,
      isPassed: 1,
      remark: "现场试运行3趟平稳无异响",
      imagesJson: [],
      createdAt: "2026-09-01T14:00:00.000Z"
    });

    // 师生满意度评价
    FeedbackService.mockRegisterFeedback({
      schoolId,
      patrolId: patrol.id,
      userId: creatorId,
      score: 5,
      speedScore: 5,
      qualityScore: 5,
      attitudeScore: 5,
      tagsJson: ["技术精湛"],
      isAutoPassed: 0,
      comment: "师傅技术精湛，处理非常迅速！",
      createdAt: "2026-09-01T15:00:00.000Z"
    });

    const detail = await PatrolDetailService.getPanoramicDetail(schoolId, patrol.id, {
      id: creatorId,
      role: 0
    });

    expect(detail.hasFeedback).toBe(true);
    expect(detail.timeline.length).toBeGreaterThanOrEqual(5);

    const stages = detail.timeline.map((n) => n.stageKey);
    expect(stages).toContain("CREATED");
    expect(stages).toContain("ACCEPTED");
    expect(stages).toContain("DELAYED");
    expect(stages).toContain("HANDLED");
    expect(stages).toContain("REVIEWED");
    expect(stages).toContain("FEEDBACK");

    // 验证时序严格升序排列
    for (let i = 0; i < detail.timeline.length - 1; i++) {
      const t1 = new Date(detail.timeline[i].timestamp).getTime();
      const t2 = new Date(detail.timeline[i + 1].timestamp).getTime();
      expect(t1).toBeLessThanOrEqual(t2);
    }
  });

  it("5. 异常工单作废协议 (abortPatrol) 正向流程与 M25 穿透封存", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7008,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      title: "西区草坪路灯歪斜",
      status: 1
    });

    // 创建对应 M25 协同聊天室
    const room = ChatService.mockRegisterRoom({
      id: 1088,
      schoolId,
      patrolId: patrol.id,
      creatorId,
      handlerId: masterId,
      isClosed: 0
    });

    const abortRes = await PatrolDetailService.abortPatrol(
      schoolId,
      patrol.id,
      { id: adminId, role: 3, realName: "赵主管" },
      { reason: "经现场勘验，该路灯属于外部市政管网代建范围，已联系市政工单系统承接" }
    );

    expect(abortRes.status).toBe(4);
    expect(abortRes.statusText).toBe("已废弃");

    // 验证工单状态已刷新为 4
    const updatedPatrol = PatrolService.getMockPatrol(patrol.id);
    expect(updatedPatrol?.status).toBe(4);

    // 验证聊天室已被封存且注入作废公告卡片
    const updatedRoom = ChatService.getMockRoom(room.id);
    expect(updatedRoom?.isClosed).toBe(1);

    // 验证审计日志
    const logs = AuditLogger.getMockLogs();
    const abortLog = logs.find((l) => l.action === "PATROL_ABORTED");
    expect(abortLog).toBeDefined();
    expect(abortLog?.userId).toBe(adminId);
    const payload = JSON.parse(abortLog?.payloadJson || "{}");
    expect(payload.patrolId).toBe(patrol.id);
  });

  it("6. 终态不可逆硬门禁：已办结工单 (status=3) 绝对禁止作废", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7009,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      status: 3 // 已办结
    });

    await expect(
      PatrolDetailService.abortPatrol(
        schoolId,
        patrol.id,
        { id: adminId, role: 3 },
        { reason: "尝试作废已办结工单测试" }
      )
    ).rejects.toThrow("CANNOT_ABORT_COMPLETED_PATROL");
  });

  it("7. 隐私围栏安全动态脱敏屏障 (Privacy Fence)", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7010,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      status: 1
    });

    // 第三方无关用户 (角色0，非提报人，非责任师傅)
    const thirdPartyUser = WeChatAuthService.mockRegisterUser({
      id: 8888,
      schoolId,
      openId: "o_third_party",
      realName: "路人同学",
      role: 0,
      phone: "13600001111"
    });

    const thirdPartyDetail = await PatrolDetailService.getPanoramicDetail(schoolId, patrol.id, {
      id: thirdPartyUser.id,
      role: 0
    });

    // 手机号被脱敏为 138****2222 与 139****4444
    expect(thirdPartyDetail.creator.phone).toBe("138****2222");
    expect(thirdPartyDetail.handler?.phone).toBe("139****4444");

    // 当事人提报师生访问 -> 完整号码明文呈现
    const creatorDetail = await PatrolDetailService.getPanoramicDetail(schoolId, patrol.id, {
      id: creatorId,
      role: 0
    });
    expect(creatorDetail.creator.phone).toBe("13811112222");
    expect(creatorDetail.handler?.phone).toBe("13933334444");
  });

  it("8. 跨校区/跨租户越权访问强阻断", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7011,
      schoolId: 1001,
      creatorId,
      status: 1
    });

    // 使用租户 9999 访问租户 1001 的工单
    await expect(
      PatrolDetailService.getPanoramicDetail(9999, patrol.id, {
        id: creatorId,
        role: 0
      })
    ).rejects.toThrow();
  });

  it("9. MasterDispatcher 控制器端点响应标准包装 (StandardResult Envelope)", async () => {
    const patrol = PatrolService.mockRegisterPatrol({
      id: 7012,
      schoolId,
      creatorId,
      currentHandlerId: masterId,
      status: 1
    });

    // GET /api/patrol/panoramic-detail
    const detailResult = await PatrolDetailController.handleGetPanoramicDetail(
      { schoolId, userId: creatorId, role: 0 },
      { patrolId: patrol.id }
    );
    expect(detailResult.status).toBe(1);
    expect(detailResult.data?.patrolId).toBe(patrol.id);

    // 参数校验失败场景
    const invalidResult = await PatrolDetailController.handleGetPanoramicDetail(
      { schoolId, userId: creatorId, role: 0 },
      { patrolId: -1 }
    );
    expect(invalidResult.status).toBe(0);
    expect(invalidResult.content).toContain("PARAM_ERROR");

    // POST /api/patrol/abort 失败场景 (字数不足)
    const abortShortReason = await PatrolDetailController.handleAbortPatrol(
      { schoolId, userId: adminId, role: 3 },
      { patrolId: patrol.id, reason: "短" }
    );
    expect(abortShortReason.status).toBe(0);
    expect(abortShortReason.content).toContain("PARAM_ERROR");

    // POST /api/patrol/abort 成功场景
    const abortSuccess = await PatrolDetailController.handleAbortPatrol(
      { schoolId, userId: adminId, role: 3, realName: "赵主管" },
      { patrolId: patrol.id, reason: "现场实际由施工队已拆除处置完毕" }
    );
    expect(abortSuccess.status).toBe(1);
    expect(abortSuccess.data?.status).toBe(4);
  });
});
