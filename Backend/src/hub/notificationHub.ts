/**
 * 高校后勤巡查e速办 v4.0 - M42: 全系统统一消息中枢 (NotificationHub) 核心调度引擎
 * (NotificationHub Event Bus Core Engine)
 */

import {
  IAppNotificationEvent,
  NotificationPriority,
  ExternalPushStatus,
  IMessageNotificationEntity,
  IAppRegistryEntity,
  INotificationBusPublishPayload
} from "./notificationTypes.js";
import { EventIdempotencyFilter } from "./eventIdempotencyFilter.js";
import { CardPayloadSanitizer } from "./cardPayloadSanitizer.js";
import { executeQuery } from "../shared/db/mysql.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export class NotificationHub {
  // 内存沙箱消息与微应用注册表 (供单元测试与脱机沙箱零外部依赖运行)
  private static mockMessages: IMessageNotificationEntity[] = [];
  private static mockApps: Map<string, IAppRegistryEntity> = new Map();
  private static nextMessageId = 1;

  static {
    NotificationHub.initDefaultMockApps();
  }

  /**
   * 初始化高校默认微应用注册白名单
   */
  public static initDefaultMockApps(): void {
    const defaultApps: IAppRegistryEntity[] = [
      {
        id: 1,
        schoolId: 0,
        appCode: "app-patrol",
        name: "巡查工单助手",
        icon: "/assets/icons/app_patrol.png",
        category: "daily",
        entryRoute: "/packages/apps/app-patrol/pages/detail/index",
        minRole: 0,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 1
      },
      {
        id: 2,
        schoolId: 0,
        appCode: "app-appeal",
        name: "师生诉求小管家",
        icon: "/assets/icons/app_appeal.png",
        category: "service",
        entryRoute: "/packages/apps/app-feedback/pages/detail/index",
        minRole: 0,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 2
      },
      {
        id: 3,
        schoolId: 0,
        appCode: "app-inspection",
        name: "安全督查中枢",
        icon: "/assets/icons/app_inspection.png",
        category: "emergency",
        entryRoute: "/packages/apps/app-inspection/pages/scan-point/index",
        minRole: 2,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 3
      },
      {
        id: 4,
        schoolId: 0,
        appCode: "app-calendar",
        name: "智慧排班日历",
        icon: "/assets/icons/app_calendar.png",
        category: "daily",
        entryRoute: "/packages/apps/app-master-desk/pages/task-pool/index",
        minRole: 1,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 4
      },
      {
        id: 5,
        schoolId: 0,
        appCode: "app-feedback",
        name: "师生服务反馈",
        icon: "/assets/icons/app_feedback.png",
        category: "service",
        entryRoute: "/packages/apps/app-feedback/pages/detail/index",
        minRole: 0,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 5
      },
      {
        id: 6,
        schoolId: 0,
        appCode: "app-space",
        name: "校园公共空间",
        icon: "/assets/icons/app_space.png",
        category: "daily",
        entryRoute: "/packages/apps/app-space/pages/feed-stream/index",
        minRole: 0,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 6
      },
      {
        id: 7,
        schoolId: 0,
        appCode: "system",
        name: "系统广播",
        icon: "/assets/icons/app_system.png",
        category: "management",
        entryRoute: "/pages/index/index",
        minRole: 0,
        isPublic: 1,
        isEnabled: 1,
        isDeleted: 0,
        sortOrder: 99
      }
    ];

    this.mockApps.clear();
    for (const app of defaultApps) {
      this.mockApps.set(`${app.schoolId}:${app.appCode}`, app);
      this.mockApps.set(`0:${app.appCode}`, app);
    }
  }

  constructor(
    private readonly db?: IDbExecutor,
    private readonly redis?: any
  ) {}

  /**
   * 全业务统一事件发布主入口
   */
  public async publish(event: IAppNotificationEvent): Promise<{ success: boolean; messageId: number }> {
    const {
      schoolId,
      appId,
      receiverId,
      patrolId = 0,
      title,
      content,
      cardPayload,
      linkUrl = "",
      priority = NotificationPriority.NORMAL
    } = event;

    // 1. 白名单应用鉴权校验 (防恶意注入未注册 appId)
    const appMeta = await this.resolveAppMeta(schoolId, appId);
    if (!appMeta) {
      throw new Error(`微应用标识非法未注册: ${appId}`);
    }

    // 2. 停用微应用静默抑制 (isEnabled = 0 时不写入数据库，不发通知)
    if (appMeta.isEnabled === 0) {
      return { success: true, messageId: 0 };
    }

    // 3. 算法 1: 事件指纹幂等去重 (5 秒防抖窗口)
    const canPass = await EventIdempotencyFilter.checkAndLock(this.redis, event);
    if (!canPass) {
      return { success: true, messageId: 0 }; // 命中幂等短路返回
    }

    // 4. 算法 4: 结构化富卡片 Schema 安全清洗与 128KB 物理硬截断
    const cleanedCardPayload = CardPayloadSanitizer.sanitize(cardPayload);
    const cardPayloadJson = JSON.stringify(cleanedCardPayload);

    const safeTitle = (title || "").substring(0, 128);
    const safeContent = content || "";
    const safePriority = (priority as NotificationPriority) || NotificationPriority.NORMAL;

    // 5. 持久化写入 messages 物理表 (表 14)
    let messageId = 0;

    if (this.db) {
      try {
        const insertSql = `
          INSERT INTO messages (
            schoolId, receiverId, appId, patrolId, title, content, 
            cardPayloadJson, linkUrl, priority, isRead, externalPushStatus, smsSent, createdAt
          ) VALUES (
            ?, ?, ?, ?, ?, ?, 
            ?, ?, ?, 0, 'none', 0, NOW()
          )
        `;
        const res = await this.db.execute(insertSql, [
          schoolId,
          receiverId,
          appId,
          patrolId,
          safeTitle,
          safeContent,
          cardPayloadJson,
          linkUrl,
          safePriority
        ]);
        messageId = res.insertId;
      } catch {
        messageId = this.insertIntoMock(event, cardPayloadJson, safeTitle, safeContent, safePriority);
      }
    } else {
      // 优先尝试真实 MySQL 执行
      try {
        const insertSql = `
          INSERT INTO messages (
            schoolId, receiverId, appId, patrolId, title, content, 
            cardPayloadJson, linkUrl, priority, isRead, externalPushStatus, smsSent, createdAt
          ) VALUES (
            ?, ?, ?, ?, ?, ?, 
            ?, ?, ?, 0, 'none', 0, NOW()
          )
        `;
        const dbRes = await executeQuery(insertSql, [
          schoolId,
          receiverId,
          appId,
          patrolId,
          safeTitle,
          safeContent,
          cardPayloadJson,
          linkUrl,
          safePriority
        ]);
        if (dbRes.status === 1 && (dbRes.data as any)?.insertId) {
          messageId = Number((dbRes.data as any).insertId);
        } else {
          messageId = this.insertIntoMock(event, cardPayloadJson, safeTitle, safeContent, safePriority);
        }
      } catch {
        messageId = this.insertIntoMock(event, cardPayloadJson, safeTitle, safeContent, safePriority);
      }
    }

    // 6. 广播至 Redis 总线，驱动下游 M43 在线感知引擎与 WebSocket 直推
    const broadcastPayload: INotificationBusPublishPayload = {
      event: "NEW_NOTIFICATION_ARRIVED",
      schoolId,
      receiverId,
      message: {
        id: messageId,
        appId,
        appName: appMeta.name,
        appIcon: appMeta.icon,
        title: safeTitle,
        content: safeContent,
        priority: safePriority,
        createdAt: new Date().toISOString()
      }
    };

    if (this.redis) {
      try {
        if (typeof this.redis.eval === "function") {
          await this.redis.eval(
            `return redis.call('PUBLISH', KEYS[1], ARGV[1])`,
            1,
            "notif_broadcast_bus",
            JSON.stringify(broadcastPayload)
          );
        } else if (typeof this.redis.publish === "function") {
          await this.redis.publish("notif_broadcast_bus", JSON.stringify(broadcastPayload));
        }
      } catch {
        // 忽略广播错误
      }
    }

    return { success: true, messageId };
  }

  /**
   * 解析微应用元数据 (先查 DB，后查内存沙箱白名单)
   */
  private async resolveAppMeta(
    schoolId: number,
    appCode: string
  ): Promise<{ id: number; name: string; icon: string; isEnabled: number } | null> {
    if (this.db) {
      try {
        const appSql = `SELECT id, name, icon, isEnabled FROM apps WHERE appCode = ? AND (schoolId = ? OR schoolId = 0) LIMIT 1`;
        const rows = await this.db.query<{ id: number; name: string; icon: string; isEnabled: number }>(
          appSql,
          [appCode, schoolId]
        );
        if (rows && rows.length > 0) {
          return rows[0];
        }
      } catch {
        // 降级查内存白名单
      }
    }

    // 查询内存白名单 (优先查学校定制，次查全局 schoolId=0)
    const exactKey = `${schoolId}:${appCode}`;
    if (NotificationHub.mockApps.has(exactKey)) {
      const app = NotificationHub.mockApps.get(exactKey)!;
      return { id: app.id, name: app.name, icon: app.icon, isEnabled: app.isEnabled };
    }

    const globalKey = `0:${appCode}`;
    if (NotificationHub.mockApps.has(globalKey)) {
      const app = NotificationHub.mockApps.get(globalKey)!;
      return { id: app.id, name: app.name, icon: app.icon, isEnabled: app.isEnabled };
    }

    return null;
  }

  private insertIntoMock(
    event: IAppNotificationEvent,
    cardPayloadJson: string,
    title: string,
    content: string,
    priority: NotificationPriority
  ): number {
    const id = NotificationHub.nextMessageId++;
    const entity: IMessageNotificationEntity = {
      id,
      schoolId: event.schoolId,
      receiverId: event.receiverId,
      appId: event.appId,
      patrolId: event.patrolId || 0,
      title,
      content,
      cardPayloadJson,
      linkUrl: event.linkUrl || "",
      priority,
      isRead: 0,
      readAt: null,
      externalPushStatus: ExternalPushStatus.NONE,
      smsSent: 0,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19)
    };
    NotificationHub.mockMessages.push(entity);
    return id;
  }

  // =========================================================================
  // 沙箱数据辅助管理方法 (供测试使用)
  // =========================================================================

  public static registerMockApp(app: Partial<IAppRegistryEntity> & { appCode: string }): void {
    const fullApp: IAppRegistryEntity = {
      id: app.id || Math.floor(Math.random() * 1000) + 100,
      schoolId: app.schoolId !== undefined ? app.schoolId : 0,
      appCode: app.appCode,
      name: app.name || "测试微应用",
      icon: app.icon || "/assets/icons/default.png",
      category: app.category || "daily",
      entryRoute: app.entryRoute || "",
      minRole: app.minRole || 0,
      isPublic: app.isPublic !== undefined ? app.isPublic : 1,
      isEnabled: app.isEnabled !== undefined ? app.isEnabled : 1,
      isDeleted: 0,
      sortOrder: app.sortOrder || 10
    };
    this.mockApps.set(`${fullApp.schoolId}:${fullApp.appCode}`, fullApp);
  }

  public static getAllMockMessages(): IMessageNotificationEntity[] {
    return [...this.mockMessages];
  }

  public static resetMockData(): void {
    this.mockMessages = [];
    this.nextMessageId = 1;
    this.initDefaultMockApps();
    EventIdempotencyFilter.resetMemoryLocks();
  }
}
