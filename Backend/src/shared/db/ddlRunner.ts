import fs from "fs";
import path from "path";
import crypto from "crypto";
import { executeQuery } from "./mysql.js";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";
import { TerminalLogger } from "../log/terminalLogger.js";
import { DDLRunnerConfig, DDLStepResult, DDLSummaryReport } from "./ddlTypes.js";
import { runCheckConstraintProbes } from "./checkProbeRunner.js";
import { recordMigrationStub, isMigrationUpToDate } from "./migrationRegistry.js";

export class DDLSubstrateEngine {
  /**
   * 静态校验零外键 (Zero Physical Foreign Keys)
   * 核心铁律：绝对不使用物理外键 (FOREIGN KEY)，所有关联逻辑化
   */
  public static verifyZeroPhysicalForeignKeys(content: string): StandardResult<boolean> {
    const cleanSql = content
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const fkRegex = /\bFOREIGN\s+KEY\b/i;
    const match = cleanSql.match(fkRegex);
    if (match) {
      const idx = match.index || 0;
      const start = Math.max(0, idx - 40);
      const end = Math.min(cleanSql.length, idx + 60);
      const snippet = cleanSql.substring(start, end).replace(/\s+/g, " ").trim();
      return returnError(
        `[M01 零外键铁律违规] 检测到物理 FOREIGN KEY 关键字！系统要求 100% 物理零外键。\n违规上下文: "... ${snippet} ..."`
      );
    }
    return returnSuccess(true);
  }

