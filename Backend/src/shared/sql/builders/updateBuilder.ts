import {
  returnError,
  returnSuccess,
  StandardResult,
  tryCatchErrorToString,
} from "../../flow/result.js";
import { getTableName, parseWhere, validateSQLFragment } from "../ast/validator.js";
import { parameterizeSql } from "../ast/parameterizer.js";
import { TenantASTInjector } from "../ast/tenantInjector.js";
import { isGlobalTable, TenantContext } from "../ast/tenantTypes.js";
import type {
  NonEmptyString,
  TableNode,
  UndoOperation,
  UpdateBuildResult,
  UpdateCompose,
  WhereCompareNode,
  WhereConditionNode,
} from "../type.js";

/**
 * 编译 UPDATE 更新 AST 树并强制注入租户与软删除范围保护
 * 
 * @param compose 更新 AST 描述
 * @param context 租户多维鉴权上下文
 */
export function update(
  compose: UpdateCompose,
  context?: TenantContext
): StandardResult<UpdateBuildResult> {
  try {
    const { targetId, updateData } = compose;
    const primaryTableNode: TableNode = (compose.table || compose.tableNode)!;

    if (!primaryTableNode || !primaryTableNode.table) {
      return returnError("UPDATE 更新缺少目标表节点");
    }

    if (!targetId || String(targetId).trim() === "") {
      return returnError("更新操作必须且只能指定 ID 进行");
    }

    const rawTableName = primaryTableNode.table;
    const tableName = getTableName(primaryTableNode, true);
    const keys = Object.keys(updateData);
    if (keys.length === 0) {
      return returnError("UPDATE 更新数据不能为空");
    }

    // 校验所有更新字段名安全性
    for (const key of keys) {
      const valid = validateSQLFragment(key);
      if (valid.status === 0) {
        return valid as any;
      }
    }

    // 防御跨校篡改 schoolId
    if (
      !isGlobalTable(rawTableName) &&
      updateData.schoolId !== undefined &&
      context?.schoolId !== undefined &&
      Number(updateData.schoolId) !== Number(context.schoolId)
    ) {
      return returnError(
        `[M02 越权更新阻断] 禁止跨校篡改数据归属: 试图将记录修改为学校 [${updateData.schoolId}]，当前会话隶属于 [${context.schoolId}]！`
      );
    }

    // 1. 构造初始针对 ID 的基础查询条件
    const idConditionNode: WhereCompareNode = {
      _type: "whereCompareNode",
      column: {
        _type: "column",
        tableNode: primaryTableNode,
        column: "id" as NonEmptyString,
      },
      operator: "=",
      compareColumn: {
        _type: "customValue",
        string: `-!!value!!-${targetId}-!!value!!-`,
      },
    };

    const initialWhere: WhereConditionNode[] = [idConditionNode];
    if (compose.where && compose.where.length > 0) {
      initialWhere.push(
        { _type: "whereLogicalLinkNode", operator: "AND" },
        ...compose.where
      );
    }

    // 2. 核心前置拦截：强化注入 schoolId 与 isDeleted = 0 约束
    const augmentRes = TenantASTInjector.augmentWhere(
      primaryTableNode,
      initialWhere,
      context
    );
    if (augmentRes.status === 0) {
      return augmentRes as any;
    }
    const finalWhere = augmentRes.data!;

    // 3. 编译解析 WHERE 子句
    const parseWhereRes = parseWhere(...finalWhere);
    if (parseWhereRes.status === 0) {
      return parseWhereRes as any;
    }
    const whereClauseSql = parseWhereRes.data!.whereSQL;

    // 4. 构建 SET 子句与参数
    const setClauses: string[] = [];
    const setValues: any[] = [];

    keys.forEach((key) => {
      setClauses.push(`\`${key}\` = ?`);
      setValues.push(updateData[key]);
    });

    const rawLockSql = `SELECT * FROM ${tableName} WHERE ${whereClauseSql}`;
    const rawUpdateSql = `UPDATE ${tableName}\nSET ${setClauses.join(", ")}\nWHERE ${whereClauseSql}`;

    // 5. 参数化提取
    const paramWhereRes = parameterizeSql(whereClauseSql);
    const whereParams =
      paramWhereRes.status === 1 ? paramWhereRes.data!.params : [];
    const parameterizedWhereSql =
      paramWhereRes.status === 1
        ? paramWhereRes.data!.parameterizedSql
        : whereClauseSql;

    const lockSql = `SELECT * FROM ${tableName} WHERE ${parameterizedWhereSql}`;
    const updateSql = `UPDATE ${tableName}\nSET ${setClauses.join(", ")}\nWHERE ${parameterizedWhereSql}`;
    const updateParams = [...setValues, ...whereParams];

    // 6. 构造具备租户安全约束的撤销恢复闭包
    const createUndoFn = (oldRowSnapshot: Record<string, any>): UndoOperation => {
      const restoreKeys = keys.filter((k) => k in oldRowSnapshot);
      if (restoreKeys.length === 0) {
        return {
          undoSql: "",
          undoParams: [],
        };
      }
      const restoreSetClauses = restoreKeys.map((k) => `\`${k}\` = ?`);
      const restoreSetParams = restoreKeys.map((k) => oldRowSnapshot[k]);

      return {
        undoSql: `UPDATE ${tableName}\nSET ${restoreSetClauses.join(", ")}\nWHERE ${parameterizedWhereSql}`,
        undoParams: [...restoreSetParams, ...whereParams],
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
