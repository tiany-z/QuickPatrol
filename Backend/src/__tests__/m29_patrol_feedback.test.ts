/**
 * M29: 满意度五星评价与超时自动好评结案专项单元测试套件
 * (Student Feedback & Auto-Settlement Test Suite)
 * 
 * 核心测试矩阵：
 * 1. M29-01: 提报人唯一评价权限硬隔离门禁 (非提报人代评冒评 100% 物理拦截)
 * 2. M29-02: 工单状态前置硬门禁校验 (未办结 status < 3 工单严禁提前评价)
 * 3. M29-03: 提报人合法提交四维评分与评语 DFA 脱敏清洗 (score, subScores, comment, tags)
 * 4. M29-04: 单单唯一性防刷与防重机制断言 (重复提交触发唯一索引拦截)
 * 5. M29-05: 低星差评 (score <= 2) 熔断预警与 24h 科室回访督办留痕
 * 6. M29-06: 基于 Redis ZSET 的 7 天超时自动全五星好评代结断言 (isAutoPassed=1, userId=0)
 * 7. M29-07: 穿透 M25 聊天室下发致谢卡片与会话终局锁定 (广播卡片并置 isClosed=1)
 * 8. M29-08: 师傅个人口碑档案与星级画像聚合推导 (平均分, 维度雷达, NPS 指数, Top 标签)
 * 9. M29-09: MasterDispatcher 网关路由端点与参数校验断言 (/api/patrol/feedback/*)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { FeedbackService } from "../apps/feedback/feedbackService.js";
import { FeedbackController } from "../apps/feedback/feedbackController.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { ChatService } from "../apps/chat/chatService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import { ContentSanitizer } from "../apps/feedback/contentSanitizer.js";

// API 路由端点
import { api as submitApi } from "../api/patrol/feedback/submit/index.js";
import { api as detailApi } from "../api/patrol/feedback/detail/index.js";
import { api as masterReputationApi } from "../api/patrol/feedback/master-reputation/index.js";

describe("M29: 满意度五星评价与超时自动好评结案 (Patrol Feedback & Auto-Settlement)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M29-01: 提报人唯一评价权限硬隔离门禁 - 非原提报师生代评冒评 100% 物理拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 预置已办结工单 (status = 3)，提报人为小明 (userId = 8001)，责任师傅为 1024
    PatrolService.mockRegisterPatrol({
      id: 9501,
      schoolId: sId,
      title: "宿舍阳台纱窗破损修补",
      status: 3,
      creatorId: 8001,
      currentHandlerId: 1024,
      orderNo: "LCU-FEEDBACK-01"
    });

    // 冒充者路人 (8002) 尝试打分 -> 物理阻断
    await expect(
      FeedbackService.submitFeedback(sId, 9501, 8002, {
        score: 5,
        comment: "路人代评测试"
      })
    ).rejects.toThrow("FORBIDDEN_NOT_CREATOR: 权限不足，只有工单原提报师生有权对维修服务进行打分");

    // 师傅自身 (1024) 尝试给自己刷好评 -> 物理阻断
    await expect(
      FeedbackService.submitFeedback(sId, 9501, 1024, {
        score: 5,
        comment: "师傅自己刷好评"
      })
    ).rejects.toThrow("FORBIDDEN_NOT_CREATOR");
  });

  it("M29-02: 工单状态前置硬门禁校验 - 未结案 (status < 3) 工单严禁提前评价", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 1. 待派单工单 (status = 0)
    PatrolService.mockRegisterPatrol({
      id: 9502,
      schoolId: sId,
      title: "水暖管道滴漏",
      status: 0,
      creatorId: 8002
    });

    await expect(
      FeedbackService.submitFeedback(sId, 9502, 8002, { score: 5 })
    ).rejects.toThrow("STATUS_CONFLICT: 工单尚未由质检人员办结复核(当前状态:0)，暂不可评价");

    // 2. 施工中工单 (status = 1)
    PatrolService.updateMockPatrol(9502, { status: 1 });
    await expect(
      FeedbackService.submitFeedback(sId, 9502, 8002, { score: 5 })
    ).rejects.toThrow("STATUS_CONFLICT: 工单尚未由质检人员办结复核(当前状态:1)，暂不可评价");

    // 3. 已整改待复核工单 (status = 2) - 质检专家尚未核验通过前严禁偷跑评价
    PatrolService.updateMockPatrol(9502, { status: 2 });
    await expect(
      FeedbackService.submitFeedback(sId, 9502, 8002, { score: 5 })
    ).rejects.toThrow("STATUS_CONFLICT: 工单尚未由质检人员办结复核(当前状态:2)，暂不可评价");
  });

  it("M29-03: 提报人合法提交四维评分与评语 DFA 脱敏清洗 - 四维打分、标签云与辱骂过滤", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 3 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9503,
      schoolId: sId,
      title: "自习室空调制冷失效",
      status: 3,
      creatorId: 8003,
      currentHandlerId: 1024
    });

    // 提交包含敏感辱骂词汇的评语
    const res = await FeedbackService.submitFeedback(sId, 9503, 8003, {
      score: 5,
      speedScore: 4,
      qualityScore: 5,
      attitudeScore: 4,
      comment: "师傅技术精湛，但是上次那个废物师傅真的傻逼，今天这个师傅很棒！",
      tags: ["技术精湛", "上门神速", "礼貌热心"]
    });

    // 1. 断言提交结果
    expect(res.feedbackId).toBeGreaterThan(0);
    expect(res.patrolId).toBe(9503);
    expect(res.effectiveScore).toBe(5);
    expect(res.isNegativeAlertTriggered).toBe(false);

    // 2. 断言 DFA 脱敏清洗效果 (傻逼与废物被替换为等长星号)
    const detail = await FeedbackService.getFeedbackDetail(sId, 9503);
    expect(detail).not.toBeNull();
    expect(detail?.score).toBe(5);
    expect(detail?.speedScore).toBe(4);
    expect(detail?.qualityScore).toBe(5);
    expect(detail?.attitudeScore).toBe(4);
    expect(detail?.comment).not.toContain("傻逼");
    expect(detail?.comment).not.toContain("废物");
    expect(detail?.comment).toContain("**");
    expect(detail?.tags).toEqual(["技术精湛", "上门神速", "礼貌热心"]);
    expect(detail?.isAutoPassed).toBe(false);

    // 3. DFA 独立单测验证
    const filtered = ContentSanitizer.filterText("你这个死全家的垃圾师傅真草泥马");
    expect(filtered.hasVulgar).toBe(true);
    expect(filtered.cleanText).not.toContain("死全家");
    expect(filtered.cleanText).not.toContain("草泥马");
  });

  it("M29-04: 单单唯一性防刷与防重机制断言 - 重复提交同一工单评价被物理拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 4 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9504,
      schoolId: sId,
      title: "教学楼多媒体投影仪故障",
      status: 3,
      creatorId: 8004
    });

    // 第一次提交评价成功
    const firstRes = await FeedbackService.submitFeedback(sId, 9504, 8004, {
      score: 5,
      comment: "维修很及时"
    });
    expect(firstRes.feedbackId).toBeGreaterThan(0);

    // 第二次重复提交同一工单 -> 触发唯一键拦截
    await expect(
      FeedbackService.submitFeedback(sId, 9504, 8004, {
        score: 4,
        comment: "想修改打分"
      })
    ).rejects.toThrow("FEEDBACK_ALREADY_EXISTS: 该工单服务已完成评价，严禁重复提交");
  });

  it("M29-05: 低星差评 (score <= 2) 熔断预警与 24h 科室回访督办留痕", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 5 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9505,
      schoolId: sId,
      title: "宿舍洗手间淋浴花洒喷头脱落",
      status: 3,
      creatorId: 8005,
      currentHandlerId: 1025
    });

    // 提报人给出 1 星差评
    const res = await FeedbackService.submitFeedback(sId, 9505, 8005, {
      score: 1,
      speedScore: 1,
      qualityScore: 1,
      attitudeScore: 2,
      comment: "迟到了三小时，态度极差，修完当天晚上又掉下来了！"
    });

    expect(res.effectiveScore).toBe(1);
    expect(res.isNegativeAlertTriggered).toBe(true);

    // 验证审计日志已留痕差评熔断告警 (NEGATIVE_FEEDBACK_ALERT)
    const logs = AuditLogger.getMockLogs();
    const alertLog = logs.find(
      (l) => l.action === "NEGATIVE_FEEDBACK_ALERT" && l.schoolId === sId
    );
    expect(alertLog).toBeDefined();
    expect(alertLog?.module).toBe("patrols");
  });

  it("M29-06: 基于 Redis ZSET 的 7 天超时自动全五星好评代结断言 - isAutoPassed=1 与 userId=0", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 6 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9506,
      schoolId: sId,
      title: "走廊应急疏散指示灯不亮",
      status: 3,
      creatorId: 8006,
      currentHandlerId: 1026
    });

    // 模拟后台 7 天超时守护进程自动触发结案
    await FeedbackService.executeAutoFeedbackSettlement(sId, 9506);

    // 查验生成结果
    const detail = await FeedbackService.getFeedbackDetail(sId, 9506);
    expect(detail).not.toBeNull();
    expect(detail?.score).toBe(5);
    expect(detail?.speedScore).toBe(5);
    expect(detail?.qualityScore).toBe(5);
    expect(detail?.attitudeScore).toBe(5);
    expect(detail?.evaluatorId).toBe(0); // 系统自动代结
    expect(detail?.evaluatorName).toBe("系统自动结案");
    expect(detail?.isAutoPassed).toBe(true);
    expect(detail?.comment).toContain("超时未评，系统默认全五星好评");

    // 重复执行代结应安全幂等放行
    await FeedbackService.executeAutoFeedbackSettlement(sId, 9506);
  });

  it("M29-07: 穿透 M25 聊天室下发致谢卡片与会话终局锁定 - 广播进度卡片并置 isClosed=1", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 7 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9507,
      schoolId: sId,
      title: "计算机机房地插脱落",
      status: 3,
      creatorId: 8007,
      currentHandlerId: 1027
    });

    // 预置工单对应 M25 聊天室
    const room = ChatService.mockRegisterRoom({
      schoolId: sId,
      patrolId: 9507,
      creatorId: 8007,
      handlerId: 1027,
      initiatedByHandler: 1,
      isClosed: 0,
      creatorUnreadCount: 0,
      handlerUnreadCount: 0,
      createdAt: new Date().toISOString()
    });

    // 师生提交 5 星评价
    await FeedbackService.submitFeedback(sId, 9507, 8007, {
      score: 5,
      comment: "地插固定很牢固，测试通电完全正常，感谢师傅！"
    });

    // 1. 验证聊天室已注入致谢卡片 (type = 2)
    const messages = await ChatService.getMessageList(sId, room.id, 0, 10);
    const noticeMsg = messages.find((m) => m.type === 2);
    expect(noticeMsg).toBeDefined();
    expect(noticeMsg?.content).toContain("【师生已完成服务评价】");
    expect(noticeMsg?.content).toContain("★★★★★");
    expect(noticeMsg?.content).toContain("会话已安全归档封存");

    // 2. 验证聊天室状态已变为只读关闭 (isClosed = 1)
    const currentRoom = ChatService.getMockRoom(room.id);
    expect(currentRoom?.isClosed).toBe(1);
  });

  it("M29-08: 师傅个人口碑档案与星级画像聚合推导 - NPS 净推荐值与高频标签统计", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 8 });
    const sId = tenant.schoolId;
    const masterId = 2088;

    // 预置师傅处理的多笔办结工单并打分
    // 工单 1: 5星
    PatrolService.mockRegisterPatrol({ id: 9511, schoolId: sId, currentHandlerId: masterId, status: 3, creatorId: 8101 });
    await FeedbackService.submitFeedback(sId, 9511, 8101, {
      score: 5, speedScore: 5, qualityScore: 5, attitudeScore: 5, tags: ["技术精湛", "上门神速"]
    });

    // 工单 2: 5星
    PatrolService.mockRegisterPatrol({ id: 9512, schoolId: sId, currentHandlerId: masterId, status: 3, creatorId: 8102 });
    await FeedbackService.submitFeedback(sId, 9512, 8102, {
      score: 5, speedScore: 4, qualityScore: 5, attitudeScore: 5, tags: ["技术精湛", "礼貌热心"]
    });

    // 工单 3: 4星
    PatrolService.mockRegisterPatrol({ id: 9513, schoolId: sId, currentHandlerId: masterId, status: 3, creatorId: 8103 });
    await FeedbackService.submitFeedback(sId, 9513, 8103, {
      score: 4, speedScore: 3, qualityScore: 4, attitudeScore: 4, tags: ["技术精湛"]
    });

    // 查询该师傅的口碑画像大盘
    const profile = await FeedbackService.getMasterReputationProfile(sId, masterId);
    expect(profile.masterId).toBe(masterId);
    expect(profile.totalEvaluations).toBe(3);
    // 平均分: (5 + 5 + 4) / 3 = 4.7
    expect(profile.averageScore).toBe(4.7);
    expect(profile.positiveRate).toBe(100); // 3 笔全 >= 4星
    expect(profile.dimensionAverages.quality).toBeGreaterThanOrEqual(4.6);
    expect(profile.topTags.length).toBeGreaterThan(0);
    expect(profile.topTags[0].tag).toBe("技术精湛");
    expect(profile.topTags[0].count).toBe(3);
    // NPS: 2笔5星(promoters), 1笔4星(passives), 0笔<=3星 -> (2 - 0) / 3 * 100 = 67
    expect(profile.nps).toBe(67);
  });

  it("M29-09: MasterDispatcher 网关路由端点与参数校验断言 (/api/patrol/feedback/*)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 29, caseIndex: 9 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9509,
      schoolId: sId,
      title: "第一教学楼水池堵塞",
      status: 3,
      creatorId: 8009,
      currentHandlerId: 1029
    });

    // 1. 未登录鉴权拦截
    const unauthRes = await submitApi.handler(
      { body: { patrolId: 9509, score: 5 }, req: {} as any, query: {} },
      {} as any
    );
    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toContain("无效的高校租户或用户未登录");

    // 2. 正常师生调用 POST /api/patrol/feedback/submit
    const submitRes = await submitApi.handler(
      {
        body: {
          patrolId: 9509,
          score: 5,
          speedScore: 5,
          qualityScore: 5,
          attitudeScore: 5,
          comment: "水池疏通得非常彻底，感谢！",
          tags: ["技术精湛", "现场整洁"]
        },
        req: {} as any,
        query: {}
      },
      {
        schoolId: sId,
        userId: 8009,
        role: 0,
        userPayload: { schoolId: sId, userId: 8009, role: 0 }
      } as any
    );

    expect(submitRes.status).toBe(1);
    expect(submitRes.data.effectiveScore).toBe(5);

    // 3. 调用 GET /api/patrol/feedback/detail 查询评价详情
    const detailRes = await detailApi.handler(
      { query: { patrolId: "9509" }, req: {} as any, body: {} },
      {
        schoolId: sId,
        userId: 8009,
        role: 0,
        userPayload: { schoolId: sId, userId: 8009, role: 0 }
      } as any
    );

    expect(detailRes.status).toBe(1);
    expect(detailRes.data.patrolId).toBe(9509);
    expect(detailRes.data.score).toBe(5);

    // 4. 调用 GET /api/patrol/feedback/master-reputation 查询师傅口碑画像
    const masterRepRes = await masterReputationApi.handler(
      { query: { masterId: "1029" }, req: {} as any, body: {} },
      {
        schoolId: sId,
        userId: 8009,
        role: 0,
        userPayload: { schoolId: sId, userId: 8009, role: 0 }
      } as any
    );

    expect(masterRepRes.status).toBe(1);
    expect(masterRepRes.data.masterId).toBe(1029);

    // 5. 控制器层入参防御校验
    const invalidScoreRes = await FeedbackController.handleSubmitFeedback(
      { schoolId: sId, userId: 8009 },
      { patrolId: 9509, score: 99 as any }
    );
    expect(invalidScoreRes.status).toBe(0);
    expect(invalidScoreRes.content).toContain("PARAM_ERROR: 综合评分必须在 1 至 5 星之间");

    const invalidPatrolRes = await FeedbackController.handleSubmitFeedback(
      { schoolId: sId, userId: 8009 },
      { patrolId: -10, score: 5 }
    );
    expect(invalidPatrolRes.status).toBe(0);
    expect(invalidPatrolRes.content).toContain("PARAM_ERROR: 非法的工单ID");
  });
});
