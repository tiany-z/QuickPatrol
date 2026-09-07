/**
 * M19: 移动端用户批量调度与运维审计日志独立单元测试套件
 * (Batch Management & Audit Logs Test Suite)
 */

import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { UserBatchService } from "../services/admin/userBatchService.js";
import { AuditLogger } from "../shared/log/auditLogger.js";
import { handleBatchUpdateUsers } from "../api/user/batchUpdate/handler.js";
import { handleQueryAuditLogs } from "../api/admin/auditLogs/handler.js";
import { BatchSelectStore } from "../services/admin/batchTypes.js";

describe("M19: 移动端用户批量调度与运维审计日志 (Batch Management & Audit Logs)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M19-01: 能够批量将多名人员调入新部门，且产生不可篡改审计快照", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 创建 3 名测试人员
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, departmentId) VALUES (901, ?, 'op_1', '张三', 1), (902, ?, 'op_2', '李四', 1), (903, ?, 'op_3', '王五', 2)",
      [sId, sId, sId]
    );

    // 2. 批量将他们调换入新部门 8
    const batchRes = await UserBatchService.executeBatchUpdate(sId, 999, "192.168.1.100", {
      targetUserIds: [901, 902, 903],
      actionType: "SET_DEPARTMENT",
      departmentId: 8,
      reason: "网格团队调整"
    });

    expect(batchRes.successCount).toBe(3);
    expect(batchRes.blockedCount).toBe(0);
    expect(batchRes.auditLogId).toBeGreaterThan(0);

    // 3. 验证数据库中 3 人的 departmentId 均已变为 8
    const checkSql = "SELECT departmentId FROM users WHERE id IN (901, 902, 903)";
    const updatedUsers = await TestHarness.executeSql(checkSql);
    expect(updatedUsers.every((u: any) => u.departmentId === 8)).toBe(true);

    // 4. 验证审计日志记录完整存在
    const auditRes = await AuditLogger.queryLogs(sId, { module: "User" });
    expect(auditRes.total).toBeGreaterThanOrEqual(1);
    expect(auditRes.list[0].action).toBe("BATCH_SET_DEPARTMENT");
    expect(auditRes.list[0].payload.affectedCount).toBe(3);
  });

  it("M19-02: 容错模式下，挂有在办工单的人员被安全剪枝跳过，其余人员顺利生效", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 创建 2 名人员：904 (闲置) 与 905 (有在办工单)
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, isBan) VALUES (904, ?, 'op_4', '无单师傅', 0), (905, ?, 'op_5', '有单师傅', 0)",
      [sId, sId]
    );

    // 给 905 挂一张处理中工单 (status=1)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, desc, status) VALUES (?, 1, 1, 'LCU-PRUNE-001', 1, 905, '水管破裂', '急修', 1)",
      [sId]
    );

    // 批量封禁两人 (resilient 模式)
    const res = await UserBatchService.executeBatchUpdate(sId, 999, "127.0.0.1", {
      targetUserIds: [904, 905],
      actionType: "BAN_USERS",
      mode: "resilient"
    });

    expect(res.successCount).toBe(1); // 只有 904 成功
    expect(res.blockedCount).toBe(1); // 905 被成功剪枝隔离
    expect(res.blockedUsers[0].userId).toBe(905);

    // 验证 904 被封禁 (isBan=1)，而 905 依然正常 (isBan=0)
    const rows = await TestHarness.executeSql("SELECT id, isBan FROM users WHERE id IN (904, 905)");
    const user904 = rows.find((r: any) => r.id === 904);
    const user905 = rows.find((r: any) => r.id === 905);
    expect(user904.isBan).toBe(1);
    expect(user905.isBan).toBe(0);
  });

  it("M19-03: 防自杀保护: 尝试批量封禁包含自身操作人账号应被强力拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 3 });
    const sId = tenant.schoolId;
    const adminId = 888;

    await expect(
      UserBatchService.executeBatchUpdate(sId, adminId, "127.0.0.1", {
        targetUserIds: [100, adminId, 102],
        actionType: "BAN_USERS"
      })
    ).rejects.toThrow("严禁将自己的账号纳入批量封禁名单");
  });

  it("M19-04: 单次批量更新上限保护: 超过50人时应被立即拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 4 });
    const sId = tenant.schoolId;
    const tooManyUserIds = Array.from({ length: 51 }, (_, i) => 1000 + i);

    await expect(
      UserBatchService.executeBatchUpdate(sId, 999, "127.0.0.1", {
        targetUserIds: tooManyUserIds,
        actionType: "SET_ROLE",
        role: 1
      })
    ).rejects.toThrow("单次批量操作人员数量不得超过 50 人");
  });

  it("M19-05: 批量更新角色 (SET_ROLE) 与批量解封 (UNBAN_USERS)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 5 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (910, ?, 'op_10', '师傅A', 0, 1), (911, ?, 'op_11', '师傅B', 0, 1)",
      [sId, sId]
    );

    // 批量设置角色为 2 (维保师傅)
    const roleRes = await UserBatchService.executeBatchUpdate(sId, 999, "127.0.0.1", {
      targetUserIds: [910, 911],
      actionType: "SET_ROLE",
      role: 2
    });
    expect(roleRes.successCount).toBe(2);

    // 批量解封
    const unbanRes = await UserBatchService.executeBatchUpdate(sId, 999, "127.0.0.1", {
      targetUserIds: [910, 911],
      actionType: "UNBAN_USERS"
    });
    expect(unbanRes.successCount).toBe(2);

    const rows = await TestHarness.executeSql("SELECT id, role, isBan FROM users WHERE id IN (910, 911)");
    expect(rows.every((r: any) => r.role === 2 && r.isBan === 0)).toBe(true);
  });

  it("M19-06: 严格模式 (strict) 下，存在在办工单人员时整体回滚阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 6 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, isBan) VALUES (920, ?, 'op_20', '空闲人员', 0), (921, ?, 'op_21', '繁忙人员', 0)",
      [sId, sId]
    );

    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, desc, status) VALUES (?, 1, 1, 'LCU-STRICT-001', 1, 921, '配电箱冒烟', '加急', 1)",
      [sId]
    );

    // strict 模式封禁
    await expect(
      UserBatchService.executeBatchUpdate(sId, 999, "127.0.0.1", {
        targetUserIds: [920, 921],
        actionType: "BAN_USERS",
        mode: "strict"
      })
    ).rejects.toThrow("严格模式阻断");

    // 验证两人均未被封禁
    const rows = await TestHarness.executeSql("SELECT id, isBan FROM users WHERE id IN (920, 921)");
    expect(rows.every((r: any) => r.isBan === 0)).toBe(true);
  });

  it("M19-07: 审计日志多维条件筛选与分页查询", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 7 });
    const sId = tenant.schoolId;

    // 记录多条不同模块与操作的日志
    await AuditLogger.recordLog({
      schoolId: sId,
      operatorUserId: 100,
      action: "BATCH_SET_DEPARTMENT",
      module: "User",
      payload: { count: 3 }
    });

    await AuditLogger.recordLog({
      schoolId: sId,
      operatorUserId: 100,
      action: "BATCH_BAN_USERS",
      module: "User",
      payload: { count: 1 }
    });

    await AuditLogger.recordLog({
      schoolId: sId,
      operatorUserId: 200,
      action: "UPDATE_CONFIG",
      module: "Department",
      payload: { key: "foo" }
    });

    // 1. 按模块筛选
    const userModuleLogs = await AuditLogger.queryLogs(sId, { module: "User" });
    expect(userModuleLogs.total).toBe(2);

    // 2. 按动作精准筛选
    const banLogs = await AuditLogger.queryLogs(sId, { action: "BATCH_BAN_USERS" });
    expect(banLogs.total).toBe(1);
    expect(banLogs.list[0].action).toBe("BATCH_BAN_USERS");

    // 3. 分页验证
    const pagedLogs = await AuditLogger.queryLogs(sId, { page: 1, pageSize: 2 });
    expect(pagedLogs.list.length).toBe(2);
  });

  it("M19-08: 微信小程序端 BatchSelectStore 状态机流转与订阅测试", () => {
    const storeFilePath = path.resolve(
      __dirname,
      "../../../WeChatMiniProgram/miniprogram/packages/apps/app-org-center/pages/user-batch/batchSelectStore.ts"
    );
    expect(fs.existsSync(storeFilePath)).toBe(true);
    const code = fs.readFileSync(storeFilePath, "utf-8");
    expect(code).toContain("BatchSelectStore");
    expect(code).toContain("enterBatchMode");
    expect(code).toContain("exitBatchMode");
    expect(code).toContain("toggleSelect");
    expect(code).toContain("selectAll");

    const store = new BatchSelectStore();
    const states: Array<{ isBatchMode: boolean; count: number }> = [];

    const unsubscribe = store.subscribe((s) => {
      states.push(s);
    });

    expect(store.isBatchModeActive()).toBe(false);
    expect(store.getSelectedCount()).toBe(0);

    // 1. 长按进入多选模式并选中首个师傅
    store.enterBatchMode(101);
    expect(store.isBatchModeActive()).toBe(true);
    expect(store.getSelectedCount()).toBe(1);
    expect(store.isUserSelected(101)).toBe(true);

    // 2. 勾选另两个师傅
    store.toggleSelect(102);
    store.toggleSelect(103);
    expect(store.getSelectedCount()).toBe(3);
    expect(store.getSelectedUserIds()).toEqual([101, 102, 103]);

    // 3. 反选 101
    store.toggleSelect(101);
    expect(store.getSelectedCount()).toBe(2);
    expect(store.isUserSelected(101)).toBe(false);

    // 4. 全选
    store.selectAll([201, 202, 203, 204]);
    expect(store.getSelectedCount()).toBe(4);

    // 5. 退出多选态
    store.exitBatchMode();
    expect(store.isBatchModeActive()).toBe(false);
    expect(store.getSelectedCount()).toBe(0);

    unsubscribe();
  });

  it("M19-09: HTTP 端点鉴权与网关处理测试 (/api/user/batch-update & /api/admin/audit-logs)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 9 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, departmentId) VALUES (950, ?, 'op_50', '师傅C', 1)",
      [sId]
    );

    // 1. 普通学生/工人 (role=1) 无权发起批量调度
    const forbiddenBatch = await handleBatchUpdateUsers(
      { schoolId: sId, userId: 1, role: 1 },
      { targetUserIds: [950], actionType: "SET_DEPARTMENT", departmentId: 9 }
    );
    expect(forbiddenBatch.status).toBe(0);
    expect(forbiddenBatch.content).toContain("权限不足");

    // 2. 主管 (role=3) 有权发起批量调度
    const allowedBatch = await handleBatchUpdateUsers(
      { schoolId: sId, userId: 99, role: 3 },
      { targetUserIds: [950], actionType: "SET_DEPARTMENT", departmentId: 9 }
    );
    expect(allowedBatch.status).toBe(1);
    expect(allowedBatch.data.successCount).toBe(1);

    // 3. 主管 (role=3) 无权查看全校安全审计日志 (需 role >= 4)
    const forbiddenAudit = await handleQueryAuditLogs({ schoolId: sId, role: 3 }, {});
    expect(forbiddenAudit.status).toBe(0);
    expect(forbiddenAudit.content).toContain("权限不足");

    // 4. 校管理员 (role=4) 成功读取审计日志
    const allowedAudit = await handleQueryAuditLogs({ schoolId: sId, role: 4 }, {});
    expect(allowedAudit.status).toBe(1);
    expect(allowedAudit.data.total).toBeGreaterThanOrEqual(1);
  });

  it("M19-10: 垂直法定角色越权防护 (No-Upward-Modification)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 19, caseIndex: 10 });
    const sId = tenant.schoolId;

    // 创建普通师傅 (role=2) 和后勤处长 (role=4)
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role) VALUES (960, ?, 'op_60', '电工老张', 2), (961, ?, 'op_61', '后勤处长', 4)",
      [sId, sId]
    );

    // 科室主管 (role=3) 试图批量调度包含处长 (role=4) 的列表
    await expect(
      UserBatchService.executeBatchUpdate(
        sId,
        99,
        "127.0.0.1",
        {
          targetUserIds: [960, 961],
          actionType: "SET_ROLE",
          role: 1
        },
        3 // operatorRole: 3
      )
    ).rejects.toThrow("垂直越权拦截");
  });
});
