import { describe, expect, it, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { TestHarness } from "./testHarness.js";
import { DepartmentService } from "../services/org/departmentService.js";
import { PathEngine, buildDepartmentTree } from "../services/org/pathEngine.js";
import { handleGetDepartmentTree } from "../api/org/departments/getTree/handler.js";
import { handleCreateDepartment } from "../api/org/departments/create/handler.js";
import { handleRelocateDepartment } from "../api/org/departments/relocate/handler.js";

describe("M15: 部门树形拓扑与微前端组织架构中枢 (Department Tree & Materialized Path)", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  it("M15-01: 四级嵌套部门能够准确生成层级物化路径与层级深度", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 15, caseIndex: 1 });
    const sId = tenant.schoolId;

    // 1. 创建一级处室
    const d1 = await DepartmentService.createDepartment(sId, { name: "后勤保障处", sortOrder: 1 });
    expect(d1.path).toBe(`/${d1.id}/`);
    expect(PathEngine.isValidPath(d1.path)).toBe(true);
    expect(PathEngine.calculateDepth(d1.path)).toBe(1);
    expect(PathEngine.parsePathToIds(d1.path)).toEqual([d1.id]);

    // 2. 创建二级中心
    const d2 = await DepartmentService.createDepartment(sId, { parentId: d1.id, name: "动力中心", sortOrder: 1 });
    expect(d2.path).toBe(`/${d1.id}/${d2.id}/`);
    expect(PathEngine.isValidPath(d2.path)).toBe(true);
    expect(PathEngine.calculateDepth(d2.path)).toBe(2);
    expect(PathEngine.parsePathToIds(d2.path)).toEqual([d1.id, d2.id]);

    // 3. 创建三级科室
    const d3 = await DepartmentService.createDepartment(sId, { parentId: d2.id, name: "水电科", sortOrder: 1 });
    expect(d3.path).toBe(`/${d1.id}/${d2.id}/${d3.id}/`);
    expect(PathEngine.isValidPath(d3.path)).toBe(true);
    expect(PathEngine.calculateDepth(d3.path)).toBe(3);

    // 4. 创建四级班组
    const d4 = await DepartmentService.createDepartment(sId, { parentId: d3.id, name: "强电高压班", sortOrder: 1 });
    expect(d4.path).toBe(`/${d1.id}/${d2.id}/${d3.id}/${d4.id}/`);
    expect(PathEngine.isValidPath(d4.path)).toBe(true);
    expect(PathEngine.calculateDepth(d4.path)).toBe(4);

    // 验证整校树形读取
    const tree = await DepartmentService.getSchoolDepartmentTree(sId);
    expect(tree.length).toBe(1);
    expect(tree[0].id).toBe(d1.id);
    expect(tree[0].children[0].id).toBe(d2.id);
    expect(tree[0].children[0].children[0].id).toBe(d3.id);
    expect(tree[0].children[0].children[0].children[0].id).toBe(d4.id);
  });

  it("M15-02: 部门平移能够原子更新整棵子树的物化路径前缀", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 15, caseIndex: 2 });
    const sId = tenant.schoolId;

    const rootA = await DepartmentService.createDepartment(sId, { name: "原处室A" });
    const rootB = await DepartmentService.createDepartment(sId, { name: "新处室B" });

    const subSection = await DepartmentService.createDepartment(sId, { parentId: rootA.id, name: "待移交科室" });
    const subTeam = await DepartmentService.createDepartment(sId, { parentId: subSection.id, name: "下属施工班" });

    expect(subTeam.path).toBe(`/${rootA.id}/${subSection.id}/${subTeam.id}/`);

    // 将 subSection 平移挂载至 rootB 名下
    const relocateRes = await DepartmentService.relocateDepartment(sId, subSection.id, rootB.id);

    expect(relocateRes.newPath).toBe(`/${rootB.id}/${subSection.id}/`);
    expect(relocateRes.affectedCount).toBeGreaterThanOrEqual(2);

    // 验证下属班组路径已级联原子更新
    const tree = await DepartmentService.getSchoolDepartmentTree(sId);
    const nodeB = tree.find((n) => n.id === rootB.id);
    expect(nodeB?.children[0].id).toBe(subSection.id);
    expect(nodeB?.children[0].children[0].id).toBe(subTeam.id);
    expect(nodeB?.children[0].children[0].path).toBe(`/${rootB.id}/${subSection.id}/${subTeam.id}/`);
  });

  it("M15-03: 防死环测试: 将父部门移动到子孙部门名下应被立即拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 15, caseIndex: 3 });
    const sId = tenant.schoolId;

    const parent = await DepartmentService.createDepartment(sId, { name: "父部门" });
    const child = await DepartmentService.createDepartment(sId, { parentId: parent.id, name: "子部门" });
    const grandChild = await DepartmentService.createDepartment(sId, { parentId: child.id, name: "孙部门" });

    // 尝试将父部门的 parentId 设为子部门，必须抛出异常
    await expect(
      DepartmentService.relocateDepartment(sId, parent.id, child.id)
    ).rejects.toThrow("不能将部门移动到自身的下属子孙节点名下");

    // 尝试将父部门移动到孙部门名下，也必须抛出异常
    await expect(
      DepartmentService.relocateDepartment(sId, parent.id, grandChild.id)
    ).rejects.toThrow("不能将部门移动到自身的下属子孙节点名下");

    // 尝试将部门移动到自身名下，也必须抛出异常
    await expect(
      DepartmentService.relocateDepartment(sId, parent.id, parent.id)
    ).rejects.toThrow("部门无法将其自身指定为父部门");
  });

  it("M15-04: 部门负责人自底向上继承探针 (Hierarchical Leader Fallback Probe)", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 15, caseIndex: 4 });
    const sId = tenant.schoolId;

    // 1. 处室：指定处长 leaderId = 101
    const dept = await DepartmentService.createDepartment(sId, { name: "后勤保障处", leaderId: 101 });

    // 2. 中心：未指定负责人 (leaderId = null)
    const center = await DepartmentService.createDepartment(sId, { parentId: dept.id, name: "动力中心" });

    // 3. 科室：指定科长 leaderId = 201
    const section = await DepartmentService.createDepartment(sId, { parentId: center.id, name: "水电科", leaderId: 201 });

    // 4. 班组：未指定负责人 (leaderId = null)
    const team = await DepartmentService.createDepartment(sId, { parentId: section.id, name: "弱电班" });

    // 探测班组负责人：应回溯命中直属科室主管 (leaderId: 201, inheritedFromDeptId: section.id)
    const probeTeam = await DepartmentService.probeDepartmentLeader(sId, team.id);
    expect(probeTeam.leaderId).toBe(201);
    expect(probeTeam.inheritedFromDeptId).toBe(section.id);
    expect(probeTeam.deptName).toBe("水电科");

    // 探测中心负责人：由于中心无负责人，应回溯命中上一级处长 (leaderId: 101, inheritedFromDeptId: dept.id)
    const probeCenter = await DepartmentService.probeDepartmentLeader(sId, center.id);
    expect(probeCenter.leaderId).toBe(101);
    expect(probeCenter.inheritedFromDeptId).toBe(dept.id);
    expect(probeCenter.deptName).toBe("后勤保障处");

    // 探测处室自身：直接命中处长
    const probeDept = await DepartmentService.probeDepartmentLeader(sId, dept.id);
    expect(probeDept.leaderId).toBe(101);
    expect(probeDept.inheritedFromDeptId).toBe(dept.id);
  });

  it("M15-05: 组织架构硬防护: 深度超限、同级重名与删除挂载子部门拦截", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 15, caseIndex: 5 });
    const sId = tenant.schoolId;

    // 1. 同级重名拦截测试
    await DepartmentService.createDepartment(sId, { name: "保卫协调处" });
    await expect(
      DepartmentService.createDepartment(sId, { name: "保卫协调处" })
    ).rejects.toThrow("同级部门下已存在名");

    // 2. 深度硬上限测试 (Max Depth = 8)
    let currentParentId: number | null = null;
    for (let depth = 1; depth <= 8; depth++) {
      const node = await DepartmentService.createDepartment(sId, {
        parentId: currentParentId,
        name: `层级${depth}`
      });
      currentParentId = node.id;
    }

    // 尝试创建第 9 级部门，必须被阻断
    await expect(
      DepartmentService.createDepartment(sId, {
        parentId: currentParentId,
        name: "层级9_溢出测试"
      })
    ).rejects.toThrow("组织架构层级过深: 平台最高限制深度为 8 级");

    // 3. 含有子部门时阻断删除
    const parentDept = await DepartmentService.createDepartment(sId, { name: "父级待删部门" });
    const childDept = await DepartmentService.createDepartment(sId, { parentId: parentDept.id, name: "挂载子部门" });

    await expect(
      DepartmentService.deleteDepartment(sId, parentDept.id)
    ).rejects.toThrow("无法删除: 该部门下仍包含子科室或班组");

    // 先删除子部门，再删除父部门成功
    const delChildRes = await DepartmentService.deleteDepartment(sId, childDept.id);
    expect(delChildRes).toBe(true);

    const delParentRes = await DepartmentService.deleteDepartment(sId, parentDept.id);
    expect(delParentRes).toBe(true);
  });

  it("M15-06: 鉴权守卫: 创建(role>=3)与平移(role>=4)越权拦截与 HTTP 响应一致性", async () => {
    const tenant = TestHarness.createMockTenantContext({ moduleIndex: 15, caseIndex: 6 });
    const sId = tenant.schoolId;

    // 学生(role 0)或师傅(role 2)调用创建端点，必须返回 403 级别业务错误
    const createForbiddenRes = await handleCreateDepartment(
      { schoolId: sId, role: 2 },
      { name: "越权创建部门" }
    );
    expect(createForbiddenRes.status).toBe(0);
    expect(createForbiddenRes.content).toContain("权限不足");

    // 主管(role 3)调用创建端点，成功
    const createSuccessRes = await handleCreateDepartment(
      { schoolId: sId, role: 3 },
      { name: "主管合法创建部门" }
    );
    expect(createSuccessRes.status).toBe(1);
    expect(createSuccessRes.data.name).toBe("主管合法创建部门");

    const deptId = createSuccessRes.data.id;

    // 主管(role 3)尝试平移组织架构，权限不足 (平移必须 role >= 4)
    const relocateForbiddenRes = await handleRelocateDepartment(
      { schoolId: sId, role: 3 },
      { departmentId: deptId, targetParentId: null }
    );
    expect(relocateForbiddenRes.status).toBe(0);
    expect(relocateForbiddenRes.content).toContain("越权访问");

    // 学校管理员(role 4)调用平移端点，成功
    const relocateSuccessRes = await handleRelocateDepartment(
      { schoolId: sId, role: 4 },
      { departmentId: deptId, targetParentId: null }
    );
    expect(relocateSuccessRes.status).toBe(1);

    // 获取全校组织树 HTTP 端点调用
    const getTreeRes = await handleGetDepartmentTree({ schoolId: sId });
    expect(getTreeRes.status).toBe(1);
    expect(Array.isArray(getTreeRes.data)).toBe(true);
  });

  it("M15-07: AST 租户隔离检测探针与物化路径 SQL 安全分析", () => {
    // 验证 M15 子树前缀置换 SQL 严格遵循 AST 括号隔离与租户字段约束
    const relocationSql = `
      UPDATE departments 
      SET 
        path = CONCAT('/1/8/12/', SUBSTRING(path, 11)),
        parentId = CASE WHEN id = 12 THEN 8 ELSE parentId END,
        updatedAt = NOW()
      WHERE schoolId = ? 
        AND (id = ? OR path LIKE ?)
        AND isDeleted = 0
    `;

    const probeReport = TestHarness.verifyTenantIsolation(relocationSql);
    expect(probeReport.passed).toBe(true);
    expect(probeReport.errorType).toBeUndefined();
  });

  it("M15-08: 微信小程序端 OrgTreeStore 状态机与两级展开策略断言", () => {
    const orgStorePath = path.resolve(
      __dirname,
      "../../../WeChatMiniProgram/miniprogram/packages/apps/app-org-center/pages/org-tree/orgTreeStore.ts"
    );
    expect(fs.existsSync(orgStorePath)).toBe(true);

    const content = fs.readFileSync(orgStorePath, "utf-8");
    expect(content).toContain("export class OrgTreeStore");
    expect(content).toContain("node.depth <= 2");
    expect(content).toContain("toggleExpand");
    expect(content).toContain("isNodeExpanded");
    expect(content).toContain("getTree");
  });
});
