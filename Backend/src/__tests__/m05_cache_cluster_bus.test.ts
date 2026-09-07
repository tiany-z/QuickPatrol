import { beforeEach, describe, expect, it } from "vitest";
import {
  AntiEchoFilterEngine,
  buildTenantKey,
  calculateJitterTtl,
  clearChannelSubscribers,
  clearMemoryCache,
  ClusterBroadcastPacket,
  delTenantKV,
  getTenantKV,
  mgetTenantKV,
  parseTenantKey,
  purgeTenantCache,
  setNullSentinel,
  setTenantKV,
  TenantCacheKeyFactory,
} from "../shared/index.js";
import { RedisWsBridge } from "../ws/redisWsBridge.js";

describe("M05: Redis 多租户命名空间缓存与分布式广播总线 (Cache & Cluster Bus)", () => {
  beforeEach(() => {
    // 保证每个用例环境彻底纯净独立
    clearMemoryCache();
    clearChannelSubscribers();
    AntiEchoFilterEngine.clearTracking();
    RedisWsBridge.resetBridge();
  });

  describe("用例 1: 多租户键名确定性派生与反向解析算法 (Tenant Key Deriver)", () => {
    it("正确派生标准四段式租户命名空间键名", () => {
      const key = buildTenantKey(1, "users", 1001);
      expect(key).toBe("tenant:1:users:1001");

      const keyOrder = buildTenantKey(2, "PATROLS", "20260905001");
      expect(keyOrder).toBe("tenant:2:patrols:20260905001");
    });

    it("非法或缺失 schoolId 时应坚决阻断并抛出清晰错误，杜绝脏键扩散", () => {
      expect(() => buildTenantKey(0, "users", 1001)).toThrow(
        "[M05 命名空间阻断]"
      );
      expect(() => buildTenantKey(-1, "users", 1001)).toThrow(
        "[M05 命名空间阻断]"
      );
      expect(() => buildTenantKey(null as any, "users", 1001)).toThrow(
        "[M05 命名空间阻断]"
      );
    });

    it("反向解析合法租户键名，提取 schoolId/module/subKey", () => {
      const parsed = parseTenantKey("tenant:1:patrols:order_998");
      expect(parsed).not.toBeNull();
      expect(parsed?.schoolId).toBe(1);
      expect(parsed?.module).toBe("patrols");
      expect(parsed?.subKey).toBe("order_998");

      // 非法键名解析返回 null
      expect(parseTenantKey("user:1001")).toBeNull();
      expect(parseTenantKey("tenant:invalid:users:1")).toBeNull();
      expect(parseTenantKey("")).toBeNull();
    });

    it("TenantCacheKeyFactory 五大工厂方法精确派生", () => {
      expect(TenantCacheKeyFactory.forUser(1, 888)).toBe("tenant:1:users:888");
      expect(TenantCacheKeyFactory.forPatrol(1, 999)).toBe(
        "tenant:1:patrols:999"
      );
      expect(TenantCacheKeyFactory.forSettings(1, "ai_model_key")).toBe(
        "tenant:1:settings:ai_model_key"
      );
      expect(TenantCacheKeyFactory.forMonthlyQuota(1, "202609")).toBe(
        "quota:school:1:202609"
      );
      expect(TenantCacheKeyFactory.forUserPresence(1, 666)).toBe(
        "presence:1:666"
      );
    });
  });

  describe("用例 2: 多租户命名空间绝对隔离断言 (多校数据互不干扰)", () => {
    it("学校 1 与学校 2 写入相同自增 ID，数据必须 100% 独立隔离互不踩踏", async () => {
      // 学校 1 录入自增 ID 为 99 的学生
      await setTenantKV(1, "users", 99, {
        name: "聊大张三",
        schoolName: "聊城大学",
      });

      // 学校 2 录入自增 ID 同样为 99 的教师
      await setTenantKV(2, "users", 99, {
        name: "鲁大李四",
        schoolName: "鲁东大学",
      });

      // 分别读取两校自增 ID 99 的数据
      const resSchool1 = await getTenantKV<any>(1, "users", 99);
      const resSchool2 = await getTenantKV<any>(2, "users", 99);

      expect(resSchool1.status).toBe(1);
      expect(resSchool1.data?.name).toBe("聊大张三");
      expect(resSchool1.data?.schoolName).toBe("聊城大学");

      expect(resSchool2.status).toBe(1);
      expect(resSchool2.data?.name).toBe("鲁大李四");
      expect(resSchool2.data?.schoolName).toBe("鲁东大学");

      // 删除学校 1 的用户，学校 2 绝不受波及
      await delTenantKV(1, "users", 99);
      const deleted1 = await getTenantKV(1, "users", 99);
      const remained2 = await getTenantKV(2, "users", 99);

      expect(deleted1.data).toBeNull();
      expect(remained2.data?.name).toBe("鲁大李四");
    });
  });

  describe("用例 3: 防穿透 Sentinel 与 TTL Jitter 防雪崩散列测试", () => {
    it("命中防穿透空标记哨兵时，系统自动安全返回 null 而不直击 MySQL", async () => {
      // 模拟查询 MySQL 查无此工单，写入防穿透空标记
      await setNullSentinel(1, "patrols", 99999, 60);

      const res = await getTenantKV(1, "patrols", 99999);
      expect(res.status).toBe(1);
      expect(res.data).toBeNull();
    });

    it("TTL 随机抖动散列必须在基准时间的 ±10% 范围内离散分布", () => {
      const base = 86400;
      const minExpected = Math.floor(base * 0.9);
      const maxExpected = Math.floor(base * 1.1);

      const samples: number[] = [];
      for (let i = 0; i < 50; i++) {
        const jitter = calculateJitterTtl(base);
        expect(jitter).toBeGreaterThanOrEqual(minExpected);
        expect(jitter).toBeLessThanOrEqual(maxExpected);
        samples.push(jitter);
      }

      // 验证具备离散波动，非固定单值
      const uniqueCount = new Set(samples).size;
      expect(uniqueCount).toBeGreaterThan(1);
    });
  });

  describe("用例 4: 批量 mgetTenantKV 极速读与部分未命中测试", () => {
    it("单次请求批量拉取多个实体，准确匹配已缓存项并忽略缺失项", async () => {
      await setTenantKV(1, "patrols", 101, { orderNo: "P001", status: 1 });
      await setTenantKV(1, "patrols", 102, { orderNo: "P002", status: 2 });
      // 103 未缓存
      // 104 写入防穿透空标记
      await setNullSentinel(1, "patrols", 104);

      const res = await mgetTenantKV<any>(1, "patrols", [101, 102, 103, 104]);
      expect(res.status).toBe(1);
      const map = res.data!;

      expect(map[101]?.orderNo).toBe("P001");
      expect(map[102]?.orderNo).toBe("P002");
      expect(map[103]).toBeUndefined();
      expect(map[104]).toBeUndefined(); // 空哨兵被自动忽略
    });

    it("传入空数组时返回空字典", async () => {
      const res = await mgetTenantKV(1, "patrols", []);
      expect(res.status).toBe(1);
      expect(res.data).toEqual({});
    });
  });

  describe("用例 5: 基于非阻塞安全清退算法的单校全域缓存清退 (purgeTenantCache)", () => {
    it("清退学校 1 时，精准仅清理学校 1 的所有键，学校 2 毫无损伤", async () => {
      // 写入学校 1 的 3 个键
      await setTenantKV(1, "users", 1, { name: "U1" });
      await setTenantKV(1, "patrols", 10, { title: "P10" });
      await setTenantKV(1, "settings", "theme", "dark");

      // 写入学校 2 的 3 个键
      await setTenantKV(2, "users", 1, { name: "U2" });
      await setTenantKV(2, "patrols", 10, { title: "P20" });
      await setTenantKV(2, "settings", "theme", "light");

      // 执行学校 1 全域清退
      const purgeRes = await purgeTenantCache(1);
      expect(purgeRes.status).toBe(1);
      expect(purgeRes.data).toBe(3);

      // 学校 1 的键全部失效
      expect((await getTenantKV(1, "users", 1)).data).toBeNull();
      expect((await getTenantKV(1, "patrols", 10)).data).toBeNull();
      expect((await getTenantKV(1, "settings", "theme")).data).toBeNull();

      // 学校 2 的键完好无损
      expect((await getTenantKV(2, "users", 1)).data?.name).toBe("U2");
      expect((await getTenantKV(2, "patrols", 10)).data?.title).toBe("P20");
      expect((await getTenantKV(2, "settings", "theme")).data).toBe("light");
    });

    it("非法租户 ID 清退时拒绝执行", async () => {
      const res = await purgeTenantCache(0);
      expect(res.status).toBe(0);
      expect(res.content).toContain("清退全域缓存必须提供合法的 schoolId");
    });
  });

  describe("用例 6: 防自环指纹过滤与重复投递去重 (AntiEchoFilterEngine)", () => {
    it("发送节点自身收到自己广播出的消息，必须瞬间阻断丢弃 (Skip Local Echo)", () => {
      const packet: ClusterBroadcastPacket = {
        broadcastId: "uuid-001",
        originNodeId: "BackendNode-01",
        schoolId: 1,
        channel: "ws:cluster:broadcast",
        data: { message: "突发停水通知" },
        createdAt: Date.now(),
      };

      // 在 BackendNode-01 节点上消费自身广播
      const shouldDropOnSender = AntiEchoFilterEngine.shouldDropBroadcast(
        packet,
        "BackendNode-01"
      );
      expect(shouldDropOnSender).toBe(true);

      // 在 BackendNode-02 节点上消费异地广播 -> 放行
      const shouldDropOnReceiver = AntiEchoFilterEngine.shouldDropBroadcast(
        packet,
        "BackendNode-02"
      );
      expect(shouldDropOnReceiver).toBe(false);

      // 再次向 BackendNode-02 投递同一 broadcastId -> 命中滑动窗口去重 -> 阻断
      const shouldDropDuplicate = AntiEchoFilterEngine.shouldDropBroadcast(
        packet,
        "BackendNode-02"
      );
      expect(shouldDropDuplicate).toBe(true);
    });
  });

  describe("用例 7: 双虚拟节点跨进程端到端广播模拟 (RedisWsBridge)", () => {
    it("Node-A 广播工单变动事件，Node-A 自身防环丢弃，Node-B 正常消费入库", async () => {
      const receivedAtNodeB: ClusterBroadcastPacket[] = [];
      const receivedAtNodeA: ClusterBroadcastPacket[] = [];

      // 1. 初始化虚拟节点 A 与虚拟节点 B
      const nodeA = new RedisWsBridge("BackendNode-01");
      const nodeB = new RedisWsBridge("BackendNode-02");

      await nodeA.initBridge((packet) => {
        receivedAtNodeA.push(packet);
      });
      await nodeB.initBridge((packet) => {
        receivedAtNodeB.push(packet);
      });

      // 2. 由 Node-A 发起工单状态变更广播 (如师傅接单触发卡片原地演进)
      const packet = await nodeA.broadcast(
        "ws:cluster:card_mutated",
        1,
        {
          orderId: 999,
          action: "ORDER_ACCEPTED",
          handlerName: "张师傅",
        },
        1001
      );

      // 验证广播数据包元数据完整性
      expect(packet.broadcastId).toBeDefined();
      expect(packet.originNodeId).toBe("BackendNode-01");
      expect(packet.channel).toBe("ws:cluster:card_mutated");
      expect(packet.schoolId).toBe(1);
      expect(packet.targetUserId).toBe(1001);

      // 验证 Node-B 顺利接收并消费
      expect(receivedAtNodeB.length).toBe(1);
      expect(receivedAtNodeB[0].data.orderId).toBe(999);
      expect(receivedAtNodeB[0].data.handlerName).toBe("张师傅");
      expect(receivedAtNodeB[0].originNodeId).toBe("BackendNode-01");

      // 验证 Node-A 自身因为命中防自环指纹过滤，回调完全没有被触发 (0ms 拦截，length === 0)
      expect(receivedAtNodeA.length).toBe(0);
    });
  });
});
