/**
 * 高校后勤巡查e速办 v4.0 - M42: 消息通知查询与已读治理服务
 * (Notification Query & Read Receipt Service)
 */

import {
  IAppSessionItemDto,
  IMessageNotificationEntity,
  IQueryAppNotificationsDto
} from "./notificationTypes.js";
import { IDbExecutor, NotificationHub } from "./notificationHub.js";
import { executeQuery } from "../shared/db/mysql.js";

export class NotificationService {
  constructor(private readonly db?: IDbExecutor) {}

  /**
   * 算法 2: 动态分组聚合生成微应用会话大盘列表
   */
  public async getAppSessions(schoolId: number, userId: number): Promise<IAppSessionItemDto[]> {
    if (this.db) {
      try {
        const sql = `
          SELECT 
            m.appId,
            a.name AS appName,
            a.icon AS appIcon,
            a.category,
            a.entryRoute,
            COUNT(CASE WHEN m.isRead = 0 THEN 1 END) AS unreadCount,
            MAX(m.id) AS latestMsgId,
            MAX(m.createdAt) AS lastNoticeAt
          FROM messages m
          LEFT JOIN apps a ON m.appId = a.appCode AND (a.schoolId = m.schoolId OR a.schoolId = 0)
          WHERE m.schoolId = ? AND m.receiverId = ?
          GROUP BY m.appId, a.name, a.icon, a.category, a.entryRoute
          ORDER BY lastNoticeAt DESC
        `;

        const rawRows = await this.db.query<any>(sql, [schoolId, userId]);
        if (rawRows && rawRows.length > 0) {
          const latestIds = rawRows.map((r) => r.latestMsgId).filter(Boolean);
          const idPlaceholders = latestIds.map(() => "?").join(",");

          const latestMsgSql = `SELECT id, title, content FROM messages WHERE id IN (${idPlaceholders})`;
          const msgRows = await this.db.query<{ id: number; title: string; content: string }>(
            latestMsgSql,
            latestIds
          );
          const msgMap = new Map<number, { title: string; content: string }>();
          for (const row of msgRows) {
            msgMap.set(row.id, row);
          }

          return rawRows.map((row) => {
            const msg = msgMap.get(row.latestMsgId);
            return {
              appCode: row.appId,
              appName: row.appName || "系统消息",
              appIcon: row.appIcon || "/assets/icons/default.png",
              category: row.category || "daily",
              entryRoute: row.entryRoute || "",
              unreadCount: parseInt(String(row.unreadCount || "0"), 10),
              lastNoticeTitle: msg?.title || "[新通知]",
              lastNoticeSnippet: (msg?.content || "").substring(0, 30),
              lastNoticeAt: row.lastNoticeAt,
              formattedTimeText: this.formatFriendlyTime(row.lastNoticeAt)
            };
          });
        }
      } catch {
        // 降级使用沙箱聚合
      }
    } else {
      try {
        const sql = `
          SELECT 
            m.appId,
            a.name AS appName,
            a.icon AS appIcon,
            a.category,
            a.entryRoute,
            COUNT(CASE WHEN m.isRead = 0 THEN 1 END) AS unreadCount,
            MAX(m.id) AS latestMsgId,
            MAX(m.createdAt) AS lastNoticeAt
          FROM messages m
          LEFT JOIN apps a ON m.appId = a.appCode AND (a.schoolId = m.schoolId OR a.schoolId = 0)
          WHERE m.schoolId = ? AND m.receiverId = ?
          GROUP BY m.appId, a.name, a.icon, a.category, a.entryRoute
          ORDER BY lastNoticeAt DESC
        `;
        const res = await executeQuery(sql, [schoolId, userId]);
        if (res.status === 1 && Array.isArray(res.data) && res.data.length > 0) {
          const rawRows = res.data;
          const latestIds = rawRows.map((r: any) => r.latestMsgId).filter(Boolean);
          const idPlaceholders = latestIds.map(() => "?").join(",");

          const latestMsgSql = `SELECT id, title, content FROM messages WHERE id IN (${idPlaceholders})`;
          const msgRes = await executeQuery(latestMsgSql, latestIds);
          const msgMap = new Map<number, { title: string; content: string }>();
          if (msgRes.status === 1 && Array.isArray(msgRes.data)) {
            for (const row of msgRes.data) {
              msgMap.set(row.id, row);
            }
          }

          return rawRows.map((row: any) => {
            const msg = msgMap.get(row.latestMsgId);
            return {
              appCode: row.appId,
              appName: row.appName || "系统消息",
              appIcon: row.appIcon || "/assets/icons/default.png",
              category: row.category || "daily",
              entryRoute: row.entryRoute || "",
              unreadCount: parseInt(String(row.unreadCount || "0"), 10),
              lastNoticeTitle: msg?.title || "[新通知]",
              lastNoticeSnippet: (msg?.content || "").substring(0, 30),
              lastNoticeAt: row.lastNoticeAt,
              formattedTimeText: this.formatFriendlyTime(row.lastNoticeAt)
            };
          });
        }
      } catch {
        // 降级使用沙箱聚合
      }
    }

    // 内存沙箱聚合回退 (算法 2 内存执行)
    return this.getAppSessionsFromMock(schoolId, userId);
  }

