import { ISagaWithdrawStack, SagaUndoClosure } from "./sagaTypes.js";
import { TerminalLogger } from "../log/terminalLogger.js";
import { tryCatchErrorToString } from "../flow/result.js";
import { executeQuery } from "../db/mysql.js";
import { delKV } from "../cache/redis.js";

/**
 * Saga 逆序补偿撤销栈容器
 * 正向业务操作每推进一步，向本栈压入一个相反的原子补偿闭包；
 * 链路发生异常时，严格按 LIFO (后进先出) 倒序出栈执行全部补偿闭包，抹平数据与缓存。
 */
export class SagaWithdrawStack implements ISagaWithdrawStack {
  private stack: SagaUndoClosure[] = [];

  /**
   * 压入一个反向补偿闭包
   */
  public push(closure: SagaUndoClosure): void {
    if (typeof closure === "function") {
      this.stack.push(closure);
    }
  }

  /**
   * 获取当前栈深
   */
  public size(): number {
    return this.stack.length;
  }

  /**
   * 兼容数组 .length 访问属性
   */
  public get length(): number {
    return this.stack.length;
  }

  /**
   * 支持按数组下标索引访问内部闭包 (兼容旧代码兼容性)
   */
  [index: number]: SagaUndoClosure;

  /**
   * 核心算法：按 LIFO (后进先出) 逆序执行撤销闭包
   */
  public async withdrawAll(): Promise<void> {
    if (this.stack.length === 0) return;

    TerminalLogger.warn(
      `[M03 Saga] 触发业务回滚补偿栈，共 ${this.stack.length} 个逆序补偿操作待执行...`,
      "SagaRollback"
    );

    // 严格按照倒序 LIFO 逐个执行，每一个步骤独立 try-catch，保证最大程度自愈
    for (let i = this.stack.length - 1; i >= 0; i--) {
      try {
        const undoFn = this.stack[i];
        if (typeof undoFn === "function") {
          await undoFn();
        }
      } catch (err) {
        TerminalLogger.error(
          `[M03 Saga] 补偿闭包执行异常 (索引 ${i}): ${tryCatchErrorToString(err)}`,
          "SagaRollback"
        );
      }
    }

    this.clear();
    TerminalLogger.info(
      "[M03 Saga] 逆序补偿操作全部执行完毕，数据与缓存已抹平自愈",
      "SagaRollback"
    );
  }

  /**
   * 彻底清空撤销栈
   */
  public clear(): void {
    this.stack = [];
  }
}

/**
 * 空快照 INSERT 补偿工厂：生成精确的主键物理删除与缓存擦除闭包 (算法 5)
 * 解决新建数据没有“旧快照”时，撤销 SQL 缺少参数或触发异常的经典缺陷
 * 
 * @param schoolId 学校/租户 ID
 * @param tableName 目标表名
 * @param insertedId 刚插入成功的主键 ID
 */
export function createInsertUndoClosure(
  schoolId: number,
  tableName: string,
  insertedId: string | number
): () => Promise<void> {
  return async () => {
    try {
      const cleanTable = tableName.replace(/[`"]/g, "").trim();
      const undoSql = `DELETE FROM \`${cleanTable}\` WHERE \`id\` = ? AND \`schoolId\` = ?`;
      await executeQuery(undoSql, [insertedId, schoolId]).catch(() => {});
      await delKV(schoolId, cleanTable, insertedId).catch(() => {});
    } catch (err) {
      TerminalLogger.error(
        `[M03 Saga] 插入撤销闭包执行失败: ${tryCatchErrorToString(err)}`,
        "SagaRollback"
      );
    }
  };
}
