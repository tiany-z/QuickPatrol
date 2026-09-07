/**
 * 高校后勤巡查e速办 v4.0 - M44: 微应用专属卡片流核心调度服务
 * (App Feed Service - Algorithm 2 & 4)
 */

import {
  IAppFeedListResponseDto,
  IAppFeedCardViewDto,
  IStructuredCardPayload
} from "./appFeedTypes.js";
import { SlaCountdownTicker } from "./slaCountdownTicker.js";
import { NotificationHub } from "./notificationHub.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export class AppFeedService {
  constructor(private readonly db?: IDbExecutor) {}

  /**
   * 算法 2 驱动: 基于主键游标分页拉取微应用结构化卡片瀑布流
   * @param schoolId 高校租户 ID
   * @param userId 接收人自然人 ID
   * @param appId 微应用唯一代码标识 (如 'app-patrol', 'app-appeal')
   * @param cursorMessageId 游标 ID (首屏传 0，下一页传上一批末尾的 messageId)
   * @param pageSize 每页拉取数量 (默认 20，限制 1~50)
   */
  public async getAppCardStream(
    schoolId: number,
    userId: number,
    appId: string,
    cursorMessageId: number = 0,
    pageSize: number = 20
  ): Promise<IAppFeedListResponseDto> {
    const limit = Math.min(50, Math.max(1, pageSize));

    // 1. 获取微应用官方元数据
    const appMeta = await this.resolveAppMeta(schoolId, appId);

    // 2. 基于游标查询 messages 物理表 (算法 2)
    let rawRows: any[] = [];

    if (this.db) {
      try {
        let whereClause = `m.schoolId = ? AND m.receiverId = ? AND m.appId = ?`;
        const params: any[] = [schoolId, userId, appId];

        if (cursorMessageId && cursorMessageId > 0) {
          whereClause += ` AND m.id < ?`;
          params.push(cursorMessageId);
        }

        const selectSql = `
          SELECT m.id, m.appId, m.patrolId, m.title, m.content, m.cardPayloadJson, m.isRead, m.createdAt
          FROM messages m
          WHERE ${whereClause}
          ORDER BY m.id DESC
          LIMIT ?
        `;
        params.push(limit + 1);

        rawRows = await this.db.query<any>(selectSql, params);
      } catch {
        rawRows = this.queryFromMock(schoolId, userId, appId, cursorMessageId, limit + 1);
      }
    } else {
      rawRows = this.queryFromMock(schoolId, userId, appId, cursorMessageId, limit + 1);
    }

    const hasMore = rawRows.length > limit;
    const items = hasMore ? rawRows.slice(0, limit) : rawRows;
    const nextCursorId = items.length > 0 ? items[items.length - 1].id : 0;

    // 3. 反序列化卡片载荷，执行算法 1 (SLA 倒计时注水) 与算法 4 (缩略图组装)
    const cardViews: IAppFeedCardViewDto[] = items.map((row) => {
      let cardPayload: IStructuredCardPayload;
      try {
        if (row.cardPayloadJson && typeof row.cardPayloadJson === "string") {
          cardPayload = JSON.parse(row.cardPayloadJson);
        } else if (typeof row.cardPayloadJson === "object" && row.cardPayloadJson !== null) {
          cardPayload = row.cardPayloadJson;
        } else {
          cardPayload = this.generateFallbackCard(row);
        }
      } catch {
        cardPayload = this.generateFallbackCard(row);
      }

      // 规范算法 4: 若只有 rawImageUrl 没有 thumbnailUrl，自动构建轻量缩略图
      if (!cardPayload.thumbnailUrl && cardPayload.rawImageUrl) {
        cardPayload.thumbnailUrl = `${cardPayload.rawImageUrl}?x-oss-process=image/resize,m_fill,w_320,h_320/quality,q_80/format,webp`;
      }

      // 算法 1: 若卡片携带 SLA 截止绝对时间戳，执行毫秒级推演
      let slaInfo = undefined;
      if (cardPayload.slaDeadlineAt) {
        slaInfo = SlaCountdownTicker.evaluate(cardPayload.slaDeadlineAt);
      }

      return {
        messageId: row.id,
        appId: row.appId,
        patrolId: row.patrolId || 0,
        title: row.title || "通知",
        contentSnippet: (row.content || "").substring(0, 40),
        cardPayload,
        isRead: Boolean(row.isRead),
        createdAt: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
        formattedTimeText: this.formatCardTime(row.createdAt),
        slaInfo
      };
    });

    return {
      code: 200,
      message: "获取成功",
      data: {
        appId,
        appName: appMeta.name,
        appIcon: appMeta.icon,
        hasMore,
        nextCursorId,
        cards: cardViews
      }
    };
  }

  /**
   * 算法 3 驱动: 批量将卡片标为已读 (视口停留或离开页面批量消除未读)
   */
  public async batchAckRead(
    schoolId: number,
    userId: number,
    appId: string,
    messageIds?: number[]
  ): Promise<{ clearedCount: number; remainingUnread: number }> {
    let clearedCount = 0;

    if (this.db) {
      try {
        if (messageIds && messageIds.length > 0) {
          const placeholders = messageIds.map(() => "?").join(",");
          const sql = `
            UPDATE messages 
            SET isRead = 1, readAt = NOW() 
            WHERE schoolId = ? AND receiverId = ? AND appId = ? AND id IN (${placeholders}) AND isRead = 0
          `;
          const res = await this.db.execute(sql, [schoolId, userId, appId, ...messageIds]);
          clearedCount = res.affectedRows;
        } else {
          // 一键全清该微应用未读
          const sql = `
            UPDATE messages 
            SET isRead = 1, readAt = NOW() 
            WHERE schoolId = ? AND receiverId = ? AND appId = ? AND isRead = 0
          `;
          const res = await this.db.execute(sql, [schoolId, userId, appId]);
          clearedCount = res.affectedRows;
        }
      } catch {
        clearedCount = this.ackReadInMock(schoolId, userId, appId, messageIds);
      }
    } else {
      clearedCount = this.ackReadInMock(schoolId, userId, appId, messageIds);
    }

    const remainingUnread = await this.countRemainingUnread(schoolId, userId, appId);
    return { clearedCount, remainingUnread };
  }

  /**
   * 统计该微应用当前剩余未读数
   */
  public async countRemainingUnread(
    schoolId: number,
    userId: number,
    appId: string
  ): Promise<number> {
    if (this.db) {
      try {
        const countSql = `
          SELECT COUNT(1) AS unread FROM messages 
          WHERE schoolId = ? AND receiverId = ? AND appId = ? AND isRead = 0
        `;
        const rows = await this.db.query<{ unread: number }>(countSql, [schoolId, userId, appId]);
        return rows[0]?.unread || 0;
      } catch {
        return this.countUnreadInMock(schoolId, userId, appId);
      }
    }
    return this.countUnreadInMock(schoolId, userId, appId);
  }

  // =========================================================================
  // 辅助与自愈方法
  // =========================================================================

  private async resolveAppMeta(
    schoolId: number,
    appCode: string
  ): Promise<{ name: string; icon: string }> {
    if (this.db) {
      try {
        const appSql = `SELECT name, icon FROM apps WHERE appCode = ? AND (schoolId = ? OR schoolId = 0) LIMIT 1`;
        const rows = await this.db.query<{ name: string; icon: string }>(appSql, [appCode, schoolId]);
        if (rows && rows.length > 0) {
          return rows[0];
        }
      } catch {
        // 降级
      }
    }

    // 查内存白名单
    const mockApps = (NotificationHub as any).mockApps as Map<string, any> | undefined;
    if (mockApps) {
      const app = mockApps.get(`${schoolId}:${appCode}`) || mockApps.get(`0:${appCode}`);
      if (app) {
        return { name: app.name, icon: app.icon };
      }
    }

    return { name: "微应用助手", icon: "/assets/icons/app_default.png" };
  }

  /**
   * 脏数据/JSON损坏自愈降级卡片构造器
   */
  public generateFallbackCard(row: any): IStructuredCardPayload {
    return {
      header: {
        badgeTitle: "系统通知",
        statusPill: "已送达",
        statusColor: "gray",
        timestamp: row.createdAt ? String(row.createdAt) : new Date().toISOString()
      },
      fields: [
        { label: "通知标题", value: String(row.title || "业务通知") },
        { label: "通知正文", value: String(row.content || "暂无详情") }
      ],
      actions: []
    };
  }

  private formatCardTime(dateInput: any): string {
    if (!dateInput) return "刚刚";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "刚刚";
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // =========================================================================
  // 内存沙箱查询与更新 (供单元测试脱机执行)
  // =========================================================================

  private queryFromMock(
    schoolId: number,
    userId: number,
    appId: string,
    cursorMessageId: number,
    limit: number
  ): any[] {
    const all = NotificationHub.getAllMockMessages();
    let filtered = all.filter(
      (m) => m.schoolId === schoolId && m.receiverId === userId && m.appId === appId
    );

    if (cursorMessageId > 0) {
      filtered = filtered.filter((m) => m.id < cursorMessageId);
    }

    filtered.sort((a, b) => b.id - a.id);
    return filtered.slice(0, limit);
  }

  private ackReadInMock(
    schoolId: number,
    userId: number,
    appId: string,
    messageIds?: number[]
  ): number {
    const all = NotificationHub.getAllMockMessages();
    let affected = 0;

    for (const m of all) {
      if (m.schoolId === schoolId && m.receiverId === userId && m.appId === appId && m.isRead === 0) {
        if (!messageIds || messageIds.includes(m.id)) {
          m.isRead = 1;
          m.readAt = new Date().toISOString();
          affected++;
        }
      }
    }

    return affected;
  }

  private countUnreadInMock(schoolId: number, userId: number, appId: string): number {
    const all = NotificationHub.getAllMockMessages();
    return all.filter(
      (m) => m.schoolId === schoolId && m.receiverId === userId && m.appId === appId && m.isRead === 0
    ).length;
  }

  public static resetMockData(): void {
    // 复位静态存储
  }
}