  /**
   * 内存沙箱下的算法 2: 动态多应用折叠聚合
   */
  private getAppSessionsFromMock(schoolId: number, userId: number): IAppSessionItemDto[] {
    const allMsgs = NotificationHub.getAllMockMessages().filter(
      (m) => m.schoolId === schoolId && m.receiverId === userId
    );

    if (allMsgs.length === 0) {
      return [];
    }

    // 按 appId 分组
    const groupMap = new Map<string, IMessageNotificationEntity[]>();
    for (const m of allMsgs) {
      if (!groupMap.has(m.appId)) {
        groupMap.set(m.appId, []);
      }
      groupMap.get(m.appId)!.push(m);
    }

    const appMetaMap = (NotificationHub as any).mockApps as Map<string, any>;
    const sessions: IAppSessionItemDto[] = [];

    for (const [appId, msgs] of groupMap.entries()) {
      // 依 ID 倒序排序获取最新一条
      msgs.sort((a, b) => b.id - a.id);
      const latestMsg = msgs[0];
      const unreadCount = msgs.filter((m) => m.isRead === 0).length;

      // 匹配应用元数据
      const meta =
        appMetaMap.get(`${schoolId}:${appId}`) ||
        appMetaMap.get(`0:${appId}`) || {
          name: appId === "system" ? "系统通知" : "微应用助手",
          icon: "/assets/icons/default.png",
          category: "daily",
          entryRoute: ""
        };

      sessions.push({
        appCode: appId,
        appName: meta.name,
        appIcon: meta.icon,
        category: meta.category,
        entryRoute: meta.entryRoute,
        unreadCount,
        lastNoticeTitle: latestMsg.title || "[新通知]",
        lastNoticeSnippet: (latestMsg.content || "").substring(0, 30),
        lastNoticeAt: latestMsg.createdAt,
        formattedTimeText: this.formatFriendlyTime(latestMsg.createdAt)
      });
    }

    // 按最新消息时间倒序
    sessions.sort((a, b) => new Date(b.lastNoticeAt).getTime() - new Date(a.lastNoticeAt).getTime());
    return sessions;
  }

  /**
   * 分页拉取某个微应用的明细通知流水 (驱动 M44)
   */
  public async queryAppNotifications(
    schoolId: number,
    userId: number,
    dto: IQueryAppNotificationsDto
  ): Promise<{ list: IMessageNotificationEntity[]; total: number }> {
    const { appId, page = 1, pageSize = 20, onlyUnread = false } = dto;
    const limit = Math.min(50, Math.max(1, pageSize));
    const offset = (Math.max(1, page) - 1) * limit;

    if (this.db) {
      try {
        let whereClause = `schoolId = ? AND receiverId = ? AND appId = ?`;
        const params: any[] = [schoolId, userId, appId];

        if (onlyUnread) {
          whereClause += ` AND isRead = 0`;
        }

        const countSql = `SELECT COUNT(1) AS total FROM messages WHERE ${whereClause}`;
        const countRows = await this.db.query<{ total: number }>(countSql, params);
        const total = countRows[0]?.total || 0;

        const listSql = `
          SELECT * FROM messages 
          WHERE ${whereClause}
          ORDER BY id DESC 
          LIMIT ? OFFSET ?
        `;
        const list = await this.db.query<IMessageNotificationEntity>(listSql, [...params, limit, offset]);
        return { list, total };
      } catch {
        // 降级使用沙箱
      }
    } else {
      try {
        let whereClause = `schoolId = ? AND receiverId = ? AND appId = ?`;
        const params: any[] = [schoolId, userId, appId];

        if (onlyUnread) {
          whereClause += ` AND isRead = 0`;
        }

        const countSql = `SELECT COUNT(1) AS total FROM messages WHERE ${whereClause}`;
        const countRes = await executeQuery(countSql, params);
        const total = countRes.data?.[0]?.total || 0;

        const listSql = `
          SELECT * FROM messages 
          WHERE ${whereClause}
          ORDER BY id DESC 
          LIMIT ? OFFSET ?
        `;
        const listRes = await executeQuery(listSql, [...params, limit, offset]);
        if (listRes.status === 1 && Array.isArray(listRes.data)) {
          return { list: listRes.data, total };
        }
      } catch {
        // 降级使用沙箱
      }
    }

    // 内存沙箱分页查询
    const allMsgs = NotificationHub.getAllMockMessages().filter(
      (m) => m.schoolId === schoolId && m.receiverId === userId && m.appId === appId
    );

    const filtered = onlyUnread ? allMsgs.filter((m) => m.isRead === 0) : allMsgs;
    filtered.sort((a, b) => b.id - a.id);

    const total = filtered.length;
    const list = filtered.slice(offset, offset + limit);
    return { list, total };
  }

