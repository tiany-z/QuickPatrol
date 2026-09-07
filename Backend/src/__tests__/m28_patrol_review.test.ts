/**
 * M28: 质检复核到场核验与合格/驳回状态机专项单元测试套件
 * (Patrol Review & Inspection State Machine Test Suite)
 * 
 * 核心测试矩阵：
 * 1. M28-01: 审修分离红线硬阻断断言 (施工责任人自检自验被 100% 物理拦截)
 * 2. M28-02: 状态机前置准入硬门禁断言 (非 status=2 待复核工单严禁质检复核)
 * 3. M28-03: 质检角色与权限门禁校验 (仅 role>=3 或持 patrol:review 权限方可裁决)
 * 4. M28-04: 质检驳回理由必填防呆门禁 (驳回必须 >= 5 字符，合格支持默认缺省词)
 * 5. M28-05: 双轨跃迁之合格办结与 7 天超时好评挂载 (2 -> 3，登记结案时间，挂载 auto_feedback 定时器)
 * 6. M28-06: 双轨跃迁之驳回返工与责任人锁定 (2 -> 1，保持责任人不变打回现场重修)
 * 7. M28-07: 1:N 多轮质检流水追溯与审计存证 (驳回返工与二次复核合格全链条审计)
 * 8. M28-08: 师生知情权穿透与 M25 聊天室系统卡片注入断言 (广播 type:2 质检裁决进度卡片)
 * 9. M28-09: MasterDispatcher 网关路由端点与参数校验断言 (/api/patrol/review/*)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PatrolReviewService } from "../apps/patrol/patrolReviewService.js";
import { PatrolReviewController } from "../apps/patrol/patrolReviewController.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { ChatService } from "../apps/chat/chatService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import {
  assertCanReviewPatrol,
  validateReviewRemark,
  verifyReviewImages
} from "../apps/patrol/reviewUtils.js";

// API 路由端点
import { api as submitApi } from "../api/patrol/review/submit/index.js";
import { api as historyApi } from "../api/patrol/review/history/index.js";

describe("M28: 质检复核到场核验与合格/驳回状态机 (Patrol Review & State Machine)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M28-01: 审修分离红线硬阻断断言 - 施工师傅自检自验必须被 100% 物理拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 预置已整改待复核 (status = 2) 工单，责任人为 801
    PatrolService.mockRegisterPatrol({
      id: 9401,
      schoolId: sId,
      title: "宿舍楼外墙水管爆裂抢修",
      status: 2,
      currentHandlerId: 801,
      creatorId: 101,
      orderNo: "LCU-REVIEW-01"
    });

    // 施工责任师傅 (801) 尝试复核自己的工单 -> 触发红线阻断
    await expect(
      PatrolReviewService.submitPatrolReview(
        sId,
        9401,
        { id: 801, role: 3 }, // 纵然具备质检角色，亦因责任人一致被强制拦截
        { isPassed: 1, remark: "我自己修的绝对合格" }
      )
    ).rejects.toThrow("FORBIDDEN_SELF_REVIEW: 审修分离原则：接单施工责任人严禁复核自检自身工单");

    // 工具函数直接断言验证
    expect(() => {
      assertCanReviewPatrol(
        { id: 801, role: 3 },
        { id: 9401, status: 2, currentHandlerId: 801 }
      );
    }).toThrow("FORBIDDEN_SELF_REVIEW");
  });

  it("M28-02: 状态机前置准入硬门禁断言 - 仅 status=2 (已整改待复核) 允许质检复核", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 1. 测试未施工工单 (status = 0: 待派单)
    PatrolService.mockRegisterPatrol({
      id: 9402,
      schoolId: sId,
      title: "配电房开关跳闸",
      status: 0,
      currentHandlerId: null as any,
      creatorId: 102
    });

    await expect(
      PatrolReviewService.submitPatrolReview(
        sId,
        9402,
        { id: 901, role: 3 },
        { isPassed: 1 }
      )
    ).rejects.toThrow("STATUS_CONFLICT: 当前工单状态不可进行质检复核 (当前状态: 0)");

    // 2. 测试正在施工中工单 (status = 1: 进行中)
    PatrolService.updateMockPatrol(9402, { status: 1, currentHandlerId: 802 });
    await expect(
      PatrolReviewService.submitPatrolReview(
        sId,
        9402,
        { id: 901, role: 3 },
        { isPassed: 1 }
      )
    ).rejects.toThrow("STATUS_CONFLICT: 当前工单状态不可进行质检复核 (当前状态: 1)");

    // 3. 测试已结案工单 (status = 3: 已结案)
    PatrolService.updateMockPatrol(9402, { status: 3 });
    await expect(
      PatrolReviewService.submitPatrolReview(
        sId,
        9402,
        { id: 901, role: 3 },
        { isPassed: 1 }
      )
    ).rejects.toThrow("STATUS_CONFLICT: 当前工单状态不可进行质检复核 (当前状态: 3)");
  });

  it("M28-03: 质检角色与权限门禁校验 - 非质检角色且无权限人员严禁复核", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 3 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9403,
      schoolId: sId,
      title: "图书馆消防栓漏水",
      status: 2,
      currentHandlerId: 803,
      creatorId: 103
    });

    // 1. 普通学生 (role = 0)
    await expect(
      PatrolReviewService.submitPatrolReview(
        sId,
        9403,
        { id: 103, role: 0 },
        { isPassed: 1 }
      )
    ).rejects.toThrow("INSUFFICIENT_REVIEW_PERMISSION");

    // 2. 普通其他师傅 (role = 2) 无质检权限
    await expect(
      PatrolReviewService.submitPatrolReview(
        sId,
        9403,
        { id: 804, role: 2 },
        { isPassed: 1 }
      )
    ).rejects.toThrow("INSUFFICIENT_REVIEW_PERMISSION");

    // 3. 宿管/质检主管 (role = 3) 允许复核
    const passRes = await PatrolReviewService.submitPatrolReview(
      sId,
      9403,
      { id: 903, role: 3 },
      { isPassed: 1 }
    );
    expect(passRes.isPassed).toBe(1);
    expect(passRes.newStatus).toBe(3);

    // 4. 普通员工但特批 patrol:review 权限也允许放行
    PatrolService.mockRegisterPatrol({
      id: 9404,
      schoolId: sId,
      title: "教学楼风扇异响",
      status: 2,
      currentHandlerId: 803,
      creatorId: 103
    });

    const permRes = await PatrolReviewService.submitPatrolReview(
      sId,
      9404,
      { id: 105, role: 1, permissions: ["patrol:review"] },
      { isPassed: 1 }
    );
    expect(permRes.isPassed).toBe(1);
    expect(permRes.newStatus).toBe(3);
  });

  it("M28-04: 质检驳回理由必填防呆门禁 - 驳回必须 >= 5 字符，合格缺省支持", async () => {
    // 1. 驳回说明校验测试
    expect(() => validateReviewRemark(0, "")).toThrow("REJECT_REASON_REQUIRED");
    expect(() => validateReviewRemark(0, "不合格")).toThrow("REJECT_REASON_REQUIRED");
    expect(() => validateReviewRemark(0, "   重修   ")).toThrow("REJECT_REASON_REQUIRED");

    // 2. 合法驳回说明 (>= 5 字)
    const validReject = validateReviewRemark(0, "水管接头依然渗水，需重做热熔");
    expect(validReject).toBe("水管接头依然渗水，需重做热熔");

    // 3. 合格说明缺省支持
    expect(validateReviewRemark(1, "")).toBe("质检合格通过");
    expect(validateReviewRemark(1, "   ")).toBe("质检合格通过");
    expect(validateReviewRemark(1, "现场打压测试正常")).toBe("现场打压测试正常");

    // 4. 图片工具函数校验
    expect(verifyReviewImages([])).toEqual([]);
    expect(verifyReviewImages(["  https://oss.edu.cn/img1.jpg  "])).toEqual(["https://oss.edu.cn/img1.jpg"]);
    const overLimit = Array(10).fill("https://oss.edu.cn/img.jpg");
    expect(() => verifyReviewImages(overLimit)).toThrow("最多上传 9 张");
  });

  it("M28-05: 双轨跃迁之合格办结与 7 天超时好评挂载 - status 2 -> 3 并落底表与挂载定时器", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 5 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9405,
      schoolId: sId,
      title: "第一教学楼水池堵塞",
      status: 2,
      currentHandlerId: 805,
      creatorId: 105
    });

    const res = await PatrolReviewService.submitPatrolReview(
      sId,
      9405,
      { id: 905, role: 4 },
      {
        isPassed: 1,
        remark: "现场管道疏通彻底，水流正常",
        images: ["https://oss.campus.edu.cn/review/9405_1.jpg"]
      }
    );

    // 1. 断言响应结果
    expect(res.reviewId).toBeGreaterThan(0);
    expect(res.isPassed).toBe(1);
    expect(res.newStatus).toBe(3); // 跃迁至 3: 已结案待评价
    expect(res.autoFeedbackScheduledAt).toBeDefined();

    // 2. 断言工单主表已更新
    const patrol = PatrolService.getMockPatrol(9405);
    expect(patrol?.status).toBe(3);
    expect(patrol?.completedAt).toBeDefined();

    // 3. 断言 Table 17 patrols_review 成功落库存证
    const reviewRecord = PatrolReviewService.getMockReviewRecord(res.reviewId);
    expect(reviewRecord).toBeDefined();
    expect(reviewRecord?.patrolId).toBe(9405);
    expect(reviewRecord?.isPassed).toBe(1);
    expect(reviewRecord?.reviewerId).toBe(905);
    expect(reviewRecord?.remark).toBe("现场管道疏通彻底，水流正常");
    expect(reviewRecord?.imagesJson).toEqual(["https://oss.campus.edu.cn/review/9405_1.jpg"]);

    // 4. 断言 7 天自动好评定时器挂载 (约等于当前时间 + 7*86400*1000)
    const autoTimer = PatrolReviewService.getMockAutoFeedbackTimer(9405);
    expect(autoTimer).toBeDefined();
    const expectedTime = Date.now() + 7 * 86400 * 1000;
    expect(Math.abs(autoTimer!.scheduledAt - expectedTime)).toBeLessThan(5000);
  });

  it("M28-06: 双轨跃迁之驳回返工与责任人锁定 - status 2 -> 1 且责任人保持不变打回现场返工", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 6 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9406,
      schoolId: sId,
      title: "行政楼洗手间马桶水箱漏水",
      status: 2,
      currentHandlerId: 806, // 责任师傅 806
      creatorId: 106
    });

    const res = await PatrolReviewService.submitPatrolReview(
      sId,
      9406,
      { id: 906, role: 3 },
      {
        isPassed: 0,
        remark: "进水阀依然有慢渗现象，请更换密封胶圈并重新测试",
        images: ["https://oss.campus.edu.cn/review/9406_reject.jpg"]
      }
    );

    // 1. 断言响应结果
    expect(res.isPassed).toBe(0);
    expect(res.newStatus).toBe(1); // 打回至 1: 进行中返工
    expect(res.autoFeedbackScheduledAt).toBeUndefined();

    // 2. 断言工单主表：状态退回 1，责任师傅保持为 806 (严禁被清空或冒领)
    const patrol = PatrolService.getMockPatrol(9406);
    expect(patrol?.status).toBe(1);
    expect(patrol?.currentHandlerId).toBe(806);

    // 3. 断言 Table 17 patrols_review 记录驳回存证
    const reviewRecord = PatrolReviewService.getMockReviewRecord(res.reviewId);
    expect(reviewRecord?.isPassed).toBe(0);
    expect(reviewRecord?.remark).toContain("进水阀依然有慢渗现象");
  });

  it("M28-07: 1:N 多轮质检流水追溯与审计存证 - 驳回返工与二次复核办结全周期历史追溯", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 7 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9407,
      schoolId: sId,
      title: "东区食堂油烟排气管道异响",
      status: 2,
      currentHandlerId: 807,
      creatorId: 107
    });

    // 第一轮：质检到场驳回
    const rejectRes = await PatrolReviewService.submitPatrolReview(
      sId,
      9407,
      { id: 907, role: 3 },
      {
        isPassed: 0,
        remark: "风机叶片积灰未清理干净，运行时震动明显，需彻底清理"
      }
    );
    expect(rejectRes.newStatus).toBe(1);

    // 师傅重新整改完毕，工单再次进入已整改待复核 (status = 2)
    PatrolService.updateMockPatrol(9407, { status: 2 });

    // 第二轮：质检到场合格通过
    const passRes = await PatrolReviewService.submitPatrolReview(
      sId,
      9407,
      { id: 908, role: 4 },
      {
        isPassed: 1,
        remark: "叶片积垢已彻底铲除，二次动平衡测试合格"
      }
    );
    expect(passRes.newStatus).toBe(3);

    // 查询 1:N 全流程质检流水大盘
    const historyRes = await PatrolReviewService.getReviewHistory(sId, 9407);
    expect(historyRes.patrolId).toBe(9407);
    expect(historyRes.totalRounds).toBe(2);
    expect(historyRes.latestStatus).toBe(3);
    expect(historyRes.records.length).toBe(2);

    // 第 1 轮记录：驳回
    expect(historyRes.records[0].isPassed).toBe(0);
    expect(historyRes.records[0].reviewerId).toBe(907);
    expect(historyRes.records[0].remark).toContain("风机叶片积灰未清理干净");

    // 第 2 轮记录：合格
    expect(historyRes.records[1].isPassed).toBe(1);
    expect(historyRes.records[1].reviewerId).toBe(908);
    expect(historyRes.records[1].remark).toContain("动平衡测试合格");

    // 审计日志全量留痕验证
    const mockLogs = AuditLogger.getMockLogs();
    const rejectLog = mockLogs.find(
      (l) => l.action === "PATROL_REVIEW_REJECT" && l.schoolId === sId
    );
    const passLog = mockLogs.find(
      (l) => l.action === "PATROL_REVIEW_PASS" && l.schoolId === sId
    );
    expect(rejectLog).toBeDefined();
    expect(passLog).toBeDefined();
  });

  it("M28-08: 师生知情权穿透与 M25 聊天室卡片注入断言 - 质检裁决自动向工单会话室注入进度卡片", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 8 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9408,
      schoolId: sId,
      title: "实验楼洗眼器水压不足",
      status: 2,
      currentHandlerId: 808,
      creatorId: 108
    });

    // 预置工单对应 M25 聊天室
    const room = ChatService.mockRegisterRoom({
      schoolId: sId,
      patrolId: 9408,
      creatorId: 108,
      handlerId: 808,
      initiatedByHandler: 1,
      isClosed: 0,
      creatorUnreadCount: 0,
      handlerUnreadCount: 0,
      createdAt: new Date().toISOString()
    });

    // 1. 触发驳回 -> 注入驳回返工卡片
    await PatrolReviewService.submitPatrolReview(
      sId,
      9408,
      { id: 908, role: 3 },
      {
        isPassed: 0,
        remark: "出水压力仍低于 0.2MPa，需加装增压泵"
      }
    );

    let messages = await ChatService.getMessageList(sId, room.id, 0, 10);
    expect(messages.length).toBeGreaterThan(0);
    const rejectMsg = messages[messages.length - 1];
    expect(rejectMsg.type).toBe(2); // 2: 工单进度系统卡片
    expect(rejectMsg.content).toContain("【质检复核驳回返工】");
    expect(rejectMsg.content).toContain("出水压力仍低于 0.2MPa");

    // 2. 模拟返工完成并提交复核合格 -> 注入合格卡片
    PatrolService.updateMockPatrol(9408, { status: 2 });
    await PatrolReviewService.submitPatrolReview(
      sId,
      9408,
      { id: 908, role: 3 },
      {
        isPassed: 1,
        remark: "加压泵加装完毕，出水喷射符合国家安全标准"
      }
    );

    messages = await ChatService.getMessageList(sId, room.id, 0, 10);
    const passMsg = messages[messages.length - 1];
    expect(passMsg.type).toBe(2);
    expect(passMsg.content).toContain("【质检复核合格】");
  });

  it("M28-09: MasterDispatcher 网关路由端点与参数校验断言 (/api/patrol/review/*)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 28, caseIndex: 9 });
    const sId = tenant.schoolId;

    PatrolService.mockRegisterPatrol({
      id: 9409,
      schoolId: sId,
      title: "校园路灯不亮",
      status: 2,
      currentHandlerId: 809,
      creatorId: 109
    });

    // 1. POST /api/patrol/review/submit 未登录校验
    const unauthRes = await submitApi.handler(
      { body: { patrolId: 9409, isPassed: 1 }, req: {} as any, query: {} },
      {} as any
    );
    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toContain("无效的高校租户或用户未登录");

    // 2. POST /api/patrol/review/submit 质检复核人员登录提交
    const validSubmitRes = await submitApi.handler(
      {
        body: {
          patrolId: 9409,
          isPassed: 1,
          remark: "路灯电缆已更换，夜间照明正常",
          images: ["https://oss.campus.edu.cn/review/light.jpg"]
        },
        req: {} as any,
        query: {}
      },
      {
        schoolId: sId,
        userId: 909,
        role: 3,
        userPayload: { schoolId: sId, userId: 909, role: 3 }
      } as any
    );

    expect(validSubmitRes.status).toBe(1);
    expect(validSubmitRes.data.isPassed).toBe(1);
    expect(validSubmitRes.data.newStatus).toBe(3);

    // 3. GET /api/patrol/review/history 查询历史流水
    const historyRes = await historyApi.handler(
      { query: { patrolId: "9409" }, req: {} as any, body: {} },
      {
        schoolId: sId,
        userId: 909,
        role: 3,
        userPayload: { schoolId: sId, userId: 909, role: 3 }
      } as any
    );

    expect(historyRes.status).toBe(1);
    expect(historyRes.data.patrolId).toBe(9409);
    expect(historyRes.data.totalRounds).toBe(1);
    expect(historyRes.data.records[0].remark).toContain("路灯电缆已更换");

    // 4. 控制器层非法参数校验
    const invalidParamRes = await PatrolReviewController.handleSubmitPatrolReview(
      { schoolId: sId, userId: 909, role: 3 },
      { patrolId: -1, isPassed: 1 }
    );
    expect(invalidParamRes.status).toBe(0);
    expect(invalidParamRes.content).toContain("PARAM_ERROR: 非法的工单ID");

    const invalidPassedRes = await PatrolReviewController.handleSubmitPatrolReview(
      { schoolId: sId, userId: 909, role: 3 },
      { patrolId: 9409, isPassed: 99 as any }
    );
    expect(invalidPassedRes.status).toBe(0);
    expect(invalidPassedRes.content).toContain("PARAM_ERROR: isPassed 必须指定为 0 (驳回) 或 1 (合格)");
  });
});
