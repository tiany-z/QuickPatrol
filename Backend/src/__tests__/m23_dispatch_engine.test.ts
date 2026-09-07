/**
 * M23: 智能网格派单与职能标签广播匹配独立单测套件
 * (Grid Dispatch & Auto-Routing Test Suite)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { DispatchEngine } from "../apps/patrol/dispatchEngine.js";
import { DispatchController } from "../apps/patrol/dispatchController.js";
import { PatrolService } from "../apps/patrol/patrolService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";

describe("M23: 智能网格派单与职能标签广播匹配独立单测套件", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M23-01: 特异性阶梯判定 - 专属校区+分类 (Level 3) 优先于通用规则", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 23, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 创建通用规则: 校区 1 + 全部分类 (Level 2), 绑定师傅 901
    await TestHarness.executeSql(
      "INSERT INTO permissions (schoolId, userId, tagId, campusId, categoryId, type) VALUES (?, 901, 0, 1, 0, 1)",
      [sId]
    );

    // 2. 创建专属特异规则: 校区 1 + 分类 5 (Level 3), 绑定师傅 902
    await TestHarness.executeSql(
      "INSERT INTO permissions (schoolId, userId, tagId, campusId, categoryId, type) VALUES (?, 902, 0, 1, 5, 1)",
      [sId]
    );

    // 预置师傅 901 与 902 档案
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, isBan) VALUES (901, ?, 'op_901', '普通值班王师傅', 0), (902, ?, 'op_902', '特种电梯张师傅', 0)",
      [sId, sId]
    );

    // 预置工单: 发生于校区 1, 分类 5
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, `desc`, status) VALUES (?, 1, 5, 'LCU-2026-01', 1, '电梯故障', '急修', 0)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 执行派单
    const decision = await DispatchEngine.executeDispatch(sId, patrolId, 1, 5);

    // 断言: 必须命中 Level 3 专属师傅 902，而不是通配师傅 901
    expect(decision.matchedRuleLevel).toBe(3);
    expect(decision.assignedUserId).toBe(902);
    expect(decision.isFallback).toBe(false);
    expect(decision.dispatchMode).toBe("DIRECT_USER");

    // 验证工单数据库已落盘当前责任人
    const updatedPatrol = PatrolService.getMockPatrol(patrolId);
    expect(updatedPatrol?.currentHandlerId).toBe(902);
  });

  it("M23-02: 职能标签抢单池模式 - 派发给标签下全体有效师傅", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 23, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 创建标签与 2 名师傅
    await TestHarness.executeSql("INSERT INTO tags (id, schoolId, name) VALUES (201, ?, '水暖应急抢险班')", [sId]);
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, isBan) VALUES (911, ?, 'op_911', '水工老李', 0), (912, ?, 'op_912', '水工小赵', 0)",
      [sId, sId]
    );
    await TestHarness.executeSql(
      "INSERT INTO tag_members (schoolId, tagId, userId) VALUES (?, 201, 911), (?, 201, 912)",
      [sId, sId]
    );

    // 配置派单规则绑定该标签
    await TestHarness.executeSql(
      "INSERT INTO permissions (schoolId, userId, tagId, campusId, categoryId, type) VALUES (?, 0, 201, 2, 8, 1)",
      [sId]
    );

    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, `desc`, status) VALUES (?, 2, 8, 'LCU-2026-02', 1, '地下室跑水', '大漏', 0)",
      [sId]
    );

    const decision = await DispatchEngine.executeDispatch(sId, pRes.insertId, 2, 8);

    expect(decision.dispatchMode).toBe("TAG_POOL");
    expect(decision.targetTagId).toBe(201);
    expect(decision.assignedUserId).toBe(0); // 抢单池模式保留 0 待认领
    expect(decision.candidateUserIds).toContain(911);
    expect(decision.candidateUserIds).toContain(912);
    expect(decision.isFallback).toBe(false);
  });

  it("M23-03: 防漏单自愈熔断 - 规则完全缺失时保底直派校级一把手", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 23, caseIndex: 3 });
    const sId = tenant.schoolId;

    // 预置处长账号 (role = 4)
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (888, ?, 'admin_888', '后勤李处长', 4, 0)",
      [sId]
    );

    // 插入一张无任何规则的孤儿工单
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, `desc`, status) VALUES (?, 99, 999, 'LCU-ORPHAN-01', 1, '未知罕见故障', '无解', 0)",
      [sId]
    );

    const decision = await DispatchEngine.executeDispatch(sId, pRes.insertId, 99, 999);

    expect(decision.isFallback).toBe(true);
    expect(decision.assignedUserId).toBe(888); // 熔断直达处长
    expect(decision.dispatchMode).toBe("ORPHAN_FALLBACK");

    // 验证工单数据库已落盘管理员
    const updatedPatrol = PatrolService.getMockPatrol(pRes.insertId);
    expect(updatedPatrol?.currentHandlerId).toBe(888);
  });

  it("M23-04: 自适应负荷均衡调度 - 优先直派在办加权工单最少的师傅", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 23, caseIndex: 4 });
    const sId = tenant.schoolId;

    // 创建木工标签与 2 名师傅: 师傅 921 (手头有2单在办) 和 师傅 922 (空闲0单)
    await TestHarness.executeSql("INSERT INTO tags (id, schoolId, name) VALUES (301, ?, '木工维修组')", [sId]);
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, isBan) VALUES (921, ?, 'op_921', '繁忙木工', 0), (922, ?, 'op_922', '空闲木工', 0)",
      [sId, sId]
    );
    await TestHarness.executeSql(
      "INSERT INTO tag_members (schoolId, tagId, userId) VALUES (?, 301, 921), (?, 301, 922)",
      [sId, sId]
    );

    // 预置师傅 921 现有 2 张进行中的工单 (status = 1)
    PatrolService.mockRegisterPatrol({
      schoolId: sId,
      currentHandlerId: 921,
      status: 1,
      priorityLevel: 1
    });
    PatrolService.mockRegisterPatrol({
      schoolId: sId,
      currentHandlerId: 921,
      status: 2,
      priorityLevel: 2 // 特急工单加权更高
    });

    // 权限规则绑定该标签
    await TestHarness.executeSql(
      "INSERT INTO permissions (schoolId, userId, tagId, campusId, categoryId, type) VALUES (?, 0, 301, 1, 3, 1)",
      [sId]
    );

    // 新增工单
    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, `desc`, status) VALUES (?, 1, 3, 'LCU-2026-04', 1, '门锁损坏', '报修', 0)",
      [sId]
    );

    // 强制开启负荷均衡调度模式
    const decision = await DispatchEngine.executeDispatch(sId, pRes.insertId, 1, 3, { forceLeastLoaded: true });

    expect(decision.dispatchMode).toBe("DIRECT_USER");
    expect(decision.assignedUserId).toBe(922); // 负荷最轻的空闲木工胜出
    expect(decision.assignedUserName).toBe("空闲木工");
  });

  it("M23-05: 管理员手动指定派单与权限控制", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 23, caseIndex: 5 });
    const sId = tenant.schoolId;

    // 预置主管 (role = 2) 与普通员工 (role = 0)
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (101, ?, 'u_101', '普通报修人', 0, 0), (201, ?, 'u_201', '后勤主管', 2, 0), (931, ?, 'u_931', '维修工刘师傅', 1, 0)",
      [sId, sId, sId]
    );

    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, `desc`, status) VALUES (?, 1, 2, 'LCU-MANUAL-01', 101, '路灯不亮', '报修', 0)",
      [sId]
    );
    const patrolId = pRes.insertId;

    // 1. 普通人员 (role = 0) 尝试手动派单被拒 (403/未授权)
    const unauthorizedRes = await DispatchController.handleManualDispatch(
      { schoolId: sId, userId: 101, role: 0 },
      { patrolId, targetUserId: 931 }
    );
    expect(unauthorizedRes.status).toBe(0);
    expect(unauthorizedRes.content).toContain("权限不足");

    // 2. 主管人员 (role = 2) 手动派单成功
    const authorizedRes = await DispatchController.handleManualDispatch(
      { schoolId: sId, userId: 201, role: 2 },
      { patrolId, targetUserId: 931, assignRemark: "请刘师傅优先处理" }
    );
    expect(authorizedRes.status).toBe(1);
    expect(authorizedRes.data?.assignedUserId).toBe(931);

    const patrol = PatrolService.getMockPatrol(patrolId);
    expect(patrol?.currentHandlerId).toBe(931);
  });

  it("M23-06: 安全审计链与消息总线广播验证", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 23, caseIndex: 6 });
    const sId = tenant.schoolId;

    // 预置规则直派师傅 941
    await TestHarness.executeSql(
      "INSERT INTO permissions (schoolId, userId, tagId, campusId, categoryId, type) VALUES (?, 941, 0, 1, 1, 1)",
      [sId]
    );
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, isBan) VALUES (941, ?, 'op_941', '管道陈师傅', 0)",
      [sId]
    );

    const pRes: any = await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, title, `desc`, status) VALUES (?, 1, 1, 'LCU-AUDIT-01', 1, '管道滴水', '报修', 0)",
      [sId]
    );

    await DispatchEngine.executeDispatch(sId, pRes.insertId, 1, 1);

    // 验证审计日志
    const logs = Array.from(AuditLogger.getMockLogsMap().values());
    const dispatchLog = logs.find(
      (l) => l.schoolId === sId && l.action === "DISPATCH_DIRECT_ASSIGNED"
    );

    expect(dispatchLog).toBeDefined();
    expect(dispatchLog?.module).toBe("Patrol");
    const parsedPayload = JSON.parse(dispatchLog?.payloadJson || "{}");
    expect(parsedPayload.assignedUserId).toBe(941);
  });
});