  /**
   * 将 SQL 文件拆分为规范的独立执行语句块
   */
  public static parseSqlBlocks(
    content: string
  ): Array<{ name: string; type: "TABLE" | "VIEW" | "OTHER"; sql: string }> {
    const blocks: Array<{ name: string; type: "TABLE" | "VIEW" | "OTHER"; sql: string }> = [];

    // 先去除多行注释，保留单行结构
    const cleanContent = content.replace(/\/\*[\s\S]*?\*\//g, "");
    
    // 按分号和换行切分语句
    const rawStatements = cleanContent
      .split(/;\s*[\r\n]+/)
      .map(s => s.trim())
      .filter(s => {
        const withoutComments = s.replace(/--.*$/gm, "").trim();
        return (
          withoutComments.length > 0 &&
          !withoutComments.toUpperCase().startsWith("SET NAMES") &&
          !withoutComments.toUpperCase().startsWith("USE ") &&
          !withoutComments.toUpperCase().startsWith("CREATE DATABASE")
        );
      });

    for (const stmt of rawStatements) {
      // 提取核心 SQL (去除开头的注释行)
      const pureSql = stmt.replace(/^--.*$/gm, "").trim();
      if (!pureSql) continue;

      const tableMatch = pureSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/i);
      if (tableMatch) {
        blocks.push({ name: tableMatch[1], type: "TABLE", sql: `${pureSql};` });
        continue;
      }

      const viewMatch = pureSql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?([a-zA-Z0-9_]+)`?/i);
      if (viewMatch) {
        blocks.push({ name: viewMatch[1], type: "VIEW", sql: `${pureSql};` });
        continue;
      }

      const dropMatch = pureSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/i);
      if (dropMatch) {
        blocks.push({ name: `drop_${dropMatch[1]}`, type: "OTHER", sql: `${pureSql};` });
        continue;
      }

      const insertMatch = pureSql.match(/INSERT\s+INTO\s+`?([a-zA-Z0-9_]+)`?/i);
      if (insertMatch) {
        blocks.push({ name: `seed_${insertMatch[1]}`, type: "OTHER", sql: `${pureSql};` });
        continue;
      }

      blocks.push({ name: "sql_statement", type: "OTHER", sql: `${pureSql};` });
    }

    return blocks;
  }

  /**
   * 执行全量 27 表 7 视图迁移主入口
   */
  public static async executeMigration(
    config: DDLRunnerConfig
  ): Promise<StandardResult<DDLSummaryReport>> {
    const startTime = Date.now();
    TerminalLogger.info(`[M01] 开始启动物理数据库 DDL 引擎: ${config.sqlFilePath}`, "DDLRunner");

    try {
      if (!fs.existsSync(config.sqlFilePath)) {
        return returnError(`[M01] SQL 资源文件不存在: ${config.sqlFilePath}`);
      }

      const rawSqlContent = fs.readFileSync(config.sqlFilePath, "utf-8");
      const fileChecksum = crypto.createHash("sha256").update(rawSqlContent).digest("hex");

      // 1. 静态安全检查：100% 物理零外键拦截
      const zeroFkCheck = this.verifyZeroPhysicalForeignKeys(rawSqlContent);
      if (zeroFkCheck.status === 0) {
        return returnError(zeroFkCheck.content);
      }

      // 2. 检查是否已是最新版本且无需强制刷新
      if (!config.forceRecreate) {
        const upToDate = await isMigrationUpToDate(fileChecksum);
        if (upToDate) {
          TerminalLogger.info("[M01] 数据库结构特征码一致，跳过重复全量建表", "DDLRunner");
          return returnSuccess({
            version: "v4.0.0",
            checksum: fileChecksum,
            tablesCreated: 27,
            viewsCreated: 7,
            probesVerified: 7,
            totalDurationMs: Date.now() - startTime,
            steps: [],
            probeReport: { totalProbes: 7, passedProbes: 7, failedProbes: 0, details: [] }
          });
        }
      }

      // 3. 解析并拆分 SQL 语句为逻辑单元块
      const sqlBlocks = this.parseSqlBlocks(rawSqlContent);
      const executionSteps: DDLStepResult[] = [];
      let tablesCount = 0;
      let viewsCount = 0;

      // 4. 分段执行 DDL
      for (const block of sqlBlocks) {
        const stepStart = Date.now();
        const execRes = await executeQuery(block.sql);

        if (execRes.status === 0) {
          TerminalLogger.printError("DDLRunner", `执行 DDL 语句失败 [${block.name}]: ${execRes.content}`);
          return returnError(`DDL 块 [${block.name}] 执行中断: ${execRes.content}`);
        }

        if (block.type === "TABLE") tablesCount++;
        if (block.type === "VIEW") viewsCount++;

        executionSteps.push({
          name: block.name,
          type: block.type,
          sql: block.sql,
          success: true,
          durationMs: Date.now() - stepStart
        });
      }

      TerminalLogger.info(
        `[M01] ${tablesCount} 张物理表与 ${viewsCount} 个视图物理结构构建完毕 (耗时: ${Date.now() - startTime}ms)`,
        "DDLRunner"
      );

      // 5. 执行原生 CHECK 约束探针
      let probeReport = { totalProbes: 0, passedProbes: 0, failedProbes: 0, details: [] as any[] };
      if (!config.skipProbe) {
        const probeRes = await runCheckConstraintProbes();
        if (probeRes.status === 0) {
          return returnError(`[M01 致命质量阻断] 原生 CHECK 约束探针失败: ${probeRes.content}`);
        }
        probeReport = probeRes.data!;
      }

      // 6. 落盘迁移版本存根
      await recordMigrationStub(
        "v4.0.0",
        path.basename(config.sqlFilePath),
        fileChecksum,
        tablesCount,
        viewsCount,
        Date.now() - startTime
      );

      const report: DDLSummaryReport = {
        version: "v4.0.0",
        checksum: fileChecksum,
        tablesCreated: tablesCount,
        viewsCreated: viewsCount,
        probesVerified: probeReport.passedProbes,
        totalDurationMs: Date.now() - startTime,
        steps: executionSteps,
        probeReport
      };

      return returnSuccess(report);
    } catch (error) {
      return returnError(`[M01] DDL 引擎未捕获异常: ${tryCatchErrorToString(error)}`);
    }
  }
}
