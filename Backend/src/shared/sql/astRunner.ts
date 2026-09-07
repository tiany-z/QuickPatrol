import { select as buildSelect } from "./builders/selectBuilder.js";
import { insert as buildInsert } from "./builders/insertBuilder.js";
import { update as buildUpdate } from "./builders/updateBuilder.js";
import { remove } from "./builders/deleteBuilder.js";
import { parameterizeSql } from "./ast/parameterizer.js";
import { executeQuery } from "../db/mysql.js";
import { delKV, mgetKV, setKV } from "../cache/redis.js";
import { RowLockManager } from "../lock/rowLockManager.js";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";
import { createInsertUndoClosure } from "./withdrawStack.js";
import type { TenantContext } from "./ast/tenantTypes.js";

export function compileAstRunFunction(astConfig: any): (params: any, ctx?: any) => Promise<StandardResult<any>> {
  const type = astConfig.type;

  if (type === "SELECT") {
    return async (params: any, ctx?: any) => {
      try {
        const tenantCtx: TenantContext | undefined = ctx
          ? {
              schoolId: ctx.schoolId,
              userId: ctx.userId,
              role: ctx.role,
              bypassTenantFilter: ctx.bypassTenantFilter,
            }
          : astConfig.context;

        const buildRes = buildSelect(astConfig.compose, tenantCtx);
        if (buildRes.status === 0) {
          return returnError(`Select AST Compile Error: ${buildRes.content}`);
        }
        const { tableName, sqlOnlyId } = buildRes.data!;
        const schoolId = tenantCtx?.schoolId || 1;

        // 1. 无锁提取 ID 数组 (先将 -!!value!!- 模板绑定为 ? 参数指针)
        const paramRes = parameterizeSql(sqlOnlyId, params?.whereParams || []);
        if (paramRes.status === 0) return returnError(paramRes.content);
        const { parameterizedSql, params: boundParams } = paramRes.data!;

        const idRowsRes = await executeQuery<{ id: string | number }>(parameterizedSql, boundParams);
        if (idRowsRes.status === 0) return returnError(idRowsRes.content);
        const ids = (idRowsRes.data || []).map((r) => r.id).filter((id) => id !== undefined && id !== null);

        if (ids.length === 0) return returnSuccess([]);

        // 2. 锁等待与 COMMITTED_DELETE 二次校判剔除 (带租户隔离)
        const validIds: Array<string | number> = [];
        for (const id of ids) {
          if (await RowLockManager.isRowLocked(schoolId, tableName, id)) {
            const waitRes = await RowLockManager.waitForUnlock(schoolId, tableName, id, 3000);
            if (waitRes.status === 1 && waitRes.data?.finalStatus === "COMMITTED_DELETE") {
              // 持锁事务已成功删除该记录，从本次查询结果集中剔除
              continue;
            }
          }
          validIds.push(id);
        }

        if (validIds.length === 0) return returnSuccess([]);

        // 3. Redis 批量 MGET 极速读缓存 (带租户隔离)
        const redisRes = await mgetKV(schoolId, tableName, validIds);
        const cacheMap = redisRes.status === 1 ? redisRes.data! : {};
        const missingIds: Array<string | number> = [];
        const itemMap = new Map<string | number, any>();

        for (const id of validIds) {
          if (cacheMap[id]) {
            itemMap.set(id, cacheMap[id]);
          } else {
            missingIds.push(id);
          }
        }

        // 4. 回源 MySQL 补全并回写 Redis 热缓存预热
        if (missingIds.length > 0) {
          let fetchSql = "";
          let fetchParams: any[] = [];
          if (missingIds.length === 1) {
            fetchSql = `SELECT * FROM \`${tableName}\` WHERE \`id\` = ? AND \`schoolId\` = ?`;
            fetchParams = [missingIds[0], schoolId];
          } else {
            fetchSql = `SELECT * FROM \`${tableName}\` WHERE \`id\` IN (?) AND \`schoolId\` = ?`;
            fetchParams = [missingIds, schoolId];
          }

          const dbFetchRes = await executeQuery(fetchSql, fetchParams);
          if (dbFetchRes.status === 1 && dbFetchRes.data) {
            for (const row of dbFetchRes.data) {
              itemMap.set(row.id, row);
              await setKV(schoolId, tableName, row.id, row);
            }
          }
        }

        // 5. 严格按照 validIds 原排序提取最终结果列表（兼容主键数值与字符串类型）
        const finalResult = validIds
          .map((id) => itemMap.get(id) ?? itemMap.get(String(id)) ?? itemMap.get(Number(id)))
          .filter(Boolean);

        return returnSuccess(finalResult);
      } catch (err) {
        return returnError(`Select Run Error: ${tryCatchErrorToString(err)}`);
      }
    };
  }

  if (type === "INSERT") {
    return async (params: any, ctx?: any) => {
      try {
        const tenantCtx: TenantContext | undefined = ctx
          ? {
              schoolId: ctx.schoolId,
              userId: ctx.userId,
              role: ctx.role,
              bypassTenantFilter: ctx.bypassTenantFilter,
            }
          : astConfig.context;

        const buildRes = buildInsert(astConfig.compose, tenantCtx);
        if (buildRes.status === 0) {
          return returnError(`Insert AST Compile Error: ${buildRes.content}`);
        }
        const { tableName, sql, needInputValues } = buildRes.data!;
        const schoolId = tenantCtx?.schoolId || 1;

        const inputParams = Array.isArray(params) ? params : [];
        const insertRes = await executeQuery<{ id: string | number }>(sql, inputParams);
        if (insertRes.status === 0) return returnError(insertRes.content);

        // 如果参数中显式传递了 id 列，优先使用显式传递的 id；否则使用 MySQL insertId
        const idColIndex = needInputValues.findIndex((col) => col.columnName.toLowerCase() === "id");
        let insertedId =
          idColIndex !== -1 && inputParams[idColIndex] !== undefined
            ? inputParams[idColIndex]
            : insertRes.data![0]?.id;

        // 绑定精细化插入撤销闭包 (含 Redis 脏缓存擦除)
        const withdraw = createInsertUndoClosure(schoolId, tableName, insertedId);

        if (ctx?.withdrawStack) {
          ctx.withdrawStack.push(withdraw);
        }

        return returnSuccess({ id: insertedId, withdraw });
      } catch (err) {
        return returnError(`Insert Run Error: ${tryCatchErrorToString(err)}`);
      }
    };
  }

  if (type === "UPDATE") {
    return async (params: { table?: any; targetId: string | number; updateData: any }, ctx?: any) => {
      try {
        const table = params?.table || astConfig?.compose?.table;
        if (!table) return returnError("UPDATE AST 缺少 table 配置");

        const tenantCtx: TenantContext | undefined = ctx
          ? {
              schoolId: ctx.schoolId,
              userId: ctx.userId,
              role: ctx.role,
              bypassTenantFilter: ctx.bypassTenantFilter,
            }
          : astConfig.context;

        const buildRes = buildUpdate(
          {
            table,
            targetId: params.targetId,
            updateData: params.updateData,
          },
          tenantCtx
        );
        if (buildRes.status === 0) return returnError(buildRes.content);
        const { tableName, targetId, lockSql, updateSql, updateParams, createUndoFn } = buildRes.data!;
        const schoolId = tenantCtx?.schoolId || 1;

        const requestId = ctx?.requestId || "req-unknown";
        const lockAcq = await RowLockManager.acquireRowLock(schoolId, tableName, targetId, "UPDATE", requestId);
        if (lockAcq.status === 0) return returnError(lockAcq.content);

        // 执行 SELECT 抓取旧数据快照，若记录不存在则 Fail-Fast 并释放行锁，不污染 ctx.lockedRows
        const oldSnapshotRes = await executeQuery(lockSql, [targetId, schoolId, 0]);
        if (oldSnapshotRes.status === 0 || !oldSnapshotRes.data || oldSnapshotRes.data.length === 0) {
          await RowLockManager.releaseRowLock(schoolId, tableName, targetId, requestId, false);
          return returnError(`更新目标记录不存在: ID=${targetId}`);
        }
        const oldSnapshot = oldSnapshotRes.data[0];

        // 仅在确认记录存在后，将行锁托管给外层 ctx.lockedRows 统一调度
        if (ctx?.lockedRows) {
          ctx.lockedRows.push({ schoolId, tableName, targetId, requestId });
        }

        // 执行 UPDATE
        const updateRes = await executeQuery(updateSql, updateParams);
        if (updateRes.status === 0) return returnError(updateRes.content);

        // 关键修复：更新成功后立即删除 Redis 缓存，防止读取脏数据
        await delKV(schoolId, tableName, targetId).catch(() => {});

        const undoOp = createUndoFn(oldSnapshot);

        const withdraw = async () => {
          if (undoOp.undoSql) {
            await executeQuery(undoOp.undoSql, undoOp.undoParams).catch(() => {});
          }
          await setKV(schoolId, tableName, targetId, oldSnapshot);
        };

        if (ctx?.withdrawStack) {
          ctx.withdrawStack.push(withdraw);
        }

        return returnSuccess({ targetId, withdraw });
      } catch (err) {
        return returnError(`Update Run Error: ${tryCatchErrorToString(err)}`);
      }
    };
  }

  if (type === "DELETE") {
    return async (params: any, ctx?: any) => {
      try {
        const table = params?.table || astConfig?.compose?.table;
        if (!table) return returnError("DELETE AST 缺少 table 配置");
        const targetId = typeof params === "object" && params !== null && "targetId" in params ? params.targetId : params;

        const tenantCtx: TenantContext | undefined = ctx
          ? {
              schoolId: ctx.schoolId,
              userId: ctx.userId,
              role: ctx.role,
              bypassTenantFilter: ctx.bypassTenantFilter,
            }
          : astConfig.context;

        const buildRes = remove({ table, targetId }, tenantCtx);
        if (buildRes.status === 0) return returnError(buildRes.content);
        const { tableName, lockSql, deleteSql, deleteParams, createUndoFn } = buildRes.data!;
        const schoolId = tenantCtx?.schoolId || 1;

        const requestId = ctx?.requestId || "req-unknown";
        const lockAcq = await RowLockManager.acquireRowLock(schoolId, tableName, targetId, "DELETE", requestId);
        if (lockAcq.status === 0) return returnError(lockAcq.content);

        // 执行 SELECT 抓取旧数据快照，若记录不存在则 Fail-Fast 并释放行锁，不污染 ctx.lockedRows
        const oldSnapshotRes = await executeQuery(lockSql, [targetId, schoolId, 0]);
        if (oldSnapshotRes.status === 0 || !oldSnapshotRes.data || oldSnapshotRes.data.length === 0) {
          await RowLockManager.releaseRowLock(schoolId, tableName, targetId, requestId, false);
          return returnError(`删除目标记录不存在: ID=${targetId}`);
        }
        const oldSnapshot = oldSnapshotRes.data[0];

        // 仅在确认记录存在后，将行锁托管给外层 ctx.lockedRows 统一调度
        if (ctx?.lockedRows) {
          ctx.lockedRows.push({ schoolId, tableName, targetId, requestId });
        }

        // 执行 DELETE (底层转译为 UPDATE isDeleted = 1)
        const delRes = await executeQuery(deleteSql, deleteParams);
        if (delRes.status === 0) return returnError(delRes.content);

        // 删除成功后立即擦除 Redis 缓存
        await delKV(schoolId, tableName, targetId).catch(() => {});

        const undoOp = createUndoFn(oldSnapshot);

        const withdraw = async () => {
          if (undoOp.undoSql) {
            await executeQuery(undoOp.undoSql, undoOp.undoParams).catch(() => {});
          }
          await setKV(schoolId, tableName, targetId, oldSnapshot);
        };

        if (ctx?.withdrawStack) {
          ctx.withdrawStack.push(withdraw);
        }

        return returnSuccess({ targetId, withdraw });
      } catch (err) {
        return returnError(`Delete Run Error: ${tryCatchErrorToString(err)}`);
      }
    };
  }

  return async () => returnError("Unsupported AST Run Type");
}

