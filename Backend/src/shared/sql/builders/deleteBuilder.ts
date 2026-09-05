import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../../flow/result.js";
import { getTableName } from "../ast/validator.js";
import type { DeleteBuildResult, DeleteCompose, UndoOperation } from "../type.js";

export function remove({ table, targetId }: DeleteCompose): StandardResult<DeleteBuildResult> {
  try {
    if (!targetId || String(targetId).trim() === "") {
      return returnError("删除操作必须且只能指定 ID 进行");
    }

    const rawTableName = table.table;
    const tableName = getTableName(table, true);

    const lockSql = `SELECT * FROM ${tableName} WHERE \`id\` = ?`;
    const deleteSql = `DELETE FROM ${tableName}\nWHERE \`id\` = ?`;
    const deleteParams = [targetId];

    const createUndoFn = (deletedRowSnapshot: Record<string, any>): UndoOperation => {
      const keys = Object.keys(deletedRowSnapshot);
      if (keys.length === 0) {
        return {
          undoSql: "",
          undoParams: [],
        };
      }
      const escapedKeys = keys.map((k) => `\`${k}\``).join(", ");
      const valuePlaceholders = keys.map(() => "?").join(", ");
      const undoParams = keys.map((k) => deletedRowSnapshot[k]);

      return {
        undoSql: `INSERT INTO ${tableName} (${escapedKeys})\nVALUES (${valuePlaceholders})`,
        undoParams,
      };
    };

    return returnSuccess<DeleteBuildResult>({
      tableName: rawTableName,
      targetId,
      lockSql,
      deleteSql,
      deleteParams,
      createUndoFn,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
