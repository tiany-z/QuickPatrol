/**
 * 高校后勤巡查e速办 v4.0 - M43: 用户在线状态感知防骚扰穿透引擎 20 项专项单元测试套件
 * (M43 PresenceEngine & Fallback Channel Test Suite)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PresenceEngine } from "../hub/presenceEngine.js";
import { DistributedDelayWheel } from "../hub/distributedDelayWheel.js";
import { AntiHarassmentQuotaLimiter } from "../hub/antiHarassmentQuotaLimiter.js";
import { FallbackChannel } from "../hub/fallbackChannel.js";
import { PresenceDelayWorker } from "../hub/presenceDelayWorker.js";
import { PresenceController } from "../hub/presenceController.js";
import {
  UserPresenceStatus,
  ExternalPushStatus,
  IFallbackDelayTaskPayload
} from "../hub/presenceTypes.js";
import { handleHeartbeat } from "../api/v4/presence/heartbeat/handler.js";
import apiEndpoint from "../api/v4/presence/heartbeat/index.js";

describe("[M43] 用户在线状态感知防骚扰穿透引擎测试套件", () => {
  let mockDb: any;
  let mockRedis: any;
  let fakePresenceMap: Map<string, string>;
  let fakeWheelMap: Map<string, Array<{ score: number; member: string }>>;
  let fakeMessages: any[];
  let fakeUsers: any[];
  let presenceEngine: PresenceEngine;
  let fallbackChannel: FallbackChannel;
  let presenceController: PresenceController;

  beforeEach(() => {
    TestHarness.resetSandbox();

    fakePresenceMap = new Map();
    fakeWheelMap = new Map();
    fakeMessages = [
      {
        id: 101,
        schoolId: 1,
        receiverId: 88,
        isRead: 0,
        title: "西区配电房高压打火特急抢险",
        content: "请速至现场处置",
        externalPushStatus: "none",
        smsSent: 0
      },
      {
        id: 102,
        schoolId: 1,
        receiverId: 88,
        isRead: 1,
        title: "常规报修通知已读",
        content: "用户已阅读",
        externalPushStatus: "none",
        smsSent: 0
      },
      {
        id: 103,
        schoolId: 1,
        receiverId: 99,
        isRead: 0,
        title: "普通派工通知",
        content: "请于明日到场",
        externalPushStatus: "none",
        smsSent: 0
      }
    ];

    fakeUsers = [
      { id: 88, schoolId: 1, openId: "o_valid_openid_88", phone: "13800138088" },
      { id: 99, schoolId: 1, openId: "o_valid_openid_99", phone: "13900139099" },
      { id: 100, schoolId: 1, openId: "", phone: "13700137100" }, // 无 openId
      { id: 101, schoolId: 1, openId: "", phone: "12345" } // 非法手机号
    ];

    mockDb = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes("SELECT isRead, title, content FROM messages")) {
          const msgId = params[0];
          const sId = params[1];
          return fakeMessages.filter(m => m.id === msgId && m.schoolId === sId);
        }
        if (sql.includes("SELECT openId, phone FROM users")) {
          const uId = params[0];
          const sId = params[1];
          return fakeUsers.filter(u => u.id === uId && (u.schoolId === sId || u.schoolId === 0));
        }
        return [];
      }),
      execute: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes("UPDATE messages SET externalPushStatus")) {
          const status = params[0];
          const smsSent = params[1];
          const msgId = params[2];
          const msg = fakeMessages.find(m => m.id === msgId);
          if (msg) {
            msg.externalPushStatus = status;
            msg.smsSent = smsSent;
          }
          return { insertId: 0, affectedRows: 1 };
        }
        return { insertId: 0, affectedRows: 1 };
      })
    };

    mockRedis = {
      eval: vi.fn(async (script: string, keyCount: number, ...args: any[]) => {
        // EXISTS
        if (script.includes("EXISTS', KEYS[1]") || script.includes("return redis.call('EXISTS'")) {
          const key = args[0];
          return fakePresenceMap.has(key) ? 1 : 0;
        }
        // SET ... EX ...
        if (script.includes("SET', KEYS[1]")) {
          const key = args[0];
          fakePresenceMap.set(key, "1");
          return "OK";
        }
        // ZADD
        if (script.includes("ZADD")) {
          const key = args[0];
          const score = Number(args[1]);
          const member = String(args[2]);
          if (!fakeWheelMap.has(key)) fakeWheelMap.set(key, []);
          const list = fakeWheelMap.get(key)!;
          list.push({ score, member });
          return 1;
        }
        // ZRANGEBYSCORE + ZREM
        if (script.includes("ZRANGEBYSCORE")) {
          const key = args[0];
          const maxScore = Number(args[1]);
          const limit = Number(args[2]);
          const list = fakeWheelMap.get(key) || [];
          const ready: string[] = [];
          const remaining: Array<{ score: number; member: string }> = [];
          for (const item of list) {
            if (item.score <= maxScore && ready.length < limit) {
              ready.push(item.member);
            } else {
              remaining.push(item);
            }
          }
          fakeWheelMap.set(key, remaining);
          return ready;
        }
        return 1;
      })
    };

    presenceEngine = new PresenceEngine(mockRedis);
    fallbackChannel = new FallbackChannel(mockDb, mockRedis);
    presenceController = new PresenceController(presenceEngine);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 算法 1: 在线租约心跳判定与绝对静默
  // -------------------------------------------------------------------------

  it("[M43-01] 用户前台活跃时刷新心跳 (Active TTL 45s) 并通过 isUserOnline 探测到在线", async () => {
    await presenceEngine.refreshHeartbeat(1, 88, true);
    const isOnline = await presenceEngine.isUserOnline(1, 88);
    expect(isOnline).toBe(true);

    const state = await presenceEngine.getUserPresenceState(1, 88);
    expect(state.status).toBe(UserPresenceStatus.ONLINE_ACTIVE);
    expect(state.userId).toBe(88);
  });

  it("[M43-02] 用户切入后台时刷新心跳 (Idle TTL 15s) 状态为 online_idle", async () => {
    await presenceEngine.refreshHeartbeat(1, 88, false);
    const isOnline = await presenceEngine.isUserOnline(1, 88);
    expect(isOnline).toBe(true);

    const state = await presenceEngine.getUserPresenceState(1, 88);
    expect(state.status).toBe(UserPresenceStatus.ONLINE_IDLE);
  });

  it("[M43-03] 在线活跃用户派发通知绝对静默断言 (directOnline=true，零外部时间轮推入)", async () => {
    fakePresenceMap.set("user_presence:1:88", "1");

    const res = await presenceEngine.dispatchNotificationPresence(1, 88, 101, "normal");
    expect(res.directOnline).toBe(true);

    // 断言绝未调用 ZADD 时间轮
    expect(mockRedis.eval).not.toHaveBeenCalledWith(
      expect.stringContaining("ZADD"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  // -------------------------------------------------------------------------
  // 算法 2: 分布式延迟时间轮调度
  // -------------------------------------------------------------------------

  it("[M43-04] 用户离线时派发普通通知，断言推入 180s 延迟时间轮", async () => {
    fakePresenceMap.clear();

    const before = Date.now();
    const res = await presenceEngine.dispatchNotificationPresence(1, 88, 101, "normal");
    expect(res.directOnline).toBe(false);

    // 断言调用了 ZADD
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("ZADD"),
      1,
      "notif_delay_wheel:1",
      expect.any(String),
      expect.stringContaining("TASK_101")
    );

    // 验证延迟时间为 ~180s (180,000ms)
    const list = fakeWheelMap.get("notif_delay_wheel:1");
    expect(list).toBeDefined();
    expect(list!.length).toBe(1);
    const scheduledScore = list![0].score;
    expect(scheduledScore).toBeGreaterThanOrEqual(before + 179000);
    expect(scheduledScore).toBeLessThanOrEqual(before + 185000);
  });

  it("[M43-05] 用户离线时派发特急工单 (urgent)，断言推入 10s 快速时间轮", async () => {
    fakePresenceMap.clear();

    const before = Date.now();
    const res = await presenceEngine.dispatchNotificationPresence(1, 88, 101, "urgent");
    expect(res.directOnline).toBe(false);

    const list = fakeWheelMap.get("notif_delay_wheel:1");
    expect(list).toBeDefined();
    expect(list!.length).toBe(1);
    const scheduledScore = list![0].score;
    expect(scheduledScore).toBeGreaterThanOrEqual(before + 9000);
    expect(scheduledScore).toBeLessThanOrEqual(before + 15000);
  });

  it("[M43-06] 分布式时间轮 pollReadyTasks 调度器：根据触发时间戳原子提取到期任务", async () => {
    // 注入一条到期任务和一条未到期任务
    const now = Date.now();
    await DistributedDelayWheel.schedule(mockRedis, 1, "EXPIRED_TASK_1", -1000); // 已过期
    await DistributedDelayWheel.schedule(mockRedis, 1, "FUTURE_TASK_2", 60000); // 60s 后

    const ready = await DistributedDelayWheel.pollReadyTasks(mockRedis, 1, 10);
    expect(ready).toContain("EXPIRED_TASK_1");
    expect(ready).not.toContain("FUTURE_TASK_2");
  });

  // -------------------------------------------------------------------------
  // 算法 4: 两级降级自愈穿透通道与幽灵任务自愈
  // -------------------------------------------------------------------------

  it("[M43-07] 幽灵任务自愈熔断：缓冲期内用户已读 (isRead=1)，断言取消外部推送", async () => {
    // 消息 102 的 isRead = 1
    const res = await fallbackChannel.executeFallbackPenetration(1, 88, 102, "normal");
    expect(res.finalStatus).toBe(ExternalPushStatus.NONE);
    expect(res.channelUsed).toBe("NONE");
    expect(res.suppressReason).toContain("自愈熔断");
  });

  it("[M43-08] 离线未读消息 Tier-1 微信服务通知成功推送断言 (wx_sent)", async () => {
    vi.spyOn(fallbackChannel, "sendWxSubscribeMessage").mockResolvedValue(true);

    const res = await fallbackChannel.executeFallbackPenetration(1, 88, 101, "normal");
    expect(res.finalStatus).toBe(ExternalPushStatus.WX_SENT);
    expect(res.channelUsed).toBe("WX_SUBSCRIBE");

    const msg = fakeMessages.find(m => m.id === 101);
    expect(msg.externalPushStatus).toBe("wx_sent");
  });

  it("[M43-09] 微信推送失败时，普通工单断言安全阻断 (严禁发短信骚扰师生)", async () => {
    vi.spyOn(fallbackChannel, "sendWxSubscribeMessage").mockResolvedValue(false);
    const smsSpy = vi.spyOn(fallbackChannel, "sendCarrierSms");

    const res = await fallbackChannel.executeFallbackPenetration(1, 88, 101, "normal");
    expect(res.finalStatus).toBe(ExternalPushStatus.FAILED);
    expect(res.channelUsed).toBe("NONE");
    expect(res.suppressReason).toContain("普通通知不允许动用短信通道骚扰师生");
    expect(smsSpy).not.toHaveBeenCalled();

    const msg = fakeMessages.find(m => m.id === 101);
    expect(msg.externalPushStatus).toBe("failed");
  });

  it("[M43-10] 微信推送失败时，特急工单 (urgent) 断言合法降级至运营商短信 (sms_sent)", async () => {
    vi.spyOn(fallbackChannel, "sendWxSubscribeMessage").mockResolvedValue(false);
    vi.spyOn(fallbackChannel, "sendCarrierSms").mockResolvedValue(true);

    const res = await fallbackChannel.executeFallbackPenetration(1, 88, 101, "urgent");
    expect(res.finalStatus).toBe(ExternalPushStatus.SMS_SENT);
    expect(res.channelUsed).toBe("SMS_CARRIER");

    const msg = fakeMessages.find(m => m.id === 101);
    expect(msg.externalPushStatus).toBe("sms_sent");
    expect(msg.smsSent).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 算法 3: 短信防骚扰风控配额硬顶与 300s 冷却
  // -------------------------------------------------------------------------

  it("[M43-11] 短信风控算法 3：单人单日达到 3 条硬顶限额后，再次请求发信必须被严格阻断", async () => {
    vi.spyOn(fallbackChannel, "sendWxSubscribeMessage").mockResolvedValue(false);
    vi.spyOn(fallbackChannel, "sendCarrierSms").mockResolvedValue(true);

    // 连续消耗 3 次配额 (由于 300s 冷却限制，我们模拟时间推移)
    const check1 = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(undefined, 1, 88);
    expect(check1.allowed).toBe(true);

    // 清除冷却锁，模拟过了 300s
    (AntiHarassmentQuotaLimiter as any).memoryCooldown.clear();
    const check2 = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(undefined, 1, 88);
    expect(check2.allowed).toBe(true);

    (AntiHarassmentQuotaLimiter as any).memoryCooldown.clear();
    const check3 = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(undefined, 1, 88);
    expect(check3.allowed).toBe(true);

    // 第 4 次请求，必须拦截
    (AntiHarassmentQuotaLimiter as any).memoryCooldown.clear();
    const check4 = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(undefined, 1, 88);
    expect(check4.allowed).toBe(false);
    expect(check4.reason).toContain("已达单人单日最大限制 (3 条)");
  });

  it("[M43-12] 短信风控算法 3：在 300 秒冷却期内再次请求短信发信，必须被冷却锁强制拦截", async () => {
    const check1 = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(undefined, 1, 88);
    expect(check1.allowed).toBe(true);

    // 立即再次发信 (仍处于 300s 冷却锁内)
    const check2 = await AntiHarassmentQuotaLimiter.checkAndConsumeSmsQuota(undefined, 1, 88);
    expect(check2.allowed).toBe(false);
    expect(check2.reason).toContain("处于 300 秒短信防刷冷却期中");
  });

  // -------------------------------------------------------------------------
  // 边界防御与异常处理
  // -------------------------------------------------------------------------

  it("[M43-13] 用户手机号非法 (非大陆 11 位) 时，短信通道拦截并标记失败", async () => {
    vi.spyOn(fallbackChannel, "sendWxSubscribeMessage").mockResolvedValue(false);
    const smsSpy = vi.spyOn(fallbackChannel, "sendCarrierSms");

    // 构造非法手机号消息
    fakeMessages.push({
      id: 104,
      schoolId: 1,
      receiverId: 101, // 用户 101 手机号为 "12345"
      isRead: 0,
      title: "特急短号测试",
      content: "测试",
      externalPushStatus: "none",
      smsSent: 0
    });

    const res = await fallbackChannel.executeFallbackPenetration(1, 101, 104, "urgent");
    expect(res.finalStatus).toBe(ExternalPushStatus.FAILED);
    expect(res.suppressReason).toContain("用户未绑定有效大陆手机号");
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it("[M43-14] 接收人用户在数据库中不存在时，优雅降级返回 FAILED 并记录原因", async () => {
    const res = await fallbackChannel.executeFallbackPenetration(1, 99999, 101, "urgent");
    expect(res.finalStatus).toBe(ExternalPushStatus.FAILED);
    expect(res.suppressReason).toBe("接收人不存在");
  });

  it("[M43-15] 消息记录已被清理或不存在时的防御性容错", async () => {
    const res = await fallbackChannel.executeFallbackPenetration(1, 88, 99999, "normal");
    expect(res.finalStatus).toBe(ExternalPushStatus.NONE);
    expect(res.suppressReason).toBe("消息已被清理");
  });

  it("[M43-16] 多租户严格物理隔离测试：学校 1 与学校 2 的在线状态与时间轮互不干扰", async () => {
    // 在学校 1 上线
    await presenceEngine.refreshHeartbeat(1, 88, true);
    // 在学校 2 应该离线
    const isOnlineSchool2 = await presenceEngine.isUserOnline(2, 88);
    expect(isOnlineSchool2).toBe(false);

    // 学校 1 的时间轮与学校 2 隔离
    await DistributedDelayWheel.schedule(mockRedis, 1, "TASK_SCH_1", -10);
    const readySchool2 = await DistributedDelayWheel.pollReadyTasks(mockRedis, 2, 10);
    expect(readySchool2).not.toContain("TASK_SCH_1");

    const readySchool1 = await DistributedDelayWheel.pollReadyTasks(mockRedis, 1, 10);
    expect(readySchool1).toContain("TASK_SCH_1");
  });

  // -------------------------------------------------------------------------
  // 后台守护 Worker
  // -------------------------------------------------------------------------

  it("[M43-17] 守护 Worker 生命周期：start、定时消费到期任务、以及 stop 正常停止", async () => {
    const worker = new PresenceDelayWorker(mockRedis, fallbackChannel, [1]);
    expect(worker.getIsRunning()).toBe(false);

    worker.start(500);
    expect(worker.getIsRunning()).toBe(true);

    // 调度一条到期任务
    const taskPayload: IFallbackDelayTaskPayload = {
      taskId: "TASK_101",
      schoolId: 1,
      receiverId: 88,
      messageId: 101,
      priority: "urgent",
      createdAt: new Date().toISOString(),
      scheduledTriggerAt: new Date(Date.now() - 1000).toISOString()
    };
    await DistributedDelayWheel.schedule(mockRedis, 1, JSON.stringify(taskPayload), -1000);

    const processed = await worker.scanOnce();
    expect(processed).toBeGreaterThanOrEqual(1);

    worker.stop();
    expect(worker.getIsRunning()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 控制器与网关集成
  // -------------------------------------------------------------------------

  it("[M43-18] 控制器 heartbeat 接口正常刷新心跳并返回 200 与 active/idle 状态", async () => {
    const res = await presenceController.heartbeat({
      schoolId: 1,
      userId: 88,
      body: { isForeground: true }
    });

    expect(res.code).toBe(200);
    expect(res.data.status).toBe("active");
    expect(res.data.userId).toBe(88);

    const isOnline = await presenceEngine.isUserOnline(1, 88);
    expect(isOnline).toBe(true);
  });

  it("[M43-19] 控制器参数校验：缺失 schoolId 或 userId 时返回受控 400 拦截错误", async () => {
    const res = await presenceController.heartbeat({
      schoolId: 0,
      userId: 0,
      body: {}
    });

    expect(res.code).toBe(400);
    expect(res.message).toContain("参数缺失");
  });

  it("[M43-20] 网关路由端点 POST /api/v4/presence/heartbeat 集成测试", async () => {
    const result = await handleHeartbeat(
      { schoolId: 1, userId: 88, userRole: 2 },
      { isForeground: true }
    );

    expect(result.status).toBe(1);
    expect(result.data.status).toBe("active");

    // 网关完整模块执行测试
    const endpointRes = await apiEndpoint.handler(
      { body: { isForeground: false } } as any,
      { userPayload: { schoolId: 1, userId: 88, role: 2 } } as any
    );
    expect(endpointRes.status).toBe(1);
    expect(endpointRes.data.status).toBe("idle");
  });
});
