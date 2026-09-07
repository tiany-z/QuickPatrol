import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { FlowLockEngine } from "../shared/flow/flowLockEngine.js";
import { FlowLockInterceptor } from "../dispatcher/flowLockInterceptor.js";
import { handleBanUser } from "../api/user/ban/handler.js";
import { BusinessLockException } from "../apps/org/orgException.js";

describe("M17: Flow Lock 业务连续性防错熔断 (Flow Lock Circuit Breaker)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M17-01: 名下无在办工单的人员可正常顺利停用", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 创建一名无任何工单的普通师傅
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (801, ?, 'open_801', '闲置师傅', 2, 0)",
      [sId]
    );

    // 2. 调用停用端点
    const res = await handleBanUser({ schoolId: sId, role: 4 }, { targetUserId: 801 });

    expect(res.success).toBe(true);
    expect(res.data.isBan).toBe(1);

    // 验证数据库状态已变为 1
    const checkSql = "SELECT isBan FROM users WHERE id = 801";
    const rows = await TestHarness.executeSql(checkSql);
    expect(rows[0].isBan).toBe(1);
  });

  it("M17-02: 名下有处理中工单 (status=1) 时，必须强力触发 HTTP 409 熔断阻断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 1. 创建一名在职师傅
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (802, ?, 'open_802', '在岗师傅', 2, 0)",
      [sId]
    );

    // 2. 产生一张挂在他名下的在办工单 (status = 1)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, desc, status) VALUES (?, 1, 1, 'LCU-2026-LOCK-001', 1, 802, '水管爆裂抢险', '急需到场', 1)",
      [sId]
    );

    // 3. 尝试停用该师傅，断言被 Flow Lock 拦截并返回标准 409 契约
    const res: any = await handleBanUser({ schoolId: sId, role: 4 }, { targetUserId: 802 });

    expect(res.success).toBe(false);
    expect(res.code).toBe(409);
    expect(res.errorCode).toBe("FLOW_LOCK_BLOCKED");
    expect(res.message).toContain("在办");
    expect(res.data.activeCount).toBe(1);
    expect(res.data.blockedOrders[0].orderNo).toBe("LCU-2026-LOCK-001");

    // 4. 验证数据库中该师傅状态坚决未被篡改 (仍为正常 isBan = 0)
    const checkSql = "SELECT isBan FROM users WHERE id = 802";
    const rows = await TestHarness.executeSql(checkSql);
    expect(rows[0].isBan).toBe(0);
  });

  it("M17-03: 部门全子树探针能够精准穿透下属班组在办工单", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 3 });
    const sId = tenant.schoolId;

    // 创建二级中心与三级班组
    await TestHarness.executeSql(
      "INSERT INTO departments (id, schoolId, parentId, path, name) VALUES (10, ?, null, '/10/', '动力保障中心'), (11, ?, 10, '/10/11/', '下属抢修班')",
      [sId, sId]
    );

    // 工单挂在三级班组名下 (departmentId: 11)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, departmentId, title, desc, status) VALUES (?, 1, 1, 'LCU-SUBTREE-01', 1, 11, '变电箱异响', '排查中', 1)",
      [sId]
    );

    // 探针扫描二级中心 (id: 10)，断言能穿透捕获到 11 班组名下的工单
    const probe = await FlowLockEngine.probeDepartmentSubtreeActivePatrols(sId, 10);
    expect(probe.hasActivePatrols).toBe(true);
    expect(probe.activeCount).toBe(1);
    expect(probe.samplePatrols[0].orderNo).toBe("LCU-SUBTREE-01");
  });

  it("M17-04: 岗位职能标签探针能够精准捕获挂靠该标签的在办工单并熔断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 4 });
    const sId = tenant.schoolId;

    // 1. 创建岗位标签
    await TestHarness.executeSql(
      "INSERT INTO tags (id, schoolId, name, color) VALUES (55, ?, '抢修专员', '#D83B01')",
      [sId]
    );

    // 2. 创建挂在该标签下的工单
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, tagId, title, desc, status) VALUES (?, 1, 1, 'LCU-TAG-001', 1, 55, '高压线检修', '带电作业', 1)",
      [sId]
    );

    // 3. 探针直接检测标签
    const probe = await FlowLockEngine.probeTagActivePatrols(sId, 55);
    expect(probe.hasActivePatrols).toBe(true);
    expect(probe.activeCount).toBe(1);
    expect(probe.samplePatrols[0].orderNo).toBe("LCU-TAG-001");

    // 4. 调用拦截器断言抛出 BusinessLockException
    await expect(FlowLockInterceptor.interceptTagDestruction(sId, 55, "抢修专员")).rejects.toThrow(
      BusinessLockException
    );
  });

  it("M17-05: 工单处于 status=0(待派发) 和 status=2(待复核) 同样严格受 Flow Lock 保护并熔断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 5 });
    const sId = tenant.schoolId;

    // 注册复核人师傅
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (805, ?, 'open_805', '质检验收员', 2, 0)",
      [sId]
    );

    // 注册待复核工单 (status = 2, currentReviewerId = 805)
    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentReviewerId, title, desc, status) VALUES (?, 1, 1, 'LCU-REVIEW-001', 1, 805, '水管漏水待验收', '整改完毕等待复核', 2)",
      [sId]
    );

    // 拦截停用
    const res: any = await handleBanUser({ schoolId: sId, role: 4 }, { targetUserId: 805 });
    expect(res.success).toBe(false);
    expect(res.code).toBe(409);
    expect(res.errorCode).toBe("FLOW_LOCK_BLOCKED");
    expect(res.data.activeCount).toBe(1);
    expect(res.data.blockedOrders[0].orderNo).toBe("LCU-REVIEW-001");
  });

  it("M17-06: 权限不足校验：role < 4 执行账号封禁与停用时被拦截拒绝", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 6 });
    const sId = tenant.schoolId;

    // 普通师傅 (role = 2) 试图停用他人
    const res = await handleBanUser({ schoolId: sId, role: 2 }, { targetUserId: 999 });
    expect(res.success).toBe(false);
    expect(res.message).toContain("权限不足");
  });

  it("M17-07: 部门删除拦截器在存在在办工单时抛出熔断异常", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 7 });
    const sId = tenant.schoolId;

    await TestHarness.executeSql(
      "INSERT INTO departments (id, schoolId, parentId, path, name) VALUES (20, ?, null, '/20/', '后勤服务部')",
      [sId]
    );

    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, departmentId, title, desc, status) VALUES (?, 1, 1, 'LCU-DEPT-001', 1, 20, '路灯不亮', '主干道路灯', 0)",
      [sId]
    );

    await expect(FlowLockInterceptor.interceptDepartmentDestruction(sId, 20, "后勤服务部")).rejects.toThrow(
      BusinessLockException
    );
  });

  it("M17-08: 已办结(status=3)或已驳回(status=4)的工单不触发 Flow Lock 熔断", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 17, caseIndex: 8 });
    const sId = tenant.schoolId;

    // 创建师傅并创建办结与驳回工单
    await TestHarness.executeSql(
      "INSERT INTO users (id, schoolId, openId, realName, role, isBan) VALUES (808, ?, 'open_808', '退休师傅', 2, 0)",
      [sId]
    );

    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, desc, status) VALUES (?, 1, 1, 'LCU-DONE-001', 1, 808, '已修缮纱窗', '已办结', 3)",
      [sId]
    );

    await TestHarness.executeSql(
      "INSERT INTO patrols (schoolId, campusId, categoryId, orderNo, creatorId, currentHandlerId, title, desc, status) VALUES (?, 1, 1, 'LCU-REJECT-001', 1, 808, '非管辖范围', '已驳回', 4)",
      [sId]
    );

    // 探针扫描应该为 0
    const probe = await FlowLockEngine.probeUserActivePatrols(sId, 808);
    expect(probe.hasActivePatrols).toBe(false);
    expect(probe.activeCount).toBe(0);

    // 停用端点顺利通过
    const res = await handleBanUser({ schoolId: sId, role: 4 }, { targetUserId: 808 });
    expect(res.success).toBe(true);
    expect(res.data.isBan).toBe(1);
  });

  it("M17-09: 小程序端优雅熔断弹窗控制器 FlowLockDialogController 具备静态调用入口与完备实现", () => {
    const dialogFilePath = path.resolve(
      __dirname,
      "../../../WeChatMiniProgram/miniprogram/packages/apps/app-org-center/pages/flow-lock/flowLockDialog.ts"
    );
    expect(fs.existsSync(dialogFilePath)).toBe(true);
    const code = fs.readFileSync(dialogFilePath, "utf-8");
    expect(code).toContain("FlowLockDialogController");
    expect(code).toContain("static showDialog");
    expect(code).toContain("IFlowLockDialogProps");
    expect(code).toContain("wx.showModal");
  });
});
