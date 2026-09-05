import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../../flow/result.js";
import { getTableName } from "../ast/validator.js";
import type { ColumnNode, InsertBuildResult, InsertCompose, UndoOperation } from "../type.js";

export function insert({ columns }: InsertCompose): StandardResult<InsertBuildResult> {
  try {
    if (columns.length === 0) {
      return returnError("插入列列表不能为空");
    }

    const tableNames = [
      ...new Set(
        columns.map((item: ColumnNode) => {
          return item.tableNode.table;
        })
      ),
    ];

    if (tableNames.length > 1) {
      return returnError("插入操作只能针对一个表");
    }

    const rawTableName = tableNames[0];
    const tableName = getTableName(columns[0].tableNode, true);

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
    // MySQL uses standard INSERT INTO without RETURNING id
    const sql = `INSERT INTO ${tableName} (${escapedColumns})\nVALUES (${valuePlaceholders})`;

    const createUndoFn = (insertedId: string | number): UndoOperation => {
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
      createUndoFn,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
