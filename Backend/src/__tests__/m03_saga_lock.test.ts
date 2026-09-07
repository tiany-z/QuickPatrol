import { beforeEach, describe, expect, it } from "vitest";
import {
  createInsertUndoClosure,
  delKV,
  getKV,
  RowLockManager,
  SagaWithdrawStack,
  setKV,
} from "../shared/index.js";

describe("M03: Saga 事务撤回栈与行级排他锁并发引擎 (Saga & RowLock Engine)", () => {
  beforeEach(() => {
    // 每次测试前清理内存锁字典，保证各用例严格独立
    RowLockManager.clearMemoryLocks();
  });

  describe("用例 1: 并发抢锁互斥性测试 (仅一人成功)", () => {
    it("同时并发抢锁同一工单时，应当且仅能有一方抢锁成功，另一方被排他拦截", async () => {
      const schoolId = 1;
      const table = "patrols";
      const targetId = 99;

      // 两个并发请求在同一事件循环中同时竞争加锁
      const [resA, resB] = await Promise.all([
        RowLockManager.acquireRowLock(schoolId, table, targetId, "UPDATE", "req_A"),
        RowLockManager.acquireRowLock(schoolId, table, targetId, "UPDATE", "req_B"),
      ]);

      const successCount = [resA, resB].filter((r) => r.status === 1).length;
      const failureCount = [resA, resB].filter((r) => r.status === 0).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // 验证失败方获得了明确的互斥错误提示
      const failedRes = resA.status === 0 ? resA : resB;
      expect(failedRes.content).toContain("[M03 行锁互斥]");
    });
  });

  describe("用例 2: 同一 requestId 重入性测试", () => {
    it("同一请求上下文持有锁时，重复加锁应判定为合法重入直接放行", async () => {
      const schoolId = 1;
      const table = "patrols";
      const targetId = 100;
      const requestId = "req_reentrant_001";

      // 第一次加锁
      const firstLock = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        requestId
      );
      expect(firstLock.status).toBe(1);

      // 相同请求 ID 再次加锁 (重入)
      const secondLock = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        requestId
      );
      expect(secondLock.status).toBe(1);

      // 释放锁
      const releaseRes = await RowLockManager.releaseRowLock(
        schoolId,
        table,
        targetId,
        requestId,
        true
      );
      expect(releaseRes.status).toBe(1);
    });
  });

  describe("用例 3: Lua 脚本释放幂等性测试 (防误删他人锁)", () => {
    it("非锁持有者尝试释放锁应被安全拒绝，锁依然被原主持有", async () => {
      const schoolId = 1;
      const table = "patrols";
      const targetId = 105;

      // 1. 请求 A 成功加锁
      const lockResA = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        "req_owner_A"
      );
      expect(lockResA.status).toBe(1);

      // 2. 恶意/过期请求 B 尝试调用 releaseRowLock
      const rogueRelease = await RowLockManager.releaseRowLock(
        schoolId,
        table,
        targetId,
        "req_rogue_B",
        false
      );
      expect(rogueRelease.status).toBe(1); // 幂等放行不崩，但不应删除他人锁

      // 3. 断言锁依然完好，第三方请求 C 依然无法抢锁
      const lockResC = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        "req_third_C"
      );
      expect(lockResC.status).toBe(0);
      expect(lockResC.content).toContain("[M03 行锁互斥]");
      expect(lockResC.content).toContain("req_owner_A");

      // 4. 正确持有者 A 释放后，锁被安全清除
      await RowLockManager.releaseRowLock(schoolId, table, targetId, "req_owner_A", true);
      const isLocked = await RowLockManager.isRowLocked(schoolId, table, targetId);
      expect(isLocked).toBe(false);
    });
  });

  describe("用例 4: Saga 逆序回滚完整性测试 (LIFO 还原数据状态与 Redis 缓存)", () => {
    it("链式操作异常时，withdrawStack 必须按后进先出 (LIFO) 顺序执行全部反向补偿", async () => {
      const schoolId = 1;
      const table = "patrols";
      const patrolId = 201;
      const executionOrder: string[] = [];

      // 模拟工单原始数据快照
      const originalSnapshot = { id: patrolId, schoolId, status: 0, title: "原始工单" };
      await setKV(schoolId, table, patrolId, originalSnapshot);

      const stack = new SagaWithdrawStack();

      // 步骤 1: UPDATE 操作 (将 status 改为 1)
      // 压入步骤 1 补偿闭包: 恢复工单旧快照
      stack.push(async () => {
        executionOrder.push("UNDO_STEP_1_RESTORE_PATROL");
        await setKV(schoolId, table, patrolId, originalSnapshot);
      });

      // 步骤 2: INSERT 操作 (插入一条关联记录 handleId = 555)
      // 压入步骤 2 补偿闭包: 删除关联记录并清理缓存
      stack.push(async () => {
        executionOrder.push("UNDO_STEP_2_CLEAN_HANDLE");
        await delKV(schoolId, "patrols_handle", 555);
      });

      // 步骤 3: 模拟第三步外部网络（如微信推送）严重超时抛错
      expect(stack.size()).toBe(2);

      // 触发全量自愈回滚
      await stack.withdrawAll();

      // 断言 1: 严格按照 LIFO 倒序执行 (步骤 2 先回滚，步骤 1 后回滚)
      expect(executionOrder).toEqual([
        "UNDO_STEP_2_CLEAN_HANDLE",
        "UNDO_STEP_1_RESTORE_PATROL",
      ]);

      // 断言 2: 回滚后栈已被清空
      expect(stack.size()).toBe(0);

      // 断言 3: Redis 缓存已还原为原始快照
      const restored = await getKV(schoolId, table, patrolId);
      expect(restored.data).toEqual(originalSnapshot);
    });
  });

  describe("用例 5: 空快照 INSERT 补偿测试 (精准物理删除与缓存擦除闭包)", () => {
    it("createInsertUndoClosure 生成的闭包在执行时安全平稳，不触发空快照异常", async () => {
      const schoolId = 1;
      const tableName = "patrols_handle";
      const fakeInsertedId = 8888;

      // 预先写入一条测试缓存
      await setKV(schoolId, tableName, fakeInsertedId, { id: fakeInsertedId, duration: 1.5 });
      const beforeUndo = await getKV(schoolId, tableName, fakeInsertedId);
      expect(beforeUndo.data).toBeDefined();

      // 构造并执行插入撤回闭包
      const undoClosure = createInsertUndoClosure(schoolId, tableName, fakeInsertedId);
      await expect(undoClosure()).resolves.not.toThrow();

      // 缓存应被安全擦除
      const afterUndo = await getKV(schoolId, tableName, fakeInsertedId);
      expect(afterUndo.data).toBeNull();
    });
  });

  describe("用例 6: 超时死锁自愈测试", () => {
    it("锁超时租约 (TTL) 到期后，新请求应能自动接管，彻底杜绝死锁悬挂", async () => {
      const schoolId = 1;
      const table = "patrols";
      const targetId = 301;
      const shortTTL = 50; // 50毫秒短租约模拟超时

      // 请求 A 加锁，租约仅 50ms
      const lockResA = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        "req_crash_A",
        shortTTL
      );
      expect(lockResA.status).toBe(1);

      // 立即抢锁应失败
      const immediateAttempt = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        "req_new_B"
      );
      expect(immediateAttempt.status).toBe(0);

      // 等待 70ms 模拟持有者崩溃或网络断开自然超时
      await new Promise((resolve) => setTimeout(resolve, 70));

      // 请求 B 再次尝试抢锁，应顺畅自愈接管
      const recoveredAttempt = await RowLockManager.acquireRowLock(
        schoolId,
        table,
        targetId,
        "UPDATE",
        "req_new_B"
      );
      expect(recoveredAttempt.status).toBe(1);
    });
  });

  describe("用例 7: 多租户隔离性测试 (校区/学校不同锁不冲突)", () => {
    it("学校 1 与学校 2 同时操作相同 ID 的记录，互不干扰且互不阻塞", async () => {
      const table = "patrols";
      const sameRecordId = 999;

      // 学校 1 (聊城大学) 对 999 号工单加锁
      const lockSchool1 = await RowLockManager.acquireRowLock(
        1,
        table,
        sameRecordId,
        "UPDATE",
        "req_lcu_01"
      );
      expect(lockSchool1.status).toBe(1);

      // 学校 2 (北京大学) 同时对 999 号工单加锁
      const lockSchool2 = await RowLockManager.acquireRowLock(
        2,
        table,
        sameRecordId,
        "UPDATE",
        "req_pku_01"
      );
      // 必须同样成功！两校在 Redis 键名空间内彻底物理隔离 (lock:1:... vs lock:2:...)
      expect(lockSchool2.status).toBe(1);

      // 同校冲突依然有效：学校 1 内的另一个请求尝试锁定 999 号工单应被拦截
      const lockSchool1Conflict = await RowLockManager.acquireRowLock(
        1,
        table,
        sameRecordId,
        "UPDATE",
        "req_lcu_02"
      );
      expect(lockSchool1Conflict.status).toBe(0);
      expect(lockSchool1Conflict.content).toContain("[M03 行锁互斥]");
    });
  });
});