  /**
   * 标记通知已读 (单条标已读或整应用一键清零)
   */
  public async ackRead(
    schoolId: number,
    userId: number,
    messageId: number,
    appId: string
  ): Promise<{ clearedRows: number }> {
    if (this.db) {
      try {
        if (messageId > 0) {
          const updateSql = `
            UPDATE messages 
            SET isRead = 1, readAt = NOW() 
            WHERE id = ? AND schoolId = ? AND receiverId = ?
          `;
          const res = await this.db.execute(updateSql, [messageId, schoolId, userId]);
          return { clearedRows: res.affectedRows };
        } else {
          const updateAllSql = `
            UPDATE messages 
            SET isRead = 1, readAt = NOW() 
            WHERE schoolId = ? AND receiverId = ? AND appId = ? AND isRead = 0
          `;
          const res = await this.db.execute(updateAllSql, [schoolId, userId, appId]);
          return { clearedRows: res.affectedRows };
        }
      } catch {
        // 降级使用沙箱
      }
    } else {
      try {
        if (messageId > 0) {
          const updateSql = `
            UPDATE messages 
            SET isRead = 1, readAt = NOW() 
            WHERE id = ? AND schoolId = ? AND receiverId = ?
          `;
          const res = await executeQuery(updateSql, [messageId, schoolId, userId]);
          if (res.status === 1) {
            return { clearedRows: Number((res.data as any)?.affectedRows || 1) };
          }
        } else {
          const updateAllSql = `
            UPDATE messages 
            SET isRead = 1, readAt = NOW() 
            WHERE schoolId = ? AND receiverId = ? AND appId = ? AND isRead = 0
          `;
          const res = await executeQuery(updateAllSql, [schoolId, userId, appId]);
          if (res.status === 1) {
            return { clearedRows: Number((res.data as any)?.affectedRows || 1) };
          }
        }
      } catch {
        // 降级使用沙箱
      }
    }

    // 内存沙箱更新
    const allMsgs = (NotificationHub as any).mockMessages as IMessageNotificationEntity[];
    let clearedRows = 0;
    const nowIso = new Date().toISOString().replace("T", " ").substring(0, 19);

    if (messageId > 0) {
      for (const m of allMsgs) {
        if (m.id === messageId && m.schoolId === schoolId && m.receiverId === userId) {
          if (m.isRead === 0) {
            m.isRead = 1;
            m.readAt = nowIso;
            clearedRows++;
          }
          break;
        }
      }
    } else {
      for (const m of allMsgs) {
        if (m.schoolId === schoolId && m.receiverId === userId && m.appId === appId && m.isRead === 0) {
          m.isRead = 1;
          m.readAt = nowIso;
          clearedRows++;
        }
      }
    }

    return { clearedRows };
  }

  /**
   * 友好人性化时间格式化 (如 "刚刚", "10分钟前", "09-06 14:30")
   */
  public formatFriendlyTime(dateStr?: string | null): string {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();

    if (diffMs < 60000) return "刚刚";
    if (diffMs < 3600000) return `${Math.max(1, Math.floor(diffMs / 60000))}分钟前`;

    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");

    if (d.toDateString() === now.toDateString()) {
      return `${hours}:${minutes}`;
    }

    return `${month}-${day} ${hours}:${minutes}`;
  }

  public static resetMockData(): void {
    // 状态统一由 NotificationHub.resetMockData() 管理
  }
}
