import { describe, expect, it } from "vitest";
import {
  declare,
  insert,
  parameterizeSql,
  parseColumns,
  parseWhere,
  remove,
  select,
  update,
  validateSQLFragment,
} from "../shared/index.js";

describe("MySQL 8.x AST 验证与构建器", () => {
  describe("validateSQLFragment (防注入拦截)", () => {
    it("应接受合法的安全字段名", () => {
      expect(validateSQLFragment("user_id").status).toBe(1);
      expect(validateSQLFragment("created_at").status).toBe(1);
    });

    it("应拦截高危关键字与多语句注释", () => {
      expect(validateSQLFragment("DROP TABLE users").status).toBe(0);
      expect(validateSQLFragment("DELETE FROM users").status).toBe(0);
      expect(validateSQLFragment("TRUNCATE TABLE patrols").status).toBe(0);
      expect(validateSQLFragment("user_id; DROP TABLE users").status).toBe(0);
      expect(validateSQLFragment("name -- comment").status).toBe(0);
      expect(validateSQLFragment("/* comment */").status).toBe(0);
    });

    it("应拦截恒真模式与盲注函数", () => {
      expect(validateSQLFragment("OR 1=1").status).toBe(0);
      expect(validateSQLFragment("AND 1 = 1").status).toBe(0);
      expect(validateSQLFragment("SLEEP(5)").status).toBe(0);
      expect(validateSQLFragment("BENCHMARK(10000, MD5('abc'))").status).toBe(0);
    });
  });

  describe("parseColumns (单表强制限制与反引号包裹)", () => {
    it("应正确解析单表列并包裹反引号", () => {
      const usersTable = declare.table("users");
      const idCol = declare.column(usersTable, "id");
      const nameCol = declare.column(usersTable, "username");

      const res = parseColumns(idCol, nameCol);
      expect(res.status).toBe(1);
      expect(res.data?.columnsSQL).toBe("`users`.`id`, `users`.`username`");
      expect(res.data?.tablesSQL).toBe("`users`");
    });

    it("多表混查应被拦截", () => {
      const usersTable = declare.table("users");
      const deptsTable = declare.table("departments");
      const idCol = declare.column(usersTable, "id");
      const deptIdCol = declare.column(deptsTable, "id");

      const res = parseColumns(idCol, deptIdCol);
      expect(res.status).toBe(0);
      expect(res.content).toContain("只能进行单表查询");
    });
  });

  describe("parseWhere (WHERE 条件与集合操作符自动加括号)", () => {
    it("常规比较条件", () => {
      const usersTable = declare.table("users");
      const statusCol = declare.column(usersTable, "status");
      const cond = declare.where.compare(statusCol, "=", declare.customValue("-!!value!!-"));

      const res = parseWhere(cond);
      expect(res.status).toBe(1);
      expect(res.data?.whereSQL).toBe("`users`.`status` = -!!value!!-");
    });

    it("IN 操作符右侧必须自动包裹括号以适配 MySQL", () => {
      const usersTable = declare.table("users");
      const idCol = declare.column(usersTable, "id");
      const cond = declare.where.compare(idCol, "IN", declare.customValue("-!!value!!-"));

      const res = parseWhere(cond);
      expect(res.status).toBe(1);
      expect(res.data?.whereSQL).toBe("`users`.`id` IN (-!!value!!-)");
    });

    it("NOT IN 操作符右侧同样自动包裹括号", () => {
      const usersTable = declare.table("users");
      const idCol = declare.column(usersTable, "id");
      const cond = declare.where.compare(idCol, "NOT IN", declare.customValue("-!!value!!-"));

      const res = parseWhere(cond);
      expect(res.status).toBe(1);
      expect(res.data?.whereSQL).toBe("`users`.`id` NOT IN (-!!value!!-)");
    });
  });

  describe("parameterizeSql (参数化绑定)", () => {
    it("应将 -!!value!!- 替换为 ? 并返回顺序参数", () => {
      const sql = "SELECT * FROM `users` WHERE `status` = -!!value!!- AND `id` IN (-!!value!!-)";
      const values = [1, [10, 20, 30]];
      const res = parameterizeSql(sql, values);

      expect(res.status).toBe(1);
      expect(res.data?.parameterizedSql).toBe("SELECT * FROM `users` WHERE `status` = ? AND `id` IN (?)");
      expect(res.data?.params).toEqual([1, [10, 20, 30]]);
    });
  });

  describe("SelectBuilder (二段式 SELECT)", () => {
    it("应同时导出 sql 与 sqlOnlyId", () => {
      const usersTable = declare.table("users");
      const idCol = declare.column(usersTable, "id");
      const nameCol = declare.column(usersTable, "username");

      const res = select({
        columns: [idCol, nameCol],
        where: [declare.where.compare(nameCol, "=", declare.customValue("-!!value!!-"))],
        limit: declare.limit.indexSize(0, 10),
      });

      expect(res.status).toBe(1);
      expect(res.data?.tableName).toBe("users");
      expect(res.data?.sql).toContain("SELECT `users`.`id`, `users`.`username`");
      expect(res.data?.sqlOnlyId).toContain("SELECT `users`.`id`");
      expect(res.data?.sql).toContain("FROM `users`");
      expect(res.data?.sql).toContain("LIMIT 10");
    });
  });

  describe("CUD 构建器与 Undo 撤销闭包", () => {
    const usersTable = declare.table("users");

    it("insertBuilder 应生成带有 DELETE 逻辑的 Undo", () => {
      const nameCol = declare.column(usersTable, "username");
      const phoneCol = declare.column(usersTable, "phone");

      const res = insert({ columns: [nameCol, phoneCol] });
      expect(res.status).toBe(1);
      expect(res.data?.tableName).toBe("users");
      expect(res.data?.sql).toContain("INSERT INTO `users` (`username`, `phone`)");
      expect(res.data?.sql).toContain("VALUES (?, ?)");

      const undo = res.data!.createUndoFn(999);
      expect(undo.undoSql).toBe("DELETE FROM `users` WHERE `id` = ?");
      expect(undo.undoParams).toEqual([999]);
    });

    it("updateBuilder 正常生成更新 SQL 与旧快照还原 Undo", () => {
      const res = update({
        table: usersTable,
        targetId: 105,
        updateData: { phone: "13800000000", role: "教师" },
      });

      expect(res.status).toBe(1);
      expect(res.data?.tableName).toBe("users");
      expect(res.data?.lockSql).toBe("SELECT * FROM `users` WHERE `id` = ?");
      expect(res.data?.updateSql).toContain("UPDATE `users`\nSET `phone` = ?, `role` = ?\nWHERE `id` = ?");
      expect(res.data?.updateParams).toEqual(["13800000000", "教师", 105]);

      const undo = res.data!.createUndoFn({ id: 105, phone: "13911111111", role: "学生" });
      expect(undo.undoSql).toContain("UPDATE `users`\nSET `phone` = ?, `role` = ?\nWHERE `id` = ?");
      expect(undo.undoParams).toEqual(["13911111111", "学生", 105]);
    });

    it("updateBuilder 面对空快照应安全返回空 Undo 操作（防崩保护）", () => {
      const res = update({
        table: usersTable,
        targetId: 105,
        updateData: { unMatchedColumn: "val" },
      });
      expect(res.status).toBe(1);

      const emptyUndo = res.data!.createUndoFn({});
      expect(emptyUndo.undoSql).toBe("");
      expect(emptyUndo.undoParams).toEqual([]);
    });

    it("deleteBuilder 正常生成删除 SQL 与旧记录插回 Undo", () => {
      const res = remove({ table: usersTable, targetId: 205 });
      expect(res.status).toBe(1);
      expect(res.data?.tableName).toBe("users");
      expect(res.data?.lockSql).toBe("SELECT * FROM `users` WHERE `id` = ?");
      expect(res.data?.deleteSql).toBe("DELETE FROM `users`\nWHERE `id` = ?");
      expect(res.data?.deleteParams).toEqual([205]);

      const undo = res.data!.createUndoFn({ id: 205, username: "test_user", phone: "15900000000" });
      expect(undo.undoSql).toContain("INSERT INTO `users` (`id`, `username`, `phone`)");
      expect(undo.undoSql).toContain("VALUES (?, ?, ?)");
      expect(undo.undoParams).toEqual([205, "test_user", "15900000000"]);
    });

    it("deleteBuilder 面对空快照应安全返回空 Undo 操作（防崩保护）", () => {
      const res = remove({ table: usersTable, targetId: 205 });
      expect(res.status).toBe(1);

      const emptyUndo = res.data!.createUndoFn({});
      expect(emptyUndo.undoSql).toBe("");
      expect(emptyUndo.undoParams).toEqual([]);
    });
  });
});
