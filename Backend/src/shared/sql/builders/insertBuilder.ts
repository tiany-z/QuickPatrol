import {
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../flow/result.js";
import { getTableName } from "../ast/validator.js";
import { TenantASTInjector } from "../ast/tenantInjector.js";
import { isGlobalTable, TenantContext } from "../ast/tenantTypes.js";
import type {
  ColumnNode,
  CustomValueNode,
  InsertBuildResult,
  InsertCompose,
  NonEmptyString,
  TableNode,
  UndoOperation,
} from "../type.js";

/**
 * 编译 INSERT 插入 AST 树并强制劫持校验租户归属
 * 
 * @param compose 插入 AST 描述
 * @param context 租户多维鉴权上下文
 */
export function insert(
  compose: InsertCompose,
  context?: TenantContext
): StandardResult<InsertBuildResult> {
  try {
    const rawTable = compose.table || compose.tableNode;
    let columns = compose.columns ? [...compose.columns] : [];
    let values = compose.values ? [...compose.values] : undefined;
    const dataPayload = compose.data || compose.valuesPayload;

    // 如果通过 data 或 valuesPayload 字典传入待插入数据
    if (dataPayload && Object.keys(dataPayload).length > 0) {
      const keys = Object.keys(dataPayload);
      const inferredTable =
        rawTable ||
        (columns.length > 0
          ? columns[0].tableNode
          : { _type: "table", table: "unknown" as NonEmptyString });

      for (const k of keys) {
        if (!columns.some((c) => c.column.toLowerCase() === k.toLowerCase())) {
          columns.push({
            _type: "column",
            tableNode: inferredTable,
            column: k as NonEmptyString,
          });
        }
      }
    }

    if (columns.length === 0) {
      return returnError("插入列列表不能为空");
    }

    const tableNames = [
      ...new Set(
        columns.map((item: ColumnNode) => {
          return item.tableNode.table;
        })
      ),
    ].filter(Boolean);

    const primaryTable: TableNode =
      rawTable ||
      (tableNames.length > 0
        ? { _type: "table", table: tableNames[0] as NonEmptyString }
        : columns[0].tableNode);

    if (!primaryTable || !primaryTable.table) {
      return returnError("插入操作缺少明确的目标表节点");
    }

    const rawTableName = primaryTable.table;
    const tableName = getTableName(primaryTable, true);

    // 核心前置拦截：对业务表自动注入 schoolId 并拦截伪造写入
    const injectRes = TenantASTInjector.injectTenantToInsertColumns(
      primaryTable,
      columns,
      values,
      context,
      dataPayload
    );
    if (injectRes.status === 0) {
      return injectRes as any;
    }

    columns = injectRes.data!.columns;
    values = injectRes.data!.values;

    const columnNames = [
      ...new Set(
        columns.map((item: ColumnNode) => {
          return `${item.column}`;
        })
      ),
    ];

    if (columnNames.length !== columns.length) {
      return returnError("存在重复的列名");
    }

    const escapedColumns = columnNames.map((c) => `\`${c}\``).join(", ");
    const valuePlaceholders = columns.map(() => "?").join(", ");

    const sql = `INSERT INTO ${tableName} (${escapedColumns})\nVALUES (${valuePlaceholders})`;

    // 计算预绑定的静态参数（如自动注入的 schoolId）
    const boundParams: any[] = [];
    if (dataPayload) {
      for (const c of columnNames) {
        boundParams.push(dataPayload[c]);
      }
    }

    const isGlobal = isGlobalTable(rawTableName);
    const tenantSchoolId = context?.schoolId;

    const createUndoFn = (insertedId: string | number): UndoOperation => {
      // 撤销删除时同样绑定租户限定，严防跨校误删
      if (!isGlobal && tenantSchoolId) {
        return {
          undoSql: `DELETE FROM ${tableName} WHERE \`id\` = ? AND \`schoolId\` = ?`,
          undoParams: [insertedId, tenantSchoolId],
        };
      }
      return {
        undoSql: `DELETE FROM ${tableName} WHERE \`id\` = ?`,
        undoParams: [insertedId],
      };
    };

    return returnSuccess<InsertBuildResult>({
      tableName: rawTableName,
      sql,
      needInputValues: columns.map((item: ColumnNode) => ({
        columnName: item.column,
      })),
      boundParams,
      createUndoFn,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
