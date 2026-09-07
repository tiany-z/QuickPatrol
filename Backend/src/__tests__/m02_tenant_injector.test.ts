import { describe, expect, it } from "vitest";
import {
  and,
  col,
  declare,
  eq,
  insert,
  or,
  remove,
  select,
  table,
  update,
  TenantASTInjector,
  TenantContext,
  isGlobalTable,
} from "../shared/index.js";

describe("M02: MySQL AST 编译器与租户自动注入器 (Tenant AST Interceptor)", () => {
  const patrolsTable = table("patrols");
  const defaultTenantContext: TenantContext = {
    schoolId: 1,
    userId: 1001,
    role: 1,
  };

  describe("测试 1: 普通 SELECT 语法树自动注入 schoolId 与 isDeleted", () => {
    it("应将 status = 0 条件自动强化注入 (schoolId = 1) 与 (isDeleted = 0)", () => {
      const idCol = col(patrolsTable, "id");
      const orderNoCol = col(patrolsTable, "orderNo");
      const statusCol = col(patrolsTable, "status");

      const res = select(
        {
          columns: [idCol, orderNoCol],
          where: [eq(statusCol, 0)],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      expect(res.data).toBeDefined();

      const sql = res.data!.sql;
      // 断言包含租户过滤条件与软删除约束
      expect(sql).toContain("`patrols`.`schoolId` = ?");
      expect(sql).toMatch(/`patrols`\.`isDeleted`\s*=\s*\?/);

      // 断言参数序列最后两位依次为租户 ID (1) 与软删除标识 (0)
      const params = res.data!.boundParams || [];
      expect(params.length).toBeGreaterThanOrEqual(2);
      expect(params.slice(-2)).toEqual([1, 0]);
    });

    it("当原 WHERE 条件为空时，应直接生成租户与软删除双重约束", () => {
      const idCol = col(patrolsTable, "id");

      const res = select(
        {
          columns: [idCol],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      const sql = res.data!.sql;
      expect(sql).toContain("`patrols`.`schoolId` = ?");
      expect(sql).toMatch(/`patrols`\.`isDeleted`\s*=\s*\?/);
      expect(res.data!.boundParams).toEqual([1, 0]);
    });
  });

  describe("测试 2: 复杂嵌套 OR 条件组外层括号防御性包裹 (防短路越权穿透)", () => {
    it("多分支 OR 条件必须被 WhereGroupNode 顶级包裹，杜绝 AND 优先级短路", () => {
      const idCol = col(patrolsTable, "id");
      const campusCol = col(patrolsTable, "campusId");

      // 原业务条件: campusId = 1 OR campusId = 2
      const res = select(
        {
          columns: [idCol],
          where: [eq(campusCol, 1), or(), eq(campusCol, 2)],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      const sql = res.data!.sql;

      // 验证最外层括号防短路结构: ((原OR条件)) AND (schoolId = ?) AND (isDeleted = ?)
      expect(sql).toMatch(
        /WHERE\s*\(\s*`patrols`\.`campusId`\s*=\s*\?\s*OR\s*`patrols`\.`campusId`\s*=\s*\?\s*\)\s*AND\s*`patrols`\.`schoolId`\s*=\s*\?\s*AND\s*`patrols`\.`isDeleted`\s*=\s*\?/
      );

      // 参数序列应完整映射: [1, 2, 1, 0]
      expect(res.data!.boundParams).toEqual([1, 2, 1, 0]);
    });

    it("支持字符串列名快捷 DSL: [eq('campusId', 1), or(), eq('campusId', 2)]", () => {
      const idCol = col(patrolsTable, "id");

      const res = select(
        {
          columns: [idCol],
          where: [eq("campusId", 1), or(), eq("campusId", 2)],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      const sql = res.data!.sql;
      expect(sql).toMatch(/\(`campusId`\s*=\s*\?\s*OR\s*`campusId`\s*=\s*\?\)/);
      expect(res.data!.boundParams).toEqual([1, 2, 1, 0]);
    });
  });

  describe("测试 3: 多表 JOIN 查询别名自动穿透注入", () => {
    it("多表关联时，必须为每个业务物理表的别名分别注入租户与软删除条件", () => {
      const pTable = table("patrols", "p");
      const cTable = table("campuses", "c");
      const uTable = table("users", "u");

      const pId = col(pTable, "id");
      const cName = col(cTable, "name");
      const uName = col(uTable, "realName");

      const res = select(
        {
          columns: [pId, cName, uName],
          tables: [pTable, cTable, uTable],
          joins: [
            {
              type: "LEFT",
              table: cTable,
              on: [eq(col(pTable, "campusId"), col(cTable, "id"))],
            },
            {
              type: "LEFT",
              table: uTable,
              on: [eq(col(pTable, "creatorId"), col(uTable, "id"))],
            },
          ],
          where: [eq(col(pTable, "status"), 0)],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      const sql = res.data!.sql;

      // 断言 JOIN 从句渲染正确
      expect(sql).toContain("FROM `patrols` AS `p`");
      expect(sql).toContain("LEFT JOIN `campuses` AS `c` ON `p`.`campusId` = `c`.`id`");
      expect(sql).toContain("LEFT JOIN `users` AS `u` ON `p`.`creatorId` = `u`.`id`");

      // 断言三个表的别名均被精准注入了租户条件与软删除过滤
      expect(sql).toContain("`p`.`schoolId` = ?");
      expect(sql).toContain("`p`.`isDeleted` = ?");
      expect(sql).toContain("`c`.`schoolId` = ?");
      expect(sql).toContain("`c`.`isDeleted` = ?");
      expect(sql).toContain("`u`.`schoolId` = ?");
      expect(sql).toContain("`u`.`isDeleted` = ?");

      // 参数序列包含原业务值 (0) 与 3 个表的 (schoolId, isDeleted) 对
      expect(res.data!.boundParams).toEqual([0, 1, 0, 1, 0, 1, 0]);
    });
  });

  describe("测试 4: INSERT 操作自动注入并校验 schoolId", () => {
    it("4a: 未提供 schoolId 时，自动在列与值中注入当前上下文的 schoolId", () => {
      const nameCol = col(patrolsTable, "title");
      const descCol = col(patrolsTable, "desc");

      const res = insert(
        {
          columns: [nameCol, descCol],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      expect(res.data!.sql).toContain("INSERT INTO `patrols` (`title`, `desc`, `schoolId`)");
      expect(res.data!.sql).toContain("VALUES (?, ?, ?)");

      // 验证撤回闭包带有租户限定
      const undo = res.data!.createUndoFn(888);
      expect(undo.undoSql).toBe("DELETE FROM `patrols` WHERE `id` = ? AND `schoolId` = ?");
      expect(undo.undoParams).toEqual([888, 1]);
    });

    it("4b: 在 insert payload 中故意伪造不同的 schoolId 应被严格拦截", () => {
      const res = insert(
        {
          table: patrolsTable,
          columns: [col(patrolsTable, "title")],
          data: {
            title: "跨校伪造工单",
            schoolId: 999, // 试图注入学校 999
          },
        },
        defaultTenantContext // 当前会话为学校 1
      );

      expect(res.status).toBe(0);
      expect(res.content).toContain("[M02 越权写入阻断]");
      expect(res.content).toContain("当前登录会话隶属于学校 [1]");
    });
  });

  describe("测试 5: DELETE 操作透明转译为 UPDATE isDeleted=1 软删除", () => {
    it("调用 remove() 应转译为 UPDATE 语句，并注入 schoolId 与 isDeleted 约束", () => {
      const res = remove(
        {
          table: patrolsTable,
          targetId: 501,
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      // 动词必须转译为 UPDATE
      expect(res.data!.deleteSql).toContain("UPDATE `patrols`\nSET `isDeleted` = ?\nWHERE");
      // 必须锁定本校记录且当前未被删除
      expect(res.data!.deleteSql).toContain("`patrols`.`schoolId` = ?");
      expect(res.data!.deleteSql).toContain("`patrols`.`isDeleted` = ?");
      expect(res.data!.deleteParams).toEqual([1, 501, 1, 0]); // [SET isDeleted=1, id=501, schoolId=1, isDeleted=0]

      // 撤回操作应是将 isDeleted 翻转回 0
      const undo = res.data!.createUndoFn({ id: 501, title: "旧快照" });
      expect(undo.undoSql).toContain("UPDATE `patrols`\nSET `isDeleted` = ?\nWHERE");
      expect(undo.undoParams[0]).toBe(0); // SET isDeleted = 0
    });
  });

  describe("测试 6: 全局表 schools 与超管特权合法豁免测试", () => {
    it("6a: 全局表 schools 无论是否有租户上下文，均不注入 WHERE schoolId = ?", () => {
      const schoolsTable = table("schools");
      const nameCol = col(schoolsTable, "name");

      // 即使传入了上下文，全局表也豁免 schoolId 过滤
      const res = select(
        {
          columns: [nameCol],
        },
        defaultTenantContext
      );

      expect(res.status).toBe(1);
      expect(res.data!.sql).not.toContain("schoolId");
      expect(isGlobalTable("schools")).toBe(true);
      expect(isGlobalTable("__schema_migrations")).toBe(true);
    });

    it("6b: 超级管理员 (role=9) 开启 bypassTenantFilter 时，豁免 schoolId 但严格保留 isDeleted", () => {
      const superAdminCtx: TenantContext = {
        schoolId: 1,
        userId: "sa-01",
        role: 9,
        bypassTenantFilter: true,
      };

      const res = select(
        {
          columns: [col(patrolsTable, "id")],
          where: [eq(col(patrolsTable, "status"), 1)],
        },
        superAdminCtx
      );

      expect(res.status).toBe(1);
      const sql = res.data!.sql;
      // 不含 schoolId 约束
      expect(sql).not.toContain("`patrols`.`schoolId` = ?");
      // 但必须严格保留 isDeleted 软删除约束
      expect(sql).toContain("`patrols`.`isDeleted` = ?");
      expect(res.data!.boundParams).toEqual([1, 0]); // [status=1, isDeleted=0]
    });
  });

  describe("测试 7: 缺少租户上下文或非法 schoolId 强力拦截抛错测试", () => {
    it("未提供租户上下文时，直接致命拒绝", () => {
      const res = select({
        columns: [col(patrolsTable, "id")],
      });

      expect(res.status).toBe(0);
      expect(res.content).toContain("[M02 租户引擎致命拒绝]");
      expect(res.content).toContain("必须提供合法的 schoolId 租户上下文");
    });

    it("提供非法 schoolId (<= 0 或 非整数) 时，立即熔断阻断", () => {
      const zeroCtx = { schoolId: 0 };
      const negCtx = { schoolId: -5 };
      const nanCtx = { schoolId: NaN };

      expect(select({ columns: [col(patrolsTable, "id")] }, zeroCtx).status).toBe(0);
      expect(select({ columns: [col(patrolsTable, "id")] }, negCtx).status).toBe(0);
      expect(select({ columns: [col(patrolsTable, "id")] }, nanCtx).status).toBe(0);
    });

    it("UPDATE 操作中试图跨校修改 schoolId 应被阻断", () => {
      const res = update(
        {
          table: patrolsTable,
          targetId: 101,
          updateData: {
            title: "合法标题",
            schoolId: 2, // 试图修改为学校 2
          },
        },
        defaultTenantContext // 当前学校为 1
      );

      expect(res.status).toBe(0);
      expect(res.content).toContain("[M02 越权更新阻断]");
    });
  });
});
