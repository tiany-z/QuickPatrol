import {
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../flow/result.js";
import { update } from "./updateBuilder.js";
import { TenantContext } from "../ast/tenantTypes.js";
import type {
  DeleteBuildResult,
  DeleteCompose,
  TableNode,
  UndoOperation,
} from "../type.js";

/**
 * 编译 DELETE 删除请求并透明转译为带租户保护的逻辑软删除 (UPDATE isDeleted = 1)
 * 
 * @param compose 删除 AST 描述
 * @param context 租户多维鉴权上下文
 */
export function remove(
  compose: DeleteCompose,
  context?: TenantContext
): StandardResult<DeleteBuildResult> {
  try {
    const primaryTableNode: TableNode = (compose.table || compose.tableNode)!;

    if (!primaryTableNode || !primaryTableNode.table) {
      return returnError("删除操作缺少目标表节点");
    }

    if (!compose.targetId || String(compose.targetId).trim() === "") {
      return returnError("删除操作必须且只能指定 ID 进行");
    }

    // 1. 透明转译为 UPDATE table SET isDeleted = 1 WHERE id = ?
    const updateCompose = {
      table: primaryTableNode,
      targetId: compose.targetId,
      updateData: {
        isDeleted: 1,
      },
      where: compose.where,
    };

    // 2. 交由 Update 构建器执行全套租户与软删除注入
    const updateRes = update(updateCompose, context);
    if (updateRes.status === 0) {
      return updateRes as any;
    }

    const {
      tableName,
      targetId,
      lockSql,
      updateSql,
      updateParams,
    } = updateRes.data!;

    // 3. 构造逆序恢复 Undo 闭包 (将 isDeleted 恢复为 0)
    const createUndoFn = (
      deletedRowSnapshot: Record<string, any>
    ): UndoOperation => {
      const keys = Object.keys(deletedRowSnapshot);
      if (keys.length === 0) {
        return {
          undoSql: "",
          undoParams: [],
        };
      }

      // 生成将 isDeleted 翻转回 0 的恢复 SQL
      const restoreCompose = {
        table: primaryTableNode,
        targetId,
        updateData: {
          isDeleted: 0,
        },
        where: compose.where,
      };

      const restoreRes = update(restoreCompose, context);
      if (restoreRes.status === 1) {
        return {
          undoSql: restoreRes.data!.updateSql,
          undoParams: restoreRes.data!.updateParams,
        };
      }

      return {
        undoSql: "",
        undoParams: [],
      };
    };

    return returnSuccess<DeleteBuildResult>({
      tableName,
      targetId,
      lockSql,
      deleteSql: updateSql,
      deleteParams: updateParams,
      createUndoFn,
    });
  } catch (error) {
    return returnError(tryCatchErrorToString(error));
  }
}
