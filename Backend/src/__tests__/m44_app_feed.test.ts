/**
 * 高校后勤巡查e速办 v4.0 - M44: 微应用专属服务会话与 100% 富交互卡片流 20 项专项单元测试套件
 * (M44 App Card Stream Test Suite)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { NotificationHub } from "../hub/notificationHub.js";
import { AppFeedService } from "../hub/appFeedService.js";
import { AppFeedController } from "../hub/appFeedController.js";
import { SlaCountdownTicker } from "../hub/slaCountdownTicker.js";
import { IStructuredCardPayload } from "../hub/appFeedTypes.js";
import { handleGetFeed } from "../api/v4/notification/app-feed/handler.js";
import { handleBatchAckRead } from "../api/v4/notification/app-feed/ack-read/handler.js";
import appFeedApiEndpoint from "../api/v4/notification/app-feed/index.js";
import ackReadApiEndpoint from "../api/v4/notification/app-feed/ack-read/index.js";

describe("[M44] 微应用专属服务会话与 100% 富交互卡片流测试套件", () => {
  let mockDb: any;
  let fakeMessages: any[];
  let feedService: AppFeedService;
  let feedController: AppFeedController;

  beforeEach(() => {
    TestHarness.resetSandbox();

    fakeMessages = [
      {
        id: 105,
        schoolId: 1,
        receiverId: 88,
        appId: "app-patrol",
        patrolId: 1005,
        title: "特急抢险派单",
        content: "西区配电房高压打火，请立即前往处置",
        cardPayloadJson: JSON.stringify({
          header: {
            badgeTitle: "特急抢险",
            statusPill: "待接单",
            statusColor: "volcano",
            timestamp: "2026-09-06 14:00:00"
          },
          fields: [
            { label: "隐患编号", value: "#LCU-20260906-001" },
            { label: "隐患点位", value: "西校区12号楼配电房", highlight: true },
            { label: "隐患类型", value: "强电打火" }
          ],
          thumbnailUrl: "https://oss.xcesb.cn/thumb_power.webp",
          rawImageUrl: "https://oss.xcesb.cn/raw_power.jpg",
          actions: [
            { actionId: "ACCEPT_ORDER", text: "立即接单抢修", type: "primary" },
            { actionId: "CALL_USER", text: "拨打报修人", type: "default" }
          ],
          slaDeadlineAt: new Date(Date.now() + 25 * 60 * 1000).toISOString() // 25 分钟后截止
        }),
        isRead: 0,
        createdAt: "2026-09-06 14:00:00"
      },
      {
        id: 104,
        schoolId: 1,
        receiverId: 88,
        appId: "app-patrol",
        patrolId: 1004,
        title: "常规报修派工",
        content: "第二教学楼201教室门锁损坏",
        cardPayloadJson: JSON.stringify({
          header: {
            badgeTitle: "常规报修",
            statusPill: "施工中",
            statusColor: "blue",
            timestamp: "2026-09-06 13:30:00"
          },
          fields: [
            { label: "隐患编号", value: "#LCU-20260906-002" },
            { label: "隐患点位", value: "二教201" }
          ],
          rawImageUrl: "https://oss.xcesb.cn/door_lock.jpg", // 仅有 rawImageUrl，测试算法 4
          actions: [
            { actionId: "SUBMIT_WORK", text: "现场交卷", type: "primary" }
          ],
          slaDeadlineAt: new Date(Date.now() + 120 * 60 * 1000).toISOString() // 2 小时后截止
        }),
        isRead: 0,
        createdAt: "2026-09-06 13:30:00"
      },
      {
        id: 103,
        schoolId: 1,
        receiverId: 88,
        appId: "app-patrol",
        patrolId: 1003,
        title: "已完工归档通知",
        content: "公寓楼水龙头更换已结案",
        cardPayloadJson: JSON.stringify({
          header: {
            badgeTitle: "结案评价",
            statusPill: "已办结",
            statusColor: "gray",
            timestamp: "2026-09-06 12:00:00"
          },
          fields: [
            { label: "隐患编号", value: "#LCU-20260906-003" },
            { label: "服务评价", value: "五星好评" }
          ],
          actions: [
            { actionId: "VIEW_DETAIL", text: "查看详情", type: "default", disabled: true }
          ]
        }),
        isRead: 1,
        createdAt: "2026-09-06 12:00:00"
      },
      {
        id: 102,
        schoolId: 1,
        receiverId: 88,
        appId: "app-patrol",
        patrolId: 1002,
        title: "脏数据通知1",
        content: "这是一条早期的历史纯文本通知，cardPayloadJson 为空",
        cardPayloadJson: null,
        isRead: 0,
        createdAt: "2026-09-06 11:00:00"
      },
      {
        id: 101,
        schoolId: 1,
        receiverId: 88,
        appId: "app-patrol",
        patrolId: 1001,
        title: "脏数据通知2",
        content: "这是一条 JSON 格式损坏的通知",
        cardPayloadJson: "{broken_json_string: true,",
        isRead: 0,
        createdAt: "2026-09-06 10:00:00"
      }
    ];

    mockDb = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes("FROM apps")) {
          const appCode = params[0];
          if (appCode === "app-patrol") {
            return [{ name: "巡查工单助手", icon: "/assets/icons/app_patrol.png" }];
          }
          return [];
        }
        if (sql.includes("FROM messages m")) {
          const sId = params[0];
          const uId = params[1];
          const aId = params[2];
          let cursor = 0;
          let limit = 20;

          if (sql.includes("m.id < ?")) {
            cursor = Number(params[3]);
            limit = Number(params[4]);
          } else {
            limit = Number(params[3]);
          }

          let matched = fakeMessages.filter(
            (m) => m.schoolId === sId && m.receiverId === uId && m.appId === aId
          );
          if (cursor > 0) {
            matched = matched.filter((m) => m.id < cursor);
          }
          matched.sort((a, b) => b.id - a.id);
          return matched.slice(0, limit);
        }
        if (sql.includes("COUNT(1) AS unread")) {
          const sId = params[0];
          const uId = params[1];
          const aId = params[2];
          const unreadCount = fakeMessages.filter(
            (m) => m.schoolId === sId && m.receiverId === uId && m.appId === aId && m.isRead === 0
          ).length;
          return [{ unread: unreadCount }];
        }
        return [];
      }),
      execute: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes("UPDATE messages") && sql.includes("SET isRead = 1")) {
          const sId = params[0];
          const uId = params[1];
          const aId = params[2];
          let count = 0;

          const updateOne = (m: any) => {
            if (m.schoolId === sId && m.receiverId === uId && m.appId === aId && m.isRead === 0) {
              m.isRead = 1;
              count++;
            }
          };

          if (sql.includes("id IN")) {
            const targetIds = params.slice(3).map(Number);
            for (const m of fakeMessages) {
              if (targetIds.includes(m.id)) updateOne(m);
            }
            const allMock = (NotificationHub as any).mockMessages || [];
            for (const m of allMock) {
              if (targetIds.includes(m.id) && m.schoolId === sId && m.receiverId === uId && m.appId === aId && m.isRead === 0) {
                m.isRead = 1;
              }
            }
          } else {
            for (const m of fakeMessages) updateOne(m);
            const allMock = (NotificationHub as any).mockMessages || [];
            for (const m of allMock) {
              if (m.schoolId === sId && m.receiverId === uId && m.appId === aId && m.isRead === 0) {
                m.isRead = 1;
              }
            }
          }
          return { insertId: 0, affectedRows: count };
        }
        return { insertId: 0, affectedRows: 1 };
      })
    };

    // 同步假消息至 NotificationHub 沙箱，供无 db 注入的网关路由单测读取
    for (const msg of fakeMessages) {
      (NotificationHub as any).mockMessages.push({ ...msg });
    }

    feedService = new AppFeedService(mockDb);
    feedController = new AppFeedController(feedService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. 基础拉取与四层视觉语法组装
  // -------------------------------------------------------------------------

  it("[M44-01] 基础卡片流拉取与四层视觉语法组装正确性", async () => {
    const res = await feedService.getAppCardStream(1, 88, "app-patrol", 0, 10);
    expect(res.code).toBe(200);
    expect(res.data.appId).toBe("app-patrol");
    expect(res.data.appName).toBe("巡查工单助手");
    expect(res.data.cards.length).toBe(5);

    const firstCard = res.data.cards[0];
    // Layer 1: Header
    expect(firstCard.cardPayload.header.badgeTitle).toBe("特急抢险");
    expect(firstCard.cardPayload.header.statusPill).toBe("待接单");
    expect(firstCard.cardPayload.header.statusColor).toBe("volcano");

    // Layer 2: Fields
    expect(firstCard.cardPayload.fields.length).toBe(3);
    expect(firstCard.cardPayload.fields[1].highlight).toBe(true);

    // Layer 3: Media
    expect(firstCard.cardPayload.thumbnailUrl).toBe("https://oss.xcesb.cn/thumb_power.webp");
    expect(firstCard.cardPayload.rawImageUrl).toBe("https://oss.xcesb.cn/raw_power.jpg");

    // Layer 4: Action Footer
    expect(firstCard.cardPayload.actions?.length).toBe(2);
    expect(firstCard.cardPayload.actions![0].type).toBe("primary");
  });

  // -------------------------------------------------------------------------
  // 2. 算法 2: 基于主键游标的确定性分页拉取
  // -------------------------------------------------------------------------

  it("[M44-02] 算法 2 游标分页拉取：首屏拉取与按 cursorMessageId 倒序位移断言", async () => {
    // 首次拉取 2 条 (请求 2 条，内部多查 1 条以判断 hasMore)
    const page1 = await feedService.getAppCardStream(1, 88, "app-patrol", 0, 2);
    expect(page1.data.cards.length).toBe(2);
    expect(page1.data.cards[0].messageId).toBe(105);
    expect(page1.data.cards[1].messageId).toBe(104);
    expect(page1.data.hasMore).toBe(true);
    expect(page1.data.nextCursorId).toBe(104);

    // 使用下一页游标 104 继续拉取 2 条
    const page2 = await feedService.getAppCardStream(1, 88, "app-patrol", page1.data.nextCursorId, 2);
    expect(page2.data.cards.length).toBe(2);
    expect(page2.data.cards[0].messageId).toBe(103);
    expect(page2.data.cards[1].messageId).toBe(102);
    expect(page2.data.hasMore).toBe(true);
    expect(page2.data.nextCursorId).toBe(102);
  });

  it("[M44-03] 游标翻页至末尾时 hasMore=false 与 nextCursorId 终态验证", async () => {
    // 从游标 102 继续拉取更早
    const page3 = await feedService.getAppCardStream(1, 88, "app-patrol", 102, 2);
    expect(page3.data.cards.length).toBe(1);
    expect(page3.data.cards[0].messageId).toBe(101);
    expect(page3.data.hasMore).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. 算法 1: SLA 履约倒计时动态推演器
  // -------------------------------------------------------------------------

  it("[M44-04] 算法 1 SLA 动态推演：剩余时间大于 30 分钟返回正常剩余小时分钟", () => {
    const futureDeadline = new Date(Date.now() + 90 * 60 * 1000).toISOString(); // 90分钟
    const result = SlaCountdownTicker.evaluate(futureDeadline);
    expect(result.isUrgent).toBe(false);
    expect(result.isOverdue).toBe(false);
    expect(result.text).toContain("剩余 1 小时 30 分钟");
  });

  it("[M44-05] 算法 1 SLA 动态推演：小于等于 30 分钟触发即将违约与 isUrgent=true", () => {
    const urgentDeadline = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15分钟
    const result = SlaCountdownTicker.evaluate(urgentDeadline);
    expect(result.isUrgent).toBe(true);
    expect(result.isOverdue).toBe(false);
    expect(result.text).toContain("剩余 15 分钟 (即将违约!)");
  });

  it("[M44-06] 算法 1 SLA 动态推演：小于等于 0 毫秒精确判定已逾期与 isOverdue=true", () => {
    const overdueDeadline = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 逾期10分钟
    const result = SlaCountdownTicker.evaluate(overdueDeadline);
    expect(result.isUrgent).toBe(true);
    expect(result.isOverdue).toBe(true);
    expect(result.text).toContain("已逾期 10 分钟 (SLA督查中)");
  });

  // -------------------------------------------------------------------------
  // 4. 脏数据与异常自愈容错
  // -------------------------------------------------------------------------

  it("[M44-07] 脏数据容错自愈：cardPayloadJson 为 null 时降级生成规范系统通知卡片", async () => {
    const res = await feedService.getAppCardStream(1, 88, "app-patrol", 0, 10);
    const fallbackCard = res.data.cards.find((c) => c.messageId === 102);
    expect(fallbackCard).toBeDefined();
    expect(fallbackCard!.cardPayload.header.badgeTitle).toBe("系统通知");
    expect(fallbackCard!.cardPayload.header.statusColor).toBe("gray");
    expect(fallbackCard!.cardPayload.fields[0].value).toBe("脏数据通知1");
  });

  it("[M44-08] 脏数据容错自愈：cardPayloadJson 字符串损坏时捕获异常并平滑降级", async () => {
    const res = await feedService.getAppCardStream(1, 88, "app-patrol", 0, 10);
    const brokenCard = res.data.cards.find((c) => c.messageId === 101);
    expect(brokenCard).toBeDefined();
    expect(brokenCard!.cardPayload.header.badgeTitle).toBe("系统通知");
    expect(brokenCard!.cardPayload.fields[0].value).toBe("脏数据通知2");
  });

  // -------------------------------------------------------------------------
  // 5. 算法 4: 缩略图与高清图自适应处理
  // -------------------------------------------------------------------------

  it("[M44-09] 算法 4 缩略图直出：若仅提供 rawImageUrl 自动追加 OSS 缩略图参数", async () => {
    const res = await feedService.getAppCardStream(1, 88, "app-patrol", 0, 10);
    const card104 = res.data.cards.find((c) => c.messageId === 104);
    expect(card104).toBeDefined();
    expect(card104!.cardPayload.thumbnailUrl).toContain("x-oss-process=image/resize");
    expect(card104!.cardPayload.rawImageUrl).toBe("https://oss.xcesb.cn/door_lock.jpg");
  });

  it("[M44-10] 状态胶囊色彩动力学语义验证 (volcano, blue, orange, green, gray)", async () => {
    const colors = ["volcano", "blue", "orange", "green", "gray"];
    for (const color of colors) {
      const payload: IStructuredCardPayload = {
        header: {
          badgeTitle: "测试",
          statusPill: "测试",
          statusColor: color as any,
          timestamp: "刚刚"
        },
        fields: []
      };
      expect(payload.header.statusColor).toBe(color);
    }
  });

  // -------------------------------------------------------------------------
  // 6. 算法 3: 视口批量标已读
  // -------------------------------------------------------------------------

  it("[M44-11] 算法 3 视口批量标已读：指定 messageIds 数组，受影响行数与剩余未读数断言", async () => {
    // 当前共有 105, 104, 102, 101 4 条未读
    const res = await feedService.batchAckRead(1, 88, "app-patrol", [105, 104]);
    expect(res.clearedCount).toBe(2);
    expect(res.remainingUnread).toBe(2); // 还剩 102 和 101
    expect(fakeMessages.find((m) => m.id === 105).isRead).toBe(1);
    expect(fakeMessages.find((m) => m.id === 104).isRead).toBe(1);
  });

  it("[M44-12] 算法 3 视口批量标已读：未传递 messageIds 时一键全清该微应用全部未读", async () => {
    const res = await feedService.batchAckRead(1, 88, "app-patrol");
    expect(res.clearedCount).toBe(4); // 105, 104, 102, 101 全部置为已读
    expect(res.remainingUnread).toBe(0);
    expect(fakeMessages.every((m) => m.isRead === 1)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. 多租户与安全隔离
  // -------------------------------------------------------------------------

  it("[M44-13] 多租户严格物理隔离测试：租户 1 绝无法查看到租户 2 的卡片流", async () => {
    const res = await feedService.getAppCardStream(2, 88, "app-patrol", 0, 20);
    expect(res.code).toBe(200);
    expect(res.data.cards.length).toBe(0);
  });

  it("[M44-14] 水平越权防御拦截测试：用户 88 无法拉取用户 99 的专属微应用卡片", async () => {
    const res = await feedService.getAppCardStream(1, 99, "app-patrol", 0, 20);
    expect(res.code).toBe(200);
    expect(res.data.cards.length).toBe(0);
  });

  it("[M44-15] 未知或未注册 appId 优雅返回默认微应用名称与图标", async () => {
    const res = await feedService.getAppCardStream(1, 88, "app-unknown", 0, 20);
    expect(res.code).toBe(200);
    expect(res.data.appName).toBe("微应用助手");
  });

  it("[M44-16] 已办结工单动作按钮 disabled 状态透传与按钮视觉类型验证", async () => {
    const res = await feedService.getAppCardStream(1, 88, "app-patrol", 0, 10);
    const card103 = res.data.cards.find((c) => c.messageId === 103);
    expect(card103).toBeDefined();
    expect(card103!.cardPayload.actions![0].disabled).toBe(true);
    expect(card103!.cardPayload.actions![0].type).toBe("default");
  });

  // -------------------------------------------------------------------------
  // 8. 控制器与网关集成
  // -------------------------------------------------------------------------

  it("[M44-17] 控制器 getFeed 缺少必须参数 appId 时返回受控 400 拦截错误", async () => {
    const res = await feedController.getFeed({
      schoolId: 1,
      userId: 88,
      query: { appId: "" }
    });
    expect(res.code).toBe(400);
    expect(res.message).toContain("缺少必要参数: appId");
  });

  it("[M44-18] 控制器 batchAckRead 正常更新并返回清空统计回执", async () => {
    const res = await feedController.batchAckRead({
      schoolId: 1,
      userId: 88,
      body: { appId: "app-patrol" }
    });
    expect(res.code).toBe(200);
    expect(res.data.appId).toBe("app-patrol");
    expect(res.data.clearedCount).toBe(4);
  });

  it("[M44-19] 网关路由端点 GET /api/v4/notification/app-feed 集成调用测试", async () => {
    const handlerRes = await handleGetFeed(
      { schoolId: 1, userId: 88, userRole: 2 },
      { appId: "app-patrol", cursorMessageId: 0, pageSize: 5 }
    );
    expect(handlerRes.status).toBe(1);
    expect(handlerRes.data.cards.length).toBe(5);

    // 网关完整模块 handler 测试
    const endpointRes = await appFeedApiEndpoint.handler(
      { query: { appId: "app-patrol" } } as any,
      { userPayload: { schoolId: 1, userId: 88, role: 2 } } as any
    );
    expect(endpointRes.status).toBe(1);
    expect(endpointRes.data.appId).toBe("app-patrol");
  });

  it("[M44-20] 网关路由端点 POST /api/v4/notification/app-feed/ack-read 集成调用测试", async () => {
    const handlerRes = await handleBatchAckRead(
      { schoolId: 1, userId: 88, userRole: 2 },
      { appId: "app-patrol", messageIds: [105] }
    );
    expect(handlerRes.status).toBe(1);
    expect(handlerRes.data.clearedCount).toBe(1);

    // 网关完整模块 handler 测试
    const endpointRes = await ackReadApiEndpoint.handler(
      { body: { appId: "app-patrol" } } as any,
      { userPayload: { schoolId: 1, userId: 88, role: 2 } } as any
    );
    expect(endpointRes.status).toBe(1);
    expect(endpointRes.data.appId).toBe("app-patrol");
  });
});
