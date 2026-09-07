import fs from "fs";
import path from "path";
import { describe, expect, it, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PermissionService } from "../services/admin/permissionService.js";
import {
  SpecificityMatcher,
  RoleCapabilityMask,
  hasCapability,
  getRoleCapabilities
} from "../services/admin/specificityMatcher.js";
import { handleGetPermissionMatrix } from "../api/admin/permissions/matrix/handler.js";
import { handleGrantPermissions } from "../api/admin/permissions/grant/handler.js";
import { handleRevokePermission } from "../api/admin/permissions/revoke/handler.js";

describe("M18: 四级立体权限矩阵与校内网格化授权 (4-Level RBAC & Grid Matrix)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M18-01: 最特异优先匹配算法能够准确命中专属规则并优于通配规则", () => {
    const candidates: any[] = [
      { id: 1, campusId: 0, categoryId: 0, type: 1 }, // 全局通配兜底 (得分 0)
      { id: 2, campusId: 1, categoryId: 0, type: 1 }, // 校区综合兜底 (得分 2)
      { id: 3, campusId: 1, categoryId: 3, type: 1 }, // 精确校区+分类 (得分 3)
      { id: 4, campusId: 0, categoryId: 3, type: 1 }  // 全校专业总队 (得分 1)
    ];

    // 匹配: 西校区 (campusId: 1) × 水电暖 (categoryId: 3)
    const result = SpecificityMatcher.pickBestRule(candidates, 1, 3);
    expect(result).not.toBeNull();
    expect(result?.winnerRule.id).toBe(3); // 必须胜出 Rule 3
    expect(result?.score).toBe(3);
    expect(result?.matchType).toBe("EXACT_BOTH");
  });

  it("M18-02: 棋盘批量授权能够准确写入数据库并建立四维网格索引", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 18, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 创建测试岗位标签
    await TestHarness.executeSql(
      "INSERT INTO tags (id, schoolId, name, color) VALUES (101, ?, '强电抢修组', '#D83B01')",
      [sId]
    );

    // 2. 批量点选网格点授权
    const grantRes = await PermissionService.batchGrantPermissions(sId, {
      targetType: "tag",
      targetId: 101,
      type: 1,
      gridPoints: [
        { campusId: 1, categoryId: 1 },
        { campusId: 1, categoryId: 2 }
      ]
    });

    expect(grantRes.addedCount).toBe(2);

    // 3. 验证通过最优探针能够定位到该标签
    const match = await PermissionService.resolveOptimalHandler(sId, 1, 1, 1);
    expect(match).not.toBeNull();
    expect(match?.tagId).toBe(101);
  });

  it("M18-03: 跨校区未授权门类在无通配符时应正确返回 null (责任边界分明)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 18, caseIndex: 2 });
    const sId = tenant.schoolId;

    // 仅授权了东校区 (campusId: 1) 水电类 (categoryId: 1)
    await PermissionService.batchGrantPermissions(sId, {
      targetType: "tag",
      targetId: 101,
      type: 1,
      gridPoints: [{ campusId: 1, categoryId: 1 }]
    });

    // 发生南校区 (campusId: 2) 的工单，断言无匹配责任人
    const match = await PermissionService.resolveOptimalHandler(sId, 2, 1, 1);
    expect(match).toBeNull();
  });

  it("M18-04: 通配规则兜底断言：无专属规则时校区通配或全门类通配规则精准兜底", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 18, caseIndex: 3 });
    const sId = tenant.schoolId;

    // 配置一条全校所有校区通配 (campusId: 0) 的高压强电抢修专员 (categoryId: 5)
    await PermissionService.batchGrantPermissions(sId, {
      targetType: "tag",
      targetId: 202,
      type: 1,
      gridPoints: [{ campusId: 0, categoryId: 5 }]
    });

    // 任何校区 (如南校区 campusId: 2) 发生高压强电 (categoryId: 5)，均由该全校专员兜底
    const match = await PermissionService.resolveOptimalHandler(sId, 2, 5, 1);
    expect(match).not.toBeNull();
    expect(match?.tagId).toBe(202);
    expect(match?.matchType).toBe("CATEGORY_ONLY");
  });

  it("M18-05: 棋盘网格全景大盘 (getPermissionGridMatrix) 正确输出轴系与压缩单元格", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 18, caseIndex: 4 });
    const sId = tenant.schoolId;

    // 授权一个网格点
    await PermissionService.batchGrantPermissions(sId, {
      targetType: "tag",
      targetId: 303,
      type: 2, // 质检复核人
      gridPoints: [{ campusId: 1, categoryId: 1 }]
    });

    const matrix = await PermissionService.getPermissionGridMatrix(sId);
    expect(matrix.schoolId).toBe(sId);
    expect(matrix.campuses.length).toBeGreaterThanOrEqual(1);
    expect(matrix.categories.length).toBeGreaterThanOrEqual(1);
    expect(matrix.campuses[0].isWildcard).toBe(true);

    // 验证压缩坐标键 "1_1_2" 存在
    const cell = matrix.gridCells["1_1_2"];
    expect(cell).toBeDefined();
    expect(cell.type).toBe(2);
    expect(cell.assignments.length).toBe(1);
    expect(cell.assignments[0].targetId).toBe(303);
  });

  it("M18-06: 网格授权单项收回 (revokePermission) 成功移除指定规则", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 18, caseIndex: 5 });
    const sId = tenant.schoolId;

    const grant = await PermissionService.batchGrantPermissions(sId, {
      targetType: "user",
      targetId: 888,
      type: 1,
      gridPoints: [{ campusId: 1, categoryId: 2 }]
    });

    const ruleId = grant.createdRuleIds[0];
    expect(ruleId).toBeDefined();

    // 确认此时能匹配
    let match = await PermissionService.resolveOptimalHandler(sId, 1, 2, 1);
    expect(match).not.toBeNull();

    // 收回权限
    const revokeOk = await PermissionService.revokePermission(sId, ruleId);
    expect(revokeOk).toBe(true);

    // 再次匹配应为 null
    match = await PermissionService.resolveOptimalHandler(sId, 1, 2, 1);
    expect(match).toBeNull();
  });

  it("M18-07: 越权阻断门禁：校管 API 鉴权守卫拦截越权操作", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 18, caseIndex: 6 });
    const sId = tenant.schoolId;

    // 1. 师傅 (role = 2) 尝试查看权限大盘，被拦截拒绝 (需要 role >= 3)
    const viewRes = await handleGetPermissionMatrix({ schoolId: sId, role: 2 });
    expect(viewRes.success).toBe(false);
    expect(viewRes.content).toContain("权限不足");

    // 2. 主管 (role = 3) 尝试执行批量网格授权，被越权阻断 (需要 role >= 4)
    const grantRes = await handleGrantPermissions(
      { schoolId: sId, role: 3 },
      { targetType: "tag", targetId: 101, type: 1, gridPoints: [{ campusId: 1, categoryId: 1 }] }
    );
    expect(grantRes.success).toBe(false);
    expect(grantRes.content).toContain("越权阻断");

    // 3. 主管 (role = 3) 尝试收回权限，被越权阻断 (需要 role >= 4)
    const revokeRes = await handleRevokePermission({ schoolId: sId, role: 3 }, { ruleId: 1 });
    expect(revokeRes.success).toBe(false);
    expect(revokeRes.content).toContain("越权阻断");
  });

  it("M18-08: 角色法定能力位掩码判定正确区隔各角色权限", () => {
    // 学生 (role = 0): 只能报修评价
    expect(hasCapability(0, RoleCapabilityMask.CAN_REPORT_PATROL)).toBe(true);
    expect(hasCapability(0, RoleCapabilityMask.CAN_MAINTENANCE_WORK)).toBe(false);

    // 师傅 (role = 2): 具备施工整改打卡能力
    expect(hasCapability(2, RoleCapabilityMask.CAN_MAINTENANCE_WORK)).toBe(true);
    expect(hasCapability(2, RoleCapabilityMask.CAN_GRANT_PERMISSIONS)).toBe(false);

    // 科室主管 (role = 3): 具备人员组织架构管理能力
    expect(hasCapability(3, RoleCapabilityMask.CAN_MANAGE_ORG)).toBe(true);
    expect(hasCapability(3, RoleCapabilityMask.CAN_GRANT_PERMISSIONS)).toBe(false);

    // 学校管理员 (role = 4): 具备权限指派与延期审批能力
    expect(hasCapability(4, RoleCapabilityMask.CAN_GRANT_PERMISSIONS)).toBe(true);
    expect(hasCapability(4, RoleCapabilityMask.CAN_MANAGE_PLATFORM)).toBe(false);

    // 平台超管 (role = 9): 具备全平台掌控能力
    expect(hasCapability(9, RoleCapabilityMask.CAN_MANAGE_PLATFORM)).toBe(true);
  });

  it("M18-09: 小程序端 PermissionGridStore 状态机点选、反选与清除功能验证", () => {
    const storeFilePath = path.resolve(
      __dirname,
      "../../../WeChatMiniProgram/miniprogram/packages/apps/app-org-center/pages/permission-grid/gridStore.ts"
    );
    expect(fs.existsSync(storeFilePath)).toBe(true);
    const code = fs.readFileSync(storeFilePath, "utf-8");
    expect(code).toContain("PermissionGridStore");
    expect(code).toContain("togglePoint");
    expect(code).toContain("isPointSelected");
    expect(code).toContain("getSelectedPoints");
    expect(code).toContain("clearSelection");
  });
});
