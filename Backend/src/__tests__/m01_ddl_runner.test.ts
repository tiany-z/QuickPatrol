import { describe, expect, it } from "vitest";
import path from "path";
import fs from "fs";
import {
  DDLSubstrateEngine,
  DEFAULT_CHECK_PROBES,
  initMigrationTable,
  isMigrationUpToDate,
  recordMigrationStub
} from "../shared/index.js";

describe("M01: 27表7视图 DDL 引擎与回滚基座单元测试", () => {
  const realSqlPath = path.resolve(
    process.cwd(),
    "../Docs/数据库/高校后勤巡查e速办v4.0多租户数据库结构设计.sql"
  );

  describe("1. 物理零外键检测拦截器 (Zero Foreign Key Linter)", () => {
    it("检测到 FOREIGN KEY 关键字时应强力阻断并返回错误", () => {
      const illegalSql = `
        CREATE TABLE dummy_illegal (
          id INT PRIMARY KEY,
          schoolId INT NOT NULL,
          CONSTRAINT fk_school FOREIGN KEY (schoolId) REFERENCES schools(id)
        );
      `;
      const res = DDLSubstrateEngine.verifyZeroPhysicalForeignKeys(illegalSql);
      expect(res.status).toBe(0);
      expect(res.content).toContain("零外键铁律违规");
      expect(res.content).toContain("FOREIGN KEY");
    });

    it("注释中包含 foreign key 字样不应误判拦截", () => {
      const safeSqlWithComments = `
        -- 说明: 物理零外键设计 (Zero Foreign Keys)，绝不使用 FOREIGN KEY
        /* 避免物理外键产生的级联死锁 (no foreign key references) */
        CREATE TABLE dummy_safe (
          id INT PRIMARY KEY,
          schoolId INT NOT NULL
        );
      `;
      const res = DDLSubstrateEngine.verifyZeroPhysicalForeignKeys(safeSqlWithComments);
      expect(res.status).toBe(1);
    });

    it("生产环境全量 DDL 脚本必须 100% 满足零物理外键强约束", () => {
      expect(fs.existsSync(realSqlPath)).toBe(true);
      const productionSql = fs.readFileSync(realSqlPath, "utf-8");
      const res = DDLSubstrateEngine.verifyZeroPhysicalForeignKeys(productionSql);
      expect(res.status).toBe(1);
    });
  });

  describe("2. DDL 语句切分与结构解析 (SQL Block Parser)", () => {
    it("应精确提取 CREATE TABLE 与 CREATE VIEW 语句块", () => {
      const sampleSql = `
        SET NAMES utf8mb4;
        USE xc;
        CREATE TABLE \`test_a\` ( id INT PRIMARY KEY );
        CREATE TABLE IF NOT EXISTS test_b ( id INT PRIMARY KEY );
        CREATE OR REPLACE VIEW \`v_test_a\` AS SELECT * FROM test_a;
        INSERT INTO test_a (id) VALUES (1);
      `;
      const blocks = DDLSubstrateEngine.parseSqlBlocks(sampleSql);
      expect(blocks.length).toBe(4);

      const tableBlocks = blocks.filter(b => b.type === "TABLE");
      const viewBlocks = blocks.filter(b => b.type === "VIEW");
      const otherBlocks = blocks.filter(b => b.type === "OTHER");

      expect(tableBlocks.length).toBe(2);
      expect(tableBlocks[0].name).toBe("test_a");
      expect(tableBlocks[1].name).toBe("test_b");

      expect(viewBlocks.length).toBe(1);
      expect(viewBlocks[0].name).toBe("v_test_a");

      expect(otherBlocks.length).toBe(1);
      expect(otherBlocks[0].name).toBe("seed_test_a");
    });

    it("生产 DDL 脚本必须包含精确的 27 张物理表与 7 个全景业务聚合视图", () => {
      const productionSql = fs.readFileSync(realSqlPath, "utf-8");
      const blocks = DDLSubstrateEngine.parseSqlBlocks(productionSql);

      const tableBlocks = blocks.filter(b => b.type === "TABLE");
      const viewBlocks = blocks.filter(b => b.type === "VIEW");

      // 核心断言：27 张物理表
      expect(tableBlocks.length).toBe(27);

      const expectedTableNames = [
        "schools", "campuses", "departments", "categories", "users",
        "permissions", "patrols", "patrols_handle", "patrols_review", "feedbacks",
        "patrol_delay_records", "chat_rooms", "chat_messages", "messages", "posts",
        "post_comments", "post_likes", "school_settings", "operation_logs",
        "patrol_qrcode_points", "ai_agent_sessions", "ai_agent_messages",
        "tags", "tag_members", "chat_group_members", "apps", "schedules"
      ];

      const parsedTableNames = tableBlocks.map(t => t.name);
      for (const expectedName of expectedTableNames) {
        expect(parsedTableNames).toContain(expectedName);
      }

      // 核心断言：7 大全景视图
      expect(viewBlocks.length).toBe(7);

      const expectedViewNames = [
        "v_patrol_details",
        "v_handlers_matrix",
        "v_tenant_overview",
        "v_post_feeds",
        "v_chat_sessions",
        "v_school_admins",
        "v_tag_assignments"
      ];

      const parsedViewNames = viewBlocks.map(v => v.name);
      for (const expectedView of expectedViewNames) {
        expect(parsedViewNames).toContain(expectedView);
      }
    });

    it("除顶层租户表 schools 外，全量业务物理表必须显式包含 schoolId 隔离字段", () => {
      const productionSql = fs.readFileSync(realSqlPath, "utf-8");
      const blocks = DDLSubstrateEngine.parseSqlBlocks(productionSql);
      const tableBlocks = blocks.filter(b => b.type === "TABLE");

      for (const table of tableBlocks) {
        if (table.name === "schools") continue;
        const hasSchoolId = /`?schoolId`?\s+INT/i.test(table.sql);
        expect(hasSchoolId, `表 ${table.name} 必须包含 schoolId 租户字段`).toBe(true);
      }
    });
  });

  describe("3. 原生 CHECK 约束探针配置与定义验证", () => {
    it("预设探针必须覆盖核心状态机与边界枚举", () => {
      expect(DEFAULT_CHECK_PROBES.length).toBeGreaterThanOrEqual(5);

      const targetTables = DEFAULT_CHECK_PROBES.map(p => p.tableName);
      expect(targetTables).toContain("schools");
      expect(targetTables).toContain("users");
      expect(targetTables).toContain("patrols");
      expect(targetTables).toContain("feedbacks");

      // 验证探针配置正确
      const patrolProbe = DEFAULT_CHECK_PROBES.find(p => p.tableName === "patrols");
      expect(patrolProbe?.expectedConstraintName).toBe("chk_patrol_status");
      expect(patrolProbe?.invalidPayload.status).toBe(9); // 9 超出 0~5

      const feedbackProbe = DEFAULT_CHECK_PROBES.find(p => p.tableName === "feedbacks");
      expect(feedbackProbe?.expectedConstraintName).toBe("chk_feedback_score");
      expect(feedbackProbe?.invalidPayload.score).toBe(10); // 10 超出 1~5
    });
  });

  describe("4. 数据库迁移存根管理与哈希比对 (Migration Registry)", () => {
    it("初始化与存根记录函数契约应正确声明", () => {
      expect(typeof initMigrationTable).toBe("function");
      expect(typeof isMigrationUpToDate).toBe("function");
      expect(typeof recordMigrationStub).toBe("function");
    });
  });
});
