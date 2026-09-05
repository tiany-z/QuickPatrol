import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../../flow/result.js";
import { getColumnName, getTableName, parseColumns, parseLimit, parseOrderBy, parseWhere } from "../ast/validator.js";
import type { NeedInputValue, SelectBuildResult, SelectCompose } from "../type.js";

export function select(compose: SelectCompose): StandardResult<SelectBuildResult> {
  try {
    const { allColumns, columns, where, orderBy, limit, distinct } = compose;

    if (columns.length === 0) {
      return returnError("SELECT 列名列表不能为空");
    }

    const parseColumnsResult = parseColumns(...columns);
    if (parseColumnsResult.status === 0) {
      return parseColumnsResult as any;
    }

    const { columnsSQL, tablesSQL } = parseColumnsResult.data!;
    const primaryTableNode = columns[0].tableNode;
    const rawTableName = primaryTableNode.table;
    const tableName = getTableName(primaryTableNode, true);

    let whereSQL = "";
    const needInputValues: Array<NeedInputValue> = [];
    if (where !== undefined && where.length > 0) {
      const parseWhereResult = parseWhere(...where);
      if (parseWhereResult.status === 0) {
        return parseWhereResult as any;
      }
      whereSQL = `WHERE ${parseWhereResult.data!.whereSQL}`;
      needInputValues.push(...parseWhereResult.data!.needInputValues);
    }

    let orderBySQL = "";
    if (orderBy !== undefined && orderBy.length > 0) {
      const parseOrderByResult = parseOrderBy(...orderBy);
      if (parseOrderByResult.status === 0) {
        return parseOrderByResult as any;
      }
      orderBySQL = `ORDER BY ${parseOrderByResult.data!.orderBySQL}`;
    }

    let limitSQL = "";
    if (limit !== undefined) {
      const parseLimitResult = parseLimit(limit);
      if (parseLimitResult.status === 0) {
        return parseLimitResult as any;
      }
      limitSQL = `LIMIT ${parseLimitResult.data!.limitSQL}`;
    }

    const selectClause = distinct ? "SELECT DISTINCT" : "SELECT";
    const targetColumnsSQL = allColumns ? `${tableName}.*` : columnsSQL;

    const sqlParts = [
      `${selectClause} ${targetColumnsSQL}`,
      `FROM ${tablesSQL}`,
      whereSQL,
      orderBySQL,
      limitSQL,
    ].filter((item) => item.trim() !== "");

    const sql = sqlParts.join("\n");

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
      `FROM ${tablesSQL}`,
      whereSQL,
      orderBySQL,
      limitSQL,
    ].filter((item) => item.trim() !== "");

    const sqlOnlyId = sqlOnlyIdParts.join("\n");

    return returnSuccess<SelectBuildResult>({
      tableName: rawTableName,
      sql,
      sqlOnlyId,
      needInputValues,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
