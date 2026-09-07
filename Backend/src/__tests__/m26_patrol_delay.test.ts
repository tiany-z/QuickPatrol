/**
 * M26: 多次动态延期申请与多级审批流专项单元测试套件
 * (Patrol Delay Approval & Lifecycle Extension Test Suite)
 * 
 * 核心测试矩阵：
 * 1. M26-01: 身份归属与状态门禁校验 (非责任人拦截、非施工中拦截、参数范围阻断)
 * 2. M26-02: 单工单在审唯一性与排他互斥门禁 (重复提交待审记录被 100% 物理拦截)
 * 3. M26-03: 截止时限顺延累加动力学模型 (未逾期无损累加、已逾期基准重置起跑线)
 * 4. M26-04: 累计延期次数与工期多级审批升格拦截 (超48h/二次审批升级至处长、超限硬熔断)
 * 5. M26-05: 管理员驳回延期流转与状态保持 (驳回工期不漂移、解除互斥锁允许重提)
 * 6. M26-06: 师生知情权闭环与 M25 聊天室进度卡片穿透 (审批后向工单会话室注入 type:2 卡片)
 * 7. M26-07: 全量延期流水聚合与管理端大盘查询 (聚合指标精确核算、待审大盘拉取)
 * 8. M26-08: API 路由端点与 MasterDispatcher 网关调度验证 (/api/patrol/delay/*)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { DelayService } from "../apps/patrol/delayService.js";
import { DelayController } from "../apps/patrol/delayController.js";
import { calculateNewDeadline, evaluateRequiredRole } from "../apps/patrol/delayAlgorithm.js";
import { PatrolDelayStatusEnum } from "../apps/patrol/delayTypes.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { ChatService } from "../apps/chat/chatService.js";

// API 路由端点
import { api as applyApi } from "../api/patrol/delay/apply/index.js";
import { api as reviewApi } from "../api/patrol/delay/review/index.js";
import { api as historyApi } from "../api/patrol/delay/history/index.js";
import { api as pendingApi } from "../api/patrol/delay/pending/index.js";

describe("M26: 多次动态延期申请与多级审批流 (Patrol Delay Approval & Lifecycle Extension)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M26-01: 身份归属与状态门禁校验 - 仅接单师傅在施工中状态下方可发起延期", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 预置处于“待派单”状态 (status = 0) 的工单
    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9101, ?, 1, 1, 'LCU-DELAY-01', 101, 801, '水龙头损坏', '待修', 0)",
      [sId]
    );

    // 1.1 尝试在未接单/非进行中状态下发起延期 -> 抛出 INVALID_PATROL_STATUS
    await expect(
      DelayService.createDelayApply(sId, 9101, 801, {
        patrolId: 9101,
        delayHours: 24,
        reason: "现场需要采购新的水龙头阀芯"
      })
    ).rejects.toThrow("仅处理中的工单可申请延期");

    // 2. 将工单变更为“进行中” (status = 1)
    PatrolService.updateMockPatrol(9101, { status: 1 });

    // 2.1 非责任人师傅 (899 != 801) 尝试申请延期 -> 抛出 FORBIDDEN_NOT_CURRENT_HANDLER
    await expect(
      DelayService.createDelayApply(sId, 9101, 899, {
        patrolId: 9101,
        delayHours: 24,
        reason: "现场需要采购配件，顺延一天"
      })
    ).rejects.toThrow("只有当前接单责任人有权发起延期申请");

    // 2.2 延期时长非法 (超出 1~168 范围)
    await expect(
      DelayService.createDelayApply(sId, 9101, 801, {
        patrolId: 9101,
        delayHours: 200,
        reason: "需要大修停工一周以上"
      })
    ).rejects.toThrow("申请顺延时长须在 1~168 小时之间");

    // 2.3 理由过短 (少于 5 字符)
    await expect(
      DelayService.createDelayApply(sId, 9101, 801, {
        patrolId: 9101,
        delayHours: 24,
        reason: "坏了"
      })
    ).rejects.toThrow("请至少输入 5 个字符的客观原因说明");
  });

  it("M26-02: 单工单在审唯一性与排他互斥门禁 - 待审记录存在时禁止重复提交", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 2 });
    const sId = tenant.schoolId;

    const baseDeadline = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status, deadline) VALUES (9102, ?, 1, 1, 'LCU-DELAY-02', 102, 802, '排污管阻塞', '急修', 1, ?)",
      [sId, baseDeadline]
    );

    // 1. 师傅 802 第一次提交延期申请 -> 成功
    const applyRes = await DelayService.createDelayApply(sId, 9102, 802, {
      patrolId: 9102,
      delayHours: 24,
      reason: "需要疏通车进场作业，现场路段狭窄需协调保卫处"
    });
    expect(applyRes.applyId).toBeGreaterThan(0);
    expect(applyRes.status).toBe(PatrolDelayStatusEnum.PENDING);

    // 2. 在第一笔申请尚未审批前，师傅 802 再次提交延期申请 -> 必须被拦截阻断
    await expect(
      DelayService.createDelayApply(sId, 9102, 802, {
        patrolId: 9102,
        delayHours: 12,
        reason: "疏通车预约排期冲突，申请再次顺延"
      })
    ).rejects.toThrow("PENDING_DELAY_EXISTS");
  });

  it("M26-03: 截止时限顺延累加动力学模型 - 准确处理未超时累加与逾期重置起跑线", () => {
    const nowMs = 1772841600000; // 假设基准时刻 2026-03-07 00:00:00

    // 分支一：未超时工单 (原截止时间为 12 小时后)
    const futureDeadlineMs = nowMs + 12 * 3600 * 1000;
    const newDeadline1 = calculateNewDeadline(futureDeadlineMs, 24, nowMs);
    // 新截止时间 = 原截止时间 (12h) + 24h = 36h 后
    expect(newDeadline1.getTime()).toBe(nowMs + 36 * 3600 * 1000);

    // 分支二：已逾期工单 (原截止时间为 10 小时前)
    const pastDeadlineMs = nowMs - 10 * 3600 * 1000;
    const newDeadline2 = calculateNewDeadline(pastDeadlineMs, 24, nowMs);
    // 基准点重置为 nowMs，新截止时间 = nowMs + 24h
    expect(newDeadline2.getTime()).toBe(nowMs + 24 * 3600 * 1000);

    // 异常校验：非法时长抛出异常
    expect(() => calculateNewDeadline(nowMs, 0, nowMs)).toThrow("INVALID_DELAY_HOURS");
    expect(() => calculateNewDeadline(nowMs, 200, nowMs)).toThrow("INVALID_DELAY_HOURS");
  });

  it("M26-04: 累计延期次数与工期多级审批升格拦截 - 角色权限阶梯与熔断阻断", async () => {
    // 1. 算法层面阶梯测试
    // 首次延期 24 小时 -> 科室主管 (role = 3) 即可审批
    expect(evaluateRequiredRole(0, 24)).toBe(3);

    // 首次延期申请 72 小时 (>48h) -> 升格为分管处长 (role = 4)
    expect(evaluateRequiredRole(0, 72)).toBe(4);

    // 第二次延期 (approvedCount = 1) -> 自动升格为分管处长 (role = 4)
    expect(evaluateRequiredRole(1, 24)).toBe(4);

    // 累计达到 5 次或累计时长超过 360 小时 -> 触发硬熔断 (Infinity)
    expect(evaluateRequiredRole(5, 50)).toBe(Infinity);
    expect(evaluateRequiredRole(2, 380)).toBe(Infinity);

    // 2. 业务流层面拦截测试
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 4 });
    const sId = tenant.schoolId;

    const baseDeadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status, deadline) VALUES (9104, ?, 1, 1, 'LCU-DELAY-04', 104, 804, '配电房电缆破损', '急修', 1, ?)",
      [sId, baseDeadline]
    );

    // 师傅申请 72 小时大修顺延 (累计时长 > 48h，触发升格至处长 role >= 4)
    const apply = await DelayService.createDelayApply(sId, 9104, 804, {
      patrolId: 9104,
      delayHours: 72,
      reason: "需要向电力局申请临时停电并敷设高压电缆"
    });

    // 2.1 普通科室主管 (role = 3) 尝试审批该大修延期 -> 抛出 INSUFFICIENT_PERMISSION
    await expect(
      DelayService.reviewDelayApply(sId, apply.applyId, 301, 3, {
        applyId: apply.applyId,
        action: PatrolDelayStatusEnum.APPROVED,
        reviewRemark: "科室主管同意"
      })
    ).rejects.toThrow("INSUFFICIENT_PERMISSION");

    // 2.2 分管处长 (role = 4) 审批 -> 成功通过
    const reviewRes = await DelayService.reviewDelayApply(sId, apply.applyId, 401, 4, {
      applyId: apply.applyId,
      action: PatrolDelayStatusEnum.APPROVED,
      reviewRemark: "处领导已核实，同意停电施工顺延"
    });
    expect(reviewRes.finalStatus).toBe(PatrolDelayStatusEnum.APPROVED);

    // 验证工单 deadline 已被顺延更新
    const updatedPatrol = PatrolService.getMockPatrol(9104);
    expect(new Date(updatedPatrol!.deadline || "").getTime()).toBeGreaterThan(new Date(baseDeadline).getTime());
  });

  it("M26-05: 管理员驳回延期流转与状态保持 - 驳回后原工期不变且互斥锁解除", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 5 });
    const sId = tenant.schoolId;

    const originalDeadline = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status, deadline) VALUES (9105, ?, 1, 1, 'LCU-DELAY-05', 105, 805, '水管轻微渗水', '常修', 1, ?)",
      [sId, originalDeadline]
    );

    const apply = await DelayService.createDelayApply(sId, 9105, 805, {
      patrolId: 9105,
      delayHours: 24,
      reason: "今天下雨无法进行室外高空作业"
    });

    // 1. 驳回时未填写审核批注 -> 拒绝
    await expect(
      DelayService.reviewDelayApply(sId, apply.applyId, 301, 3, {
        applyId: apply.applyId,
        action: PatrolDelayStatusEnum.REJECTED,
        reviewRemark: ""
      })
    ).rejects.toThrow("驳回延期申请时必须填写审核批注");

    // 2. 正常驳回
    const rejectRes = await DelayService.reviewDelayApply(sId, apply.applyId, 301, 3, {
      applyId: apply.applyId,
      action: PatrolDelayStatusEnum.REJECTED,
      reviewRemark: "渗水点在室内走廊，不受降雨影响，请立即到场处理"
    });
    expect(rejectRes.finalStatus).toBe(PatrolDelayStatusEnum.REJECTED);

    // 3. 验证工单截止时间维持不变
    const patrol = PatrolService.getMockPatrol(9105);
    expect(patrol!.deadline).toBe(originalDeadline);

    // 4. 验证互斥锁已解除：师傅可针对客观理由再次重新提交新的申请
    const retryApply = await DelayService.createDelayApply(sId, 9105, 805, {
      patrolId: 9105,
      delayHours: 8,
      reason: "现场走廊吊顶需协调木工拆卸检查，申请顺延8小时"
    });
    expect(retryApply.applyId).toBeGreaterThan(apply.applyId);
    expect(retryApply.status).toBe(PatrolDelayStatusEnum.PENDING);
  });

  it("M26-06: 师生知情权闭环与 M25 聊天室系统卡片穿透 - 延期批复后自动注入进度卡片", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 6 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9106, ?, 1, 1, 'LCU-DELAY-06', 106, 806, '玻璃幕墙爆裂', '特急', 1)",
      [sId]
    );

    // 预置工单对应 M25 聊天室
    const roomRes: any = await TestHarness.executeSql(
      "INSERT INTO chat_rooms (schoolId, patrolId, creatorId, handlerId, initiatedByHandler, isClosed) VALUES (?, 9106, 106, 806, 1, 0)",
      [sId]
    );
    const roomId = roomRes.insertId;

    // 师傅提交延期申请
    const apply = await DelayService.createDelayApply(sId, 9106, 806, {
      patrolId: 9106,
      delayHours: 48,
      reason: "钢化玻璃定制周期需 2 天，已做警示围挡"
    });

    // 管理员审批通过
    await DelayService.reviewDelayApply(sId, apply.applyId, 301, 3, {
      applyId: apply.applyId,
      action: PatrolDelayStatusEnum.APPROVED,
      reviewRemark: "安全第一，已复核警示围挡，同意顺延定制"
    });

    // 验证聊天室消息流中已自动注入进度卡片 (type = 2)
    const messages = await ChatService.getMessageList(sId, roomId, 0, 10);
    const noticeMsg = messages.find((m) => m.type === 2);
    expect(noticeMsg).toBeDefined();
    expect(noticeMsg?.content).toContain("【工期顺延通知】");
    expect(noticeMsg?.content).toContain("管理处已批准延期 48 小时");
  });

  it("M26-07: 全量延期流水聚合与管理端大盘查询 - 聚合指标与待审核列表", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 7 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9107, ?, 1, 1, 'LCU-DELAY-07', 107, 807, '供热管道抢修', '急修', 1)",
      [sId]
    );

    // 模拟历史延期记录：1笔已批准(24h)、1笔已驳回(12h)、1笔待审核(16h)
    DelayService.mockRegisterDelayRecord({
      schoolId: sId,
      patrolId: 9107,
      applicantId: 807,
      delayHours: 24,
      status: PatrolDelayStatusEnum.APPROVED,
      reviewRemark: "同意",
      reviewerId: 301
    });

    DelayService.mockRegisterDelayRecord({
      schoolId: sId,
      patrolId: 9107,
      applicantId: 807,
      delayHours: 12,
      status: PatrolDelayStatusEnum.REJECTED,
      reviewRemark: "理由不充分",
      reviewerId: 301
    });

    const pendingRecord = DelayService.mockRegisterDelayRecord({
      schoolId: sId,
      patrolId: 9107,
      applicantId: 807,
      delayHours: 16,
      status: PatrolDelayStatusEnum.PENDING
    });

    // 1. 查询单工单历史聚合大盘
    const history = await DelayService.getDelayHistory(sId, 9107);
    expect(history.patrolId).toBe(9107);
    expect(history.totalApplyCount).toBe(3);
    expect(history.approvedCount).toBe(1);
    expect(history.cumulativeDelayHours).toBe(24);
    expect(history.hasPendingApply).toBe(true);
    expect(history.records.length).toBe(3);

    // 2. 查询全校待审批大盘
    const pendings = await DelayService.getPendingApplies(sId);
    expect(pendings.length).toBeGreaterThanOrEqual(1);
    const found = pendings.find((p) => p.applyId === pendingRecord.id);
    expect(found).toBeDefined();
    expect(found?.delayHours).toBe(16);
    expect(found?.status).toBe(PatrolDelayStatusEnum.PENDING);
  });

  it("M26-08: API 路由端点与 MasterDispatcher 网关调度验证 - /api/patrol/delay/*", async () => {
    const tenantMaster = TestHarness.createMockTenantContext({ moduleIndex: 26, caseIndex: 8 });
    const sId = tenantMaster.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO patrols (id, schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (9108, ?, 1, 1, 'LCU-DELAY-08', 108, 808, '电梯检修停运', '常规', 1)",
      [sId]
    );

    // 1. 师傅调用 /api/patrol/delay/apply 提交延期申请
    const applyRes = await applyApi.handler(
      {
        body: {
          patrolId: 9108,
          delayHours: 12,
          reason: "特种设备维保单位需更换曳引轮钢丝绳"
        },
        method: "POST"
      } as any,
      {
        userPayload: { schoolId: sId, userId: 808, role: 1, username: "电梯师傅808" }
      } as any
    );
    expect(applyRes.status).toBe(1);
    expect(applyRes.data.applyId).toBeGreaterThan(0);
    const applyId = applyRes.data.applyId;

    // 2. 管理员调用 /api/patrol/delay/pending 查询待审列表
    const pendingRes = await pendingApi.handler(
      { method: "GET" } as any,
      {
        userPayload: { schoolId: sId, userId: 301, role: 3, username: "科室主管" }
      } as any
    );
    expect(pendingRes.status).toBe(1);
    expect(pendingRes.data.length).toBeGreaterThanOrEqual(1);

    // 3. 管理员调用 /api/patrol/delay/review 审批通过
    const reviewRes = await reviewApi.handler(
      {
        body: {
          applyId,
          action: PatrolDelayStatusEnum.APPROVED,
          reviewRemark: "同意钢丝绳维保顺延"
        },
        method: "POST"
      } as any,
      {
        userPayload: { schoolId: sId, userId: 301, role: 3, username: "科室主管" }
      } as any
    );
    expect(reviewRes.status).toBe(1);
    expect(reviewRes.data.finalStatus).toBe(PatrolDelayStatusEnum.APPROVED);

    // 4. 调用 /api/patrol/delay/history 查询延期流水
    const histRes = await historyApi.handler(
      {
        query: { patrolId: 9108 },
        method: "GET"
      } as any,
      {
        userPayload: { schoolId: sId, userId: 808, role: 1, username: "电梯师傅808" }
      } as any
    );
    expect(histRes.status).toBe(1);
    expect(histRes.data.totalApplyCount).toBe(1);
    expect(histRes.data.approvedCount).toBe(1);
    expect(histRes.data.cumulativeDelayHours).toBe(12);
  });
});
