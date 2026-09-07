/**
 * 高校后勤巡查e速办 v4.0 - M42: 统一消息中枢 (NotificationHub) 事件总线专项单元测试套件
 * (NotificationHub Event Bus Test Suite)
 * 
 * 核心测试矩阵：
 * 1. 算法 1: 事件全局唯一指纹与 Redis 幂等去重算法 (EventIdempotencyFilter)
 * 2. 算法 2: 多微应用分组聚合与最新摘要折叠算法 (NotificationService.getAppSessions)
 * 3. 算法 3: 优先级动态加权与防风暴削峰算法 (NotificationThrottler)
 * 4. 算法 4: 富卡片元数据动态校验与 Schema 清洗算法 (CardPayloadSanitizer)
 * 5. NotificationHub 核心调度与白名单/静默抑制/多租户隔离
 * 6. NotificationService 通知流水拉取与单条/批量已读消除
 * 7. NotificationController HTTP 网关适配与参数门禁
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestHarness } from "./testHarness.js";
import { NotificationPriority, ExternalPushStatus } from "../hub/notificationTypes.js";
import { EventIdempotencyFilter } from "../hub/eventIdempotencyFilter.js";
import { CardPayloadSanitizer } from "../hub/cardPayloadSanitizer.js";
import { NotificationThrottler } from "../hub/notificationThrottler.js";
import { NotificationHub } from "../hub/notificationHub.js";
import { NotificationService } from "../hub/notificationService.js";
import { NotificationController } from "../hub/notificationController.js";

describe("M42: 统一消息中枢 (NotificationHub) 事件总线", () => {
  let hub: NotificationHub;
  let service: NotificationService;
  let controller: NotificationController;
  const mockRedis = TestHarness.getRedisSpy();

  beforeEach(() => {
    TestHarness.resetSandbox();
    hub = new NotificationHub(undefined, mockRedis);
    service = new NotificationService();
    controller = new NotificationController(service);
  });

  // =========================================================================
  // 1. 算法 1: 事件全局唯一指纹与幂等去重算法
  // =========================================================================
  describe("1. 算法 1: EventIdempotencyFilter 幂等去重", () => {
    it("M42-01: 标准事件初次提交成功放行并加锁", async () => {
      const event = {
        schoolId: 80042,
        appId: "app-patrol",
        receiverId: 101,
        patrolId: 2001,
        title: "工单派发提醒",
        content: "西区12号楼管道抢修",
        priority: NotificationPriority.NORMAL
      };

      const canPass1 = await EventIdempotencyFilter.checkAndLock(mockRedis, event, 5);
      expect(canPass1).toBe(true);

      // 5秒内重复提交相同指纹事件必被拦截
      const canPass2 = await EventIdempotencyFilter.checkAndLock(mockRedis, event, 5);
      expect(canPass2).toBe(false);
    });

    it("M42-02: 支持自定义 idempotentKey 显式幂等去重", async () => {
      const eventA = {
        schoolId: 80042,
        appId: "app-appeal",
        receiverId: 102,
        title: "诉求受理通知",
        content: "内容A",
        idempotentKey: "IDEMP_APPEAL_2026_CUSTOM_01"
      };

      const eventB = {
        schoolId: 80042,
        appId: "app-appeal",
        receiverId: 102,
        title: "诉求受理通知 (文案微调)",
        content: "内容B (文案变动)",
        idempotentKey: "IDEMP_APPEAL_2026_CUSTOM_01"
      };

      const canPassA = await EventIdempotencyFilter.checkAndLock(mockRedis, eventA, 5);
      expect(canPassA).toBe(true);

      // 虽然标题正文不同，但 idempotentKey 相同，拦截重复入库
      const canPassB = await EventIdempotencyFilter.checkAndLock(mockRedis, eventB, 5);
      expect(canPassB).toBe(false);
    });

    it("M42-03: 指纹不同或接收人不同时互不阻塞", async () => {
      const event1 = {
        schoolId: 80042,
        appId: "app-patrol",
        receiverId: 101,
        patrolId: 100,
        title: "派单通知",
        content: "内容1"
      };
      const event2 = {
        schoolId: 80042,
        appId: "app-patrol",
        receiverId: 102, // 接收人不同
        patrolId: 100,
        title: "派单通知",
        content: "内容2"
      };

      expect(await EventIdempotencyFilter.checkAndLock(mockRedis, event1, 5)).toBe(true);
      expect(await EventIdempotencyFilter.checkAndLock(mockRedis, event2, 5)).toBe(true);
    });
  });

  // =========================================================================
  // 2. 算法 4: 富卡片元数据动态校验与 Schema 清洗算法
  // =========================================================================
  describe("2. 算法 4: CardPayloadSanitizer Schema清洗与128KB截断", () => {
    it("M42-04: XSS 攻击与危险脚本标签强力清除", () => {
      const maliciousPayload = {
        header: {
          badgeTitle: "<script>alert('xss')</script>特急派单",
          statusPill: "<img src=x onerror=alert(1)>待处理",
          statusColor: "volcano" as const,
          timestamp: "2026-09-06"
        },
        fields: [
          { label: "javascript:void(0)点位", value: "<script>steal()</script>配电房" }
        ],
        actions: [
          { actionId: "ACT_1", text: "拨打<script>", type: "primary" as const, url: "javascript:alert(1)" }
        ]
      };

      const cleaned = CardPayloadSanitizer.sanitize(maliciousPayload);
      expect(cleaned.header.badgeTitle).not.toContain("<script>");
      expect(cleaned.header.badgeTitle).toBe("特急派单");
      expect(cleaned.header.statusPill).not.toContain("<img");
      expect(cleaned.fields[0].label).not.toContain("javascript:");
      expect(cleaned.fields[0].value).toBe("配电房");
      expect(cleaned.actions![0].url).not.toContain("javascript:");
    });

    it("M42-05: 限制字段最多 10 项，动作按钮最多 3 个", () => {
      const bulkyFields = Array.from({ length: 25 }, (_, idx) => ({
        label: `标签${idx}`,
        value: `数值${idx}`
      }));
      const bulkyActions = Array.from({ length: 8 }, (_, idx) => ({
        actionId: `ACT_${idx}`,
        text: `按钮${idx}`,
        type: "default" as const
      }));

      const cleaned = CardPayloadSanitizer.sanitize({
        header: { badgeTitle: "工单", statusPill: "正常", statusColor: "blue", timestamp: "" },
        fields: bulkyFields,
        actions: bulkyActions
      });

      expect(cleaned.fields.length).toBe(10);
      expect(cleaned.actions?.length).toBe(3);
    });

    it("M42-06: 超过 128KB 物理硬截断与优雅降级", () => {
      // 构造超大 200KB 字符串模拟 Base64 图片塞入 payload
      const hugeString = "A".repeat(200 * 1024);
      const hugePayload = {
        header: { badgeTitle: "特大卡片", statusPill: "测试", statusColor: "orange" as const, timestamp: "" },
        thumbnailUrl: hugeString,
        fields: [{ label: "大数据", value: hugeString.substring(0, 1000) }]
      };

      const cleaned = CardPayloadSanitizer.sanitize(hugePayload);
      const byteLen = Buffer.byteLength(JSON.stringify(cleaned), "utf8");
      expect(byteLen).toBeLessThanOrEqual(128 * 1024);
      expect(cleaned.thumbnailUrl).toBeUndefined(); // 超限首选被剥离
    });
  });

  // =========================================================================
  // 3. 算法 3: 优先级动态加权与防风暴削峰算法
  // =========================================================================
  describe("3. 算法 3: NotificationThrottler 令牌桶双速调度", () => {
    it("M42-07: 特急通知享 5 倍优先调度权与更高容积", () => {
      NotificationThrottler.resetBuckets();
      const metrics = NotificationThrottler.getMetrics();
      expect(metrics.urgentTokens).toBe(5000);
      expect(metrics.normalTokens).toBe(1000);

      // 普通通知消耗
      const normalPass = NotificationThrottler.tryAcquire(NotificationPriority.NORMAL, 500);
      expect(normalPass).toBe(true);

      // 特急通知大容量消耗放行
      const urgentPass = NotificationThrottler.tryAcquire(NotificationPriority.URGENT, 3000);
      expect(urgentPass).toBe(true);
    });
  });

  // =========================================================================
  // 4. NotificationHub 核心调度与白名单/静默抑制/多租户隔离
  // =========================================================================
  describe("4. NotificationHub 事件入库与总线广播", () => {
    it("M42-08: 正常事件发布入库并触发 Redis 总线广播", async () => {
      const res = await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 88,
        patrolId: 1001,
        title: "紧急派单提醒",
        content: "西区配电房需要排查",
        cardPayload: {
          header: { badgeTitle: "特急", statusPill: "待接单", statusColor: "volcano", timestamp: "" },
          fields: [{ label: "点位", value: "配电房" }]
        },
        linkUrl: "/packages/apps/app-patrol/pages/detail/index?id=1001",
        priority: NotificationPriority.URGENT
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBeGreaterThan(0);

      const msgs = NotificationHub.getAllMockMessages();
      expect(msgs.length).toBe(1);
      expect(msgs[0].id).toBe(res.messageId);
      expect(msgs[0].title).toBe("紧急派单提醒");
      expect(msgs[0].priority).toBe(NotificationPriority.URGENT);
      expect(msgs[0].isRead).toBe(0);
      expect(msgs[0].cardPayloadJson).toContain("特急");
    });

    it("M42-09: 传入未注册的非法 appId 必须硬拦截抛出异常", async () => {
      await expect(
        hub.publish({
          schoolId: 1,
          appId: "app-unknown-exploit" as any,
          receiverId: 88,
          title: "恶意注入",
          content: "测试"
        })
      ).rejects.toThrow("微应用标识非法未注册");
    });

    it("M42-10: 针对已停用应用 (isEnabled=0) 静默抑制零落盘", async () => {
      // 注册一个停用应用
      NotificationHub.registerMockApp({
        appCode: "app-disabled-test",
        name: "已下线应用",
        isEnabled: 0
      });

      const res = await hub.publish({
        schoolId: 1,
        appId: "app-disabled-test",
        receiverId: 88,
        title: "停用通知",
        content: "不应被落盘"
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe(0);
      expect(NotificationHub.getAllMockMessages().length).toBe(0); // 零落盘
    });

    it("M42-11: 租户绝对隔离 - 跨校接收人无法查询彼此通知", async () => {
      // 学校 1 的通知
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 1001,
        title: "学校1工单通知",
        content: "学校1内容"
      });

      // 学校 2 的通知
      await hub.publish({
        schoolId: 2,
        appId: "app-patrol",
        receiverId: 1001, // 相同 userId，不同 schoolId
        title: "学校2工单通知",
        content: "学校2内容"
      });

      const sessionsSchool1 = await service.getAppSessions(1, 1001);
      expect(sessionsSchool1.length).toBe(1);
      expect(sessionsSchool1[0].lastNoticeTitle).toBe("学校1工单通知");

      const sessionsSchool2 = await service.getAppSessions(2, 1001);
      expect(sessionsSchool2.length).toBe(1);
      expect(sessionsSchool2[0].lastNoticeTitle).toBe("学校2工单通知");
    });
  });

  // =========================================================================
  // 5. 算法 2: NotificationService 会话大盘折叠与流水拉取/已读清零
  // =========================================================================
  describe("5. 算法 2: NotificationService 会话大盘与流水治理", () => {
    it("M42-12: 多通知按 appId 动态折叠聚合与未读数累加", async () => {
      // app-patrol 发送 3 条通知
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 99,
        title: "工单派发 01",
        content: "内容1"
      });
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 99,
        title: "工单延期 02",
        content: "内容2",
        idempotentKey: "KEY_P_2"
      });
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 99,
        title: "工单完工 03",
        content: "内容3",
        idempotentKey: "KEY_P_3"
      });

      // app-appeal 发送 1 条通知
      await hub.publish({
        schoolId: 1,
        appId: "app-appeal",
        receiverId: 99,
        title: "诉求已立案",
        content: "已移交后勤科室"
      });

      const sessions = await service.getAppSessions(1, 99);
      expect(sessions.length).toBe(2);

      const patrolSession = sessions.find((s) => s.appCode === "app-patrol");
      expect(patrolSession).toBeDefined();
      expect(patrolSession?.appName).toBe("巡查工单助手");
      expect(patrolSession?.unreadCount).toBe(3);
      expect(patrolSession?.lastNoticeTitle).toBe("工单完工 03");

      const appealSession = sessions.find((s) => s.appCode === "app-appeal");
      expect(appealSession).toBeDefined();
      expect(appealSession?.appName).toBe("师生诉求小管家");
      expect(appealSession?.unreadCount).toBe(1);
    });

    it("M42-13: 分页拉取单微应用卡片流水及仅查未读过滤", async () => {
      for (let i = 1; i <= 5; i++) {
        await hub.publish({
          schoolId: 1,
          appId: "app-patrol",
          receiverId: 77,
          title: `巡查提醒 ${i}`,
          content: `内容 ${i}`,
          idempotentKey: `BATCH_PATROL_${i}`
        });
      }

      // 分页查询 (第 1 页，每页 2 条)
      const resPage1 = await service.queryAppNotifications(1, 77, {
        appId: "app-patrol",
        page: 1,
        pageSize: 2
      });
      expect(resPage1.total).toBe(5);
      expect(resPage1.list.length).toBe(2);
      expect(resPage1.list[0].title).toBe("巡查提醒 5"); // 最新倒序

      // 单条标已读
      await service.ackRead(1, 77, resPage1.list[0].id, "app-patrol");

      // 仅查未读
      const resUnread = await service.queryAppNotifications(1, 77, {
        appId: "app-patrol",
        onlyUnread: true
      });
      expect(resUnread.total).toBe(4);
    });

    it("M42-14: 单条标已读与整应用一键清零断言", async () => {
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 66,
        title: "通知 A",
        content: "A",
        idempotentKey: "ACK_A"
      });
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 66,
        title: "通知 B",
        content: "B",
        idempotentKey: "ACK_B"
      });

      // 一键全清 messageId = 0
      const clearRes = await service.ackRead(1, 66, 0, "app-patrol");
      expect(clearRes.clearedRows).toBe(2);

      const sessions = await service.getAppSessions(1, 66);
      expect(sessions[0].unreadCount).toBe(0);
    });

    it("M42-15: 友好人性化时间格式化测试", () => {
      expect(service.formatFriendlyTime(null)).toBe("");
      const now = new Date();
      expect(service.formatFriendlyTime(now.toISOString())).toBe("刚刚");

      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
      expect(service.formatFriendlyTime(tenMinsAgo.toISOString())).toBe("10分钟前");
    });
  });

  // =========================================================================
  // 6. NotificationController HTTP 接口控制器层测试
  // =========================================================================
  describe("6. NotificationController HTTP 端点与门禁测试", () => {
    it("M42-16: getSessions 返回 200 并携带 totalUnread 与 sessions 列表", async () => {
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 55,
        title: "工单通知",
        content: "配电维修"
      });

      const res = await controller.getSessions({ schoolId: 1, userId: 55, userRole: 0 });
      expect(res.code).toBe(200);
      expect(res.data.totalUnread).toBe(1);
      expect(res.data.sessions.length).toBe(1);

      const standardRes = await controller.handleGetSessions({ schoolId: 1, userId: 55, userRole: 0 });
      expect(standardRes.status).toBe(1);
      expect(standardRes.data.totalUnread).toBe(1);
    });

    it("M42-17: getSessions 缺少 schoolId 或 userId 时返回 400", async () => {
      const res1 = await controller.getSessions({ schoolId: 0, userId: 55, userRole: 0 });
      expect(res1.code).toBe(400);

      const res2 = await controller.getSessions({ schoolId: 1, userId: 0, userRole: 0 });
      expect(res2.code).toBe(400);
    });

    it("M42-18: getAppNotifications 缺失 appId 时返回 400 提示", async () => {
      const res = await controller.getAppNotifications({
        schoolId: 1,
        userId: 55,
        userRole: 0,
        query: {}
      });
      expect(res.code).toBe(400);
      expect(res.message).toContain("缺少参数: appId");
    });

    it("M42-19: getAppNotifications 正常分页拉取流水", async () => {
      await hub.publish({
        schoolId: 1,
        appId: "app-inspection",
        receiverId: 55,
        title: "安全打卡预警",
        content: "消防检查"
      });

      const res = await controller.getAppNotifications({
        schoolId: 1,
        userId: 55,
        userRole: 0,
        query: { appId: "app-inspection", page: "1", pageSize: "10" }
      });
      expect(res.code).toBe(200);
      expect(res.data.total).toBe(1);
      expect(res.data.list[0].title).toBe("安全打卡预警");
    });

    it("M42-20: ackRead 处理已读回执成功包裹", async () => {
      await hub.publish({
        schoolId: 1,
        appId: "app-patrol",
        receiverId: 55,
        title: "待消除通知",
        content: "测试"
      });

      const res = await controller.ackRead({
        schoolId: 1,
        userId: 55,
        userRole: 0,
        body: { appId: "app-patrol", messageId: 0 }
      });
      expect(res.code).toBe(200);
      expect(res.data.clearedRows).toBe(1);

      const standardRes = await controller.handleAckRead({
        schoolId: 1,
        userId: 55,
        userRole: 0,
        body: { appId: "app-patrol", messageId: 0 }
      });
      expect(standardRes.status).toBe(1);
    });
  });
});