/**
 * 通用 AST Insert / Upsert 快捷执行管道
 */
export async function executeASTInsert(sql: string, params: any[] = []): Promise<StandardResult<any>> {
  try {
    return await executeQuery(sql, params);
  } catch (error) {
    return returnError(`executeASTInsert 执行失败: ${tryCatchErrorToString(error)}`);
  }
}

/**
 * 通用 AST Select 快捷执行管道，直接返回数据行数组
 */
export async function executeASTSelect<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try {
    const res = await executeQuery<T>(sql, params);
    if (res.status === 1 && Array.isArray(res.data)) {
      return res.data;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 通用 AST Update 快捷执行管道
 */
export async function executeASTUpdate(
  sql: string,
  params: any[] = []
): Promise<StandardResult<any> & { affectedRows?: number }> {
  try {
    const res = await executeQuery(sql, params);
    const affected = res.data?.[0]?.affectedRows ?? 1;
    return { ...res, affectedRows: affected };
  } catch (error) {
    return { ...returnError(`executeASTUpdate 执行失败: ${tryCatchErrorToString(error)}`), affectedRows: 0 };
  }
}

/**
 * 通用 AST Delete 快捷执行管道
 */
export async function executeASTDelete(
  sql: string,
  params: any[] = []
): Promise<StandardResult<any> & { affectedRows?: number }> {
  try {
    const res = await executeQuery(sql, params);
    const affected = res.data?.[0]?.affectedRows ?? 1;
    return { ...res, affectedRows: affected };
  } catch (error) {
    return { ...returnError(`executeASTDelete 执行失败: ${tryCatchErrorToString(error)}`), affectedRows: 0 };
  }
}

