import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../../flow/result.js";
import { getTableName, validateSQLFragment } from "../ast/validator.js";
import type { UndoOperation, UpdateBuildResult, UpdateCompose } from "../type.js";

export function update({ table, targetId, updateData }: UpdateCompose): StandardResult<UpdateBuildResult> {
  try {
    if (!targetId || String(targetId).trim() === "") {
      return returnError("更新操作必须且只能指定 ID 进行");
    }

    const rawTableName = table.table;
    const tableName = getTableName(table, true);
    const keys = Object.keys(updateData);
    if (keys.length === 0) {
      return returnError("UPDATE 更新数据不能为空");
    }

    for (const key of keys) {
      const valid = validateSQLFragment(key);
      if (valid.status === 0) {
        return valid as any;
      }
    }

    const setClauses: string[] = [];
    const updateParams: any[] = [];

    keys.forEach((key) => {
      // Escaping column name with backticks to support MySQL reserved words like desc, key, value
      setClauses.push(`\`${key}\` = ?`);
      updateParams.push(updateData[key]);
    });

    updateParams.push(targetId);

    const lockSql = `SELECT * FROM ${tableName} WHERE \`id\` = ?`;
    const updateSql = `UPDATE ${tableName}\nSET ${setClauses.join(", ")}\nWHERE \`id\` = ?`;

    const createUndoFn = (oldRowSnapshot: Record<string, any>): UndoOperation => {
      const restoreKeys = keys.filter((k) => k in oldRowSnapshot);
      if (restoreKeys.length === 0) {
        return {
          undoSql: "",
          undoParams: [],
        };
      }
      const restoreSetClauses = restoreKeys.map((k) => `\`${k}\` = ?`);
      const restoreParams = restoreKeys.map((k) => oldRowSnapshot[k]);
      restoreParams.push(targetId);

      return {
        undoSql: `UPDATE ${tableName}\nSET ${restoreSetClauses.join(", ")}\nWHERE \`id\` = ?`,
        undoParams: restoreParams,
      };
    };

    return returnSuccess<UpdateBuildResult>({
      tableName: rawTableName,
      targetId,
      lockSql,
      updateSql,
      updateParams,
      createUndoFn,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
