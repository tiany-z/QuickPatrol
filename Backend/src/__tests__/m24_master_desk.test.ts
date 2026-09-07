/**
 * M24: 师傅现场抢修工作台与接单协同状态机专项单元测试套件
 * (Master Desk & State Machine Test Suite)
 * 
 * 核心测试矩阵：
 * 1. M24-01: 并发抢单竞态原子测试 (两人几乎同毫秒抢单，排他锁与 CAS 仲裁必须且仅有 1 人成功，1 人冲突被拒)
 * 2. M24-02: 状态机非法跃迁与终态不可逆拦截 (结案 4 禁止跃迁，非法跳变 0->3 内存级阻断)
 * 3. M24-03: 现场工种不符协同改派 (重置状态为 0，责任人归零，分类修正并级联触发 M23 重新派单)
 * 4. M24-04: 现场同组同事接力转交 (维持状态 1 施工中，责任人直接过户给指定同事)
 * 5. M24-05: 协同改派防推诿死循环熔断 (单工单累计改派达到 3 次后强制熔断阻断)
 * 6. M24-06: 师傅工作台四象限未读数字聚合统计与 SLA 动态加权紧急度排序
 * 7. M24-07: MasterDispatcher 路由端点动态调度与鉴权拦截 (/api/patrol/accept, transfer, workbench-*)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PatrolStateMachine } from "../apps/patrol/patrolStateMachine.js";
import { TransferService } from "../apps/patrol/transferService.js";
import { AcceptController } from "../apps/patrol/acceptController.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import { WeChatAuthService } from "../services/auth/wechatAuthService.js";
import { PatrolStatusEnum } from "../apps/patrol/stateMachineTypes.js";
import { api as acceptApi } from "../api/patrol/accept/index.js";
import { api as transferApi } from "../api/patrol/transfer/index.js";
import { api as summaryApi } from "../api/patrol/workbench-summary/index.js";
import { api as listApi } from "../api/patrol/workbench-list/index.js";

describe("M24: 师傅抢修工作台与接单协同状态机 (Master Desk & Transfer)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M24-01: 并发抢单竞态测试 - 两人并发抢单必须且仅有 1 人成功，另一人被排他拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 预置工单: 处于抢单池 (status=0, currentHandlerId=0)
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-RACE-001', 10, 0, '开水间主水管漏水', '急修', 0)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 2. 预置两位在岗师傅: 801 与 802
    WeChatAuthService.mockRegisterUser({ id: 801, schoolId: sId, openId: "op_801", realName: "师傅张三", role: 1 });
    WeChatAuthService.mockRegisterUser({ id: 802, schoolId: sId, openId: "op_802", realName: "师傅李四", role: 1 });

    // 3. 模拟两人同毫秒并发发起抢单请求
    const p1 = PatrolStateMachine.executeAcceptClaim(sId, patrolId, 801, "师傅张三", "127.0.0.1");
    const p2 = PatrolStateMachine.executeAcceptClaim(sId, patrolId, 802, "师傅李四", "127.0.0.1");

    const results = await Promise.allSettled([p1, p2]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // 核心断言: 恰好一人成功获锁，一人冲突失败
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // 验证工单数据库状态: 状态必须顺向跃迁为 1 (施工中)，责任人为胜出者
    const patrol = PatrolService.getMockPatrol(patrolId);
    expect(patrol).toBeDefined();
    expect(patrol?.status).toBe(PatrolStatusEnum.IN_PROGRESS);
    expect([801, 802]).toContain(patrol?.currentHandlerId);

    // 失败者的拒绝信息必须友好准确
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason.message).toMatch(/(手慢了|冲突|抢先)/);
  });

  it("M24-02: 状态机非法跃迁与终态不可逆拦截 - 结案工单禁止抢单，跨阶段非法跃迁被阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 1. 预置已结案工单 (status = 4)
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-CLOSED-001', 10, 801, '历史已结案工单', '已评价', 4)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 2. 试图再次接单已结案工单 -> 必须被拒绝
    await expect(
      PatrolStateMachine.executeAcceptClaim(sId, patrolId, 801, "师傅张三", "127.0.0.1")
    ).rejects.toThrow(/(手慢了|状态|抢先)/);

    // 3. 状态转移偏序邻接矩阵单元校验
    expect(() => {
      PatrolStateMachine.validateTransition(PatrolStatusEnum.CLOSED, PatrolStatusEnum.IN_PROGRESS);
    }).toThrow("非法状态机跃迁");

    expect(() => {
      PatrolStateMachine.validateTransition(PatrolStatusEnum.PENDING, PatrolStatusEnum.COMPLETED);
    }).toThrow("非法状态机跃迁");

    // 合法跃迁通过
    expect(PatrolStateMachine.validateTransition(PatrolStatusEnum.PENDING, PatrolStatusEnum.IN_PROGRESS)).toBe(true);
    expect(PatrolStateMachine.validateTransition(PatrolStatusEnum.IN_PROGRESS, PatrolStatusEnum.UNDER_REVIEW)).toBe(true);
  });

  it("M24-03: 现场工种不符协同改派 - 工单状态重置为 0，分类修正并重新进入派单流转", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 3 });
    const sId = tenant.schoolId;

    // 1. 预置处于进行中的工单 (status=1, handler=801, category=1 水电)
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-TRANS-001', 10, 801, '门框变形', '现场勘验发现是地基沉降', 1)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 2. 师傅 801 发起工种不符改派，改派至分类 4 (泥瓦修缮)
    const res = await TransferService.executeTransfer(sId, 801, "127.0.0.1", {
      patrolId,
      transferType: "CATEGORY_MISMATCH",
      newCategoryId: 4,
      reason: "现场勘验为地基下沉挤压门框，需要泥瓦工先做地基加固",
      evidencePhotos: ["https://oss.school.edu.cn/proof_door.jpg"]
    });

    expect(res.isSuccess).toBe(true);
    expect(res.transferType).toBe("CATEGORY_MISMATCH");
    expect(res.newStatus).toBe(PatrolStatusEnum.PENDING); // 状态退回 0

    // 3. 验证数据库工单字段
    const patrol = PatrolService.getMockPatrol(patrolId);
    expect(patrol?.categoryId).toBe(4);
    expect(patrol?.currentHandlerId).toBe(0); // 责任人归零重新抢单/派单
    expect(patrol?.status).toBe(PatrolStatusEnum.PENDING);

    // 4. 验证安全审计流水
    const logs = AuditLogger.getMockLogs();
    const transLog = logs.find((l) => l.action === "PATROL_TRANSFER_REASSIGN");
    expect(transLog).toBeDefined();
    const payload = JSON.parse(transLog?.payloadJson || "{}");
    expect(payload.newCategoryId).toBe(4);
  });

  it("M24-04: 现场同组同事接力转交 - 责任人直接过户给指定同事并维持施工状态 1", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 4 });
    const sId = tenant.schoolId;

    // 1. 注册师傅与接力同事
    WeChatAuthService.mockRegisterUser({ id: 801, schoolId: sId, openId: "op_801", realName: "师傅张三", role: 1 });
    WeChatAuthService.mockRegisterUser({ id: 802, schoolId: sId, openId: "op_802", realName: "师傅李四", role: 1 });

    // 2. 预置处于进行中的工单 (status=1, handler=801)
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-HANDOVER-001', 10, 801, '路灯不亮', '高空线路检修', 1)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 3. 师傅 801 转交工单给同事 802
    const res = await TransferService.executeTransfer(sId, 801, "127.0.0.1", {
      patrolId,
      transferType: "PEER_HANDOVER",
      targetPeerUserId: 802,
      reason: "接紧急防汛抢险调度，现场工作转交李工接力"
    });

    expect(res.isSuccess).toBe(true);
    expect(res.transferType).toBe("PEER_HANDOVER");
    expect(res.newStatus).toBe(PatrolStatusEnum.IN_PROGRESS); // 状态保持 1
    expect(res.newHandlerName).toBe("师傅李四");

    // 4. 验证数据库工单责任人已更新为 802
    const patrol = PatrolService.getMockPatrol(patrolId);
    expect(patrol?.currentHandlerId).toBe(802);
    expect(patrol?.status).toBe(PatrolStatusEnum.IN_PROGRESS);

    // 5. 验证审计日志
    const logs = AuditLogger.getMockLogs();
    const handoverLog = logs.find((l) => l.action === "PATROL_TRANSFER_HANDOVER");
    expect(handoverLog).toBeDefined();
    const payload = JSON.parse(handoverLog?.payloadJson || "{}");
    expect(payload.toUserId).toBe(802);
  });

  it("M24-05: 协同改派防推诿死循环熔断 - 单工单累计改派达到 3 次后强制阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 5 });
    const sId = tenant.schoolId;

    // 1. 注册工单
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-LOOP-001', 10, 801, '疑难综合渗水', '多次转派', 1)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 2. 模拟前 3 次改派流水记录
    await AuditLogger.log(sId, 801, "PATROL_TRANSFER_REASSIGN", "patrols", "127.0.0.1", { patrolId, orderNo: "LCU-LOOP-001" });
    await AuditLogger.log(sId, 802, "PATROL_TRANSFER_REASSIGN", "patrols", "127.0.0.1", { patrolId, orderNo: "LCU-LOOP-001" });
    await AuditLogger.log(sId, 803, "PATROL_TRANSFER_HANDOVER", "patrols", "127.0.0.1", { patrolId, orderNo: "LCU-LOOP-001" });

    // 3. 第 4 次试图改派 -> 必须触发熔断
    await expect(
      TransferService.executeTransfer(sId, 801, "127.0.0.1", {
        patrolId,
        transferType: "CATEGORY_MISMATCH",
        newCategoryId: 3,
        reason: "再次发现非本工种，继续申请改派"
      })
    ).rejects.toThrow("达到系统上限！已锁定并转入后勤处长人工督办调度！");
  });

  it("M24-06: 师傅工作台四象限未读统计与 SLA 动态加权排序断言", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 6 });
    const sId = tenant.schoolId;
    const myId = 801;

    // 1. 注册四象限各自代表单据
    // 象限 1: 抢单池 (handler = 0, status = 0, 特急加急)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status, priorityLevel) VALUES (?, 1, 1, 'LCU-Q1', 1, 0, '高压电缆断裂', '特急', 0, 2)",
      [sId]
    );
    // 象限 1: 抢单池第二单 (handler = 0, status = 0, 普通)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status, priorityLevel) VALUES (?, 1, 1, 'LCU-Q1-B', 1, 0, '桌腿松动', '普通', 0, 0)",
      [sId]
    );
    // 象限 2: 待出发 (handler = myId, status = 0)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-Q2', 1, ?, '洗手盆下水堵塞', '已直派', 0)",
      [sId, myId]
    );
    // 象限 3: 施工中 (handler = myId, status = 1)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-Q3', 1, ?, '外墙瓷砖脱落施工', '施工中', 1)",
      [sId, myId]
    );
    // 象限 4: 待验收 (handler = myId, status = 2)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-Q4', 1, ?, '空调管道清洗完工', '待复核', 2)",
      [sId, myId]
    );

    // 2. 校验工作台四象限角标统计
    const summaryRes = await AcceptController.handleGetWorkbenchSummary({
      schoolId: sId,
      userId: myId
    });

    expect(summaryRes.status).toBe(1);
    expect(summaryRes.data?.poolCount).toBe(2);
    expect(summaryRes.data?.assignedCount).toBe(1);
    expect(summaryRes.data?.inProgressCount).toBe(1);
    expect(summaryRes.data?.reviewCount).toBe(1);

    // 3. 校验抢单池列表 SLA 动态加权排序 (特急加急 LCU-Q1 必须排在首位且触发置顶提示)
    const listRes = await AcceptController.handleGetWorkbenchList(
      { schoolId: sId, userId: myId },
      { tab: "pool", page: 1, pageSize: 10 }
    );

    expect(listRes.status).toBe(1);
    expect(listRes.data?.list.length).toBe(2);
    const firstCard = listRes.data?.list[0];
    expect(firstCard?.orderNo).toBe("LCU-Q1");
    expect(firstCard?.priorityLevel).toBe(2);
    expect(firstCard?.isUrgentNotice).toBe(true);
    expect(firstCard?.slaScore).toBeGreaterThan(listRes.data!.list[1].slaScore);
  });

  it("M24-07: MasterDispatcher 路由调度与鉴权端点闭环测试", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 24, caseIndex: 7 });
    const sId = tenant.schoolId;

    // 预置工单
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-API-001', 1, 0, '风扇转速异常', '需检修', 0)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 1. 未授权请求被拦截 (用户未登录)
    const unauthCtx: any = { requestId: "req_test", withdrawStack: null, lockedRows: [], userPayload: null };
    const unauthRes = await acceptApi.handler({ body: { patrolId }, query: {}, req: {} as any }, unauthCtx);
    expect(unauthRes.status).toBe(0);
    expect(unauthRes.content).toContain("未登录");

    // 2. 携带有效上下文正常接单
    const authCtx: any = {
      requestId: "req_test2",
      withdrawStack: null,
      lockedRows: [],
      userPayload: { schoolId: sId, userId: 801, role: 1, username: "师傅张三" }
    };
    const acceptRes = await acceptApi.handler(
      { body: { patrolId, acceptSource: "TASK_POOL" }, query: {}, req: {} as any },
      authCtx
    );
    expect(acceptRes.status).toBe(1);
    expect(acceptRes.data?.isSuccess).toBe(true);
    expect(acceptRes.data?.currentStatus).toBe(PatrolStatusEnum.IN_PROGRESS);

    // 3. 测试获取四象限摘要端点 GET /api/patrol/workbench-summary
    const summaryRes = await summaryApi.handler({ body: {}, query: {}, req: {} as any }, authCtx);
    expect(summaryRes.status).toBe(1);
    expect(summaryRes.data?.inProgressCount).toBe(1);

    // 4. 测试获取四象限列表端点 GET /api/patrol/workbench-list?tab=inProgress
    const listRes = await listApi.handler(
      { body: {}, query: { tab: "inProgress" }, req: {} as any },
      authCtx
    );
    expect(listRes.status).toBe(1);
    expect(listRes.data?.list.length).toBe(1);
    expect(listRes.data?.list[0].orderNo).toBe("LCU-API-001");

    // 5. 协同改派端点测试 POST /api/patrol/transfer
    const transferRes = await transferApi.handler(
      {
        body: {
          patrolId,
          transferType: "CATEGORY_MISMATCH",
          newCategoryId: 2,
          reason: "现场测试为木工问题，转交木工班组"
        },
        query: {},
        req: {} as any
      },
      authCtx
    );
    expect(transferRes.status).toBe(1);
    expect(transferRes.data?.transferType).toBe("CATEGORY_MISMATCH");
    expect(transferRes.data?.newStatus).toBe(PatrolStatusEnum.PENDING);
  });
});
