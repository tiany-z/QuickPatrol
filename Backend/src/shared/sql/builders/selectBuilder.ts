import {
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../flow/result.js";
import {
  getColumnName,
  getTableName,
  parseColumns,
  parseColumnsInternal,
  parseLimit,
  parseOrderBy,
  parseWhere,
} from "../ast/validator.js";
import { parameterizeSql } from "../ast/parameterizer.js";
import { TenantASTInjector } from "../ast/tenantInjector.js";
import type { TenantContext } from "../ast/tenantTypes.js";
import type {
  NeedInputValue,
  SelectBuildResult,
  SelectCompose,
  TableNode,
} from "../type.js";

/**
 * 提取当前查询语句所涉及的全部去重物理表/别名节点
 */
function extractParticipatingTables(compose: SelectCompose): TableNode[] {
  const tableMap = new Map<string, TableNode>();

  if (compose.tables) {
    for (const t of compose.tables) {
      if (t && t.table) {
        const key = t.as || t.table;
        tableMap.set(key, t);
      }
    }
  }

  if (compose.columns) {
    for (const col of compose.columns) {
      if (col && col.tableNode && col.tableNode.table) {
        const key = col.tableNode.as || col.tableNode.table;
        if (!tableMap.has(key)) {
          tableMap.set(key, col.tableNode);
        }
      }
    }
  }

  if (compose.joins) {
    for (const j of compose.joins) {
      if (j && j.table && j.table.table) {
        const key = j.table.as || j.table.table;
        if (!tableMap.has(key)) {
          tableMap.set(key, j.table);
        }
      }
    }
  }

  return Array.from(tableMap.values());
}

/**
 * 编译 SELECT 查询 AST 树并透明注入多租户行级隔离条件
 * 
 * @param compose 查询 AST 结构定义
 * @param context 租户多维鉴权上下文
 */
export function select(
  compose: SelectCompose,
  context?: TenantContext
): StandardResult<SelectBuildResult> {
  try {
    const { allColumns, columns, orderBy, limit, distinct, joins } = compose;

    if (!columns || columns.length === 0) {
      return returnError("SELECT 列名列表不能为空");
    }

    const participatingTables = extractParticipatingTables(compose);
    const primaryTableNode = participatingTables[0] || columns[0].tableNode;
    const rawTableName = primaryTableNode.table;

    // 1. 核心前置拦截：对涉及的所有表（主表及 JOIN 关联表）自动注入租户与软删除限定
    const augmentRes = TenantASTInjector.augmentWhere(
      participatingTables,
      compose.where,
      context,
      { includeDeleted: compose.includeDeleted }
    );
    if (augmentRes.status === 0) {
      return augmentRes as any;
    }
    const finalWhere = augmentRes.data!;

    // 2. 解析查询列与数据源表 (支持 JOIN 场景下的多表列解析)
    const hasJoins = Boolean(joins && joins.length > 0);
    const parseColumnsResult = hasJoins
      ? parseColumnsInternal(columns, true)
      : parseColumns(...columns);

    if (parseColumnsResult.status === 0) {
      return parseColumnsResult as any;
    }

    const { columnsSQL, tablesSQL } = parseColumnsResult.data!;
    const primaryTableSql = `${getTableName(primaryTableNode, true)}${
      primaryTableNode.as ? ` AS \`${primaryTableNode.as}\`` : ""
    }`;

    // 3. 构建 FROM 与 JOIN 关联从句
    let fromClause = `FROM ${tablesSQL}`;
    if (hasJoins) {
      const joinClauses: string[] = [];
      for (const j of joins!) {
        const joinType = j.type || "LEFT";
        const joinTable = `${getTableName(j.table, true)}${
          j.table.as ? ` AS \`${j.table.as}\`` : ""
        }`;
        const onRes = parseWhere(...j.on);
        if (onRes.status === 0) {
          return onRes as any;
        }
        joinClauses.push(`${joinType} JOIN ${joinTable} ON ${onRes.data!.whereSQL}`);
      }
      fromClause = `FROM ${primaryTableSql}\n${joinClauses.join("\n")}`;
    }

    // 4. 解析 WHERE 条件树
    let whereSQL = "";
    const needInputValues: Array<NeedInputValue> = [];
    if (finalWhere !== undefined && finalWhere.length > 0) {
      const parseWhereResult = parseWhere(...finalWhere);
      if (parseWhereResult.status === 0) {
        return parseWhereResult as any;
      }
      whereSQL = `WHERE ${parseWhereResult.data!.whereSQL}`;
      needInputValues.push(...parseWhereResult.data!.needInputValues);
    }

    // 5. 解析 ORDER BY
    let orderBySQL = "";
    if (orderBy !== undefined && orderBy.length > 0) {
      const parseOrderByResult = parseOrderBy(...orderBy);
      if (parseOrderByResult.status === 0) {
        return parseOrderByResult as any;
      }
      orderBySQL = `ORDER BY ${parseOrderByResult.data!.orderBySQL}`;
    }

    // 6. 解析 LIMIT
    let limitSQL = "";
    if (limit !== undefined) {
      const parseLimitResult = parseLimit(limit);
      if (parseLimitResult.status === 0) {
        return parseLimitResult as any;
      }
      limitSQL = `LIMIT ${parseLimitResult.data!.limitSQL}`;
    }

    const selectClause = distinct ? "SELECT DISTINCT" : "SELECT";
    const targetColumnsSQL = allColumns
      ? `${getTableName(primaryTableNode, false)}.*`
      : columnsSQL;

    // 7. 组装全字段 SQL
    const sqlParts = [
      `${selectClause} ${targetColumnsSQL}`,
      fromClause,
      whereSQL,
      orderBySQL,
      limitSQL,
    ].filter((item) => item.trim() !== "");
    const rawSql = sqlParts.join("\n");

    // 8. 组装只查 ID 的无锁 SQL (用于极速二级缓存与分段锁)
    const primaryIdColumn = getColumnName(
      {
        _type: "column",
        tableNode: primaryTableNode,
        column: "id",
      },
      true
    );

    const sqlOnlyIdParts = [
      `${selectClause} ${primaryIdColumn}`,
      fromClause,
      whereSQL,
      orderBySQL,
      limitSQL,
    ].filter((item) => item.trim() !== "");
    const rawSqlOnlyId = sqlOnlyIdParts.join("\n");

    // 9. 参数化抽取与预绑定
    const paramRes = parameterizeSql(rawSql);
    const paramIdRes = parameterizeSql(rawSqlOnlyId);

    const parameterizedSql =
      paramRes.status === 1 ? paramRes.data!.parameterizedSql : rawSql;
    const boundParams = paramRes.status === 1 ? paramRes.data!.params : [];
    const parameterizedSqlOnlyId =
      paramIdRes.status === 1
        ? paramIdRes.data!.parameterizedSql
        : rawSqlOnlyId;

    return returnSuccess<SelectBuildResult>({
      tableName: rawTableName,
      sql: parameterizedSql,
      sqlOnlyId: parameterizedSqlOnlyId,
      needInputValues,
      parameterizedSql,
      parameterizedSqlOnlyId,
      boundParams,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
