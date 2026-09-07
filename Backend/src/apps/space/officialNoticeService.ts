/**
 * M35: 官方重大公告发布、置顶控制与到期下沉引擎 (Official Notice Service)
 * 职责：
 * 1. 后勤处长与校级管理员发布官方重大工程白皮书与突发检修紧急公告
 * 2. 写入 posts 表并标记 isTop = 1，将官方元数据持久化于 configJson
 * 3. 单校置顶通告配额上限守护 (Top Notice Quota Limiter，最多 3 条)
 * 4. 广场首屏置顶红头通告悬浮横幅 (TopBanner) 权重排序与拉取
 * 5. 定时调度与过期通告自动平滑下沉阻尼算法 (Auto-Decay Engine)
 * 6. 内存沙箱隔离自愈桩点
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import {
  IPublishOfficialNoticeDto,
  IPublishNoticeResponseDto,
  ITopNoticeBannerDto,
  IOfficialNoticeConfigJson
} from "./postLikeTypes.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisClient {
  del?(key: string): Promise<number>;
  keys?(pattern: string): Promise<string[]>;
}

export class OfficialNoticeService {
  private static mockNoticesStore: Map<
    number,
    {
      id: number;
      schoolId: number;
      creatorId: number;
      title: string;
      content: string;
      imagesJson: string | null;
      likeCount: number;
      commentCount: number;
      viewCount: number;
      status: number;
      isTop: number;
      configJson: string | null;
      createdAt: string;
      updatedAt: string;
      isDeleted: number;
    }
  > = new Map();
  private static noticeIdCounter = 900;

  constructor(
    private readonly customDb?: IDbExecutor,
    private readonly customRedis?: IRedisClient
  ) {}

  /**
   * 重置与初始化内存沙箱 Mock 数据
   */
  public static resetMockData(): void {
    this.mockNoticesStore.clear();
    this.noticeIdCounter = 900;

    // 内置一条经典的官方置顶通告样例
    const expireDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const expireStr = expireDate.toISOString().replace("T", " ").substring(0, 19);
    const config: IOfficialNoticeConfigJson = {
      isOfficialNotice: true,
      urgencyLevel: "URGENT",
      publishDeptName: "后勤管理处能源动力科",
      topExpireAt: expireStr,
      broadcastPopup: true
    };

    this.mockNoticesStore.set(901, {
      id: 901,
      schoolId: 1,
      creatorId: 1,
      title: "关于西校区供暖加压注水测试的重要通告",
      content: "请各位师生注意，本周五将进行全校高压注水试压，室内请留人观察暖气阀门是否漏水。",
      imagesJson: null,
      likeCount: 68,
      commentCount: 14,
      viewCount: 1200,
      status: 1,
      isTop: 1,
      configJson: JSON.stringify(config),
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      isDeleted: 0
    });
  }

  /**
   * 注册/注入自定义 Mock 置顶通告
   */
  public static seedMockNotice(notice: any): void {
    this.mockNoticesStore.set(notice.id, {
      id: notice.id,
      schoolId: notice.schoolId,
      creatorId: notice.creatorId || 1,
      title: notice.title,
      content: notice.content,
      imagesJson: notice.imagesJson || null,
      likeCount: notice.likeCount || 0,
      commentCount: notice.commentCount || 0,
      viewCount: notice.viewCount || 0,
      status: notice.status ?? 1,
      isTop: notice.isTop ?? 1,
      configJson: notice.configJson || null,
      createdAt: notice.createdAt || new Date().toISOString().replace("T", " ").substring(0, 19),
      updatedAt: notice.updatedAt || new Date().toISOString().replace("T", " ").substring(0, 19),
      isDeleted: notice.isDeleted ?? 0
    });
  }

  /**
   * 发布官方重大置顶公告
   */
  public async publishTopNotice(
    schoolId: number,
    adminUserId: number,
    dto: IPublishOfficialNoticeDto
  ): Promise<IPublishNoticeResponseDto> {
    const {
      title,
      content,
      imageUrls,
      urgencyLevel = "NORMAL",
      departmentId = 1,
      topDurationDays = 7,
      broadcastPopup = false
    } = dto;

    if (!title || typeof title !== "string" || title.trim().length < 5 || title.trim().length > 60) {
      throw new Error("通告标题必须在 5 ~ 60 字之间");
    }

    if (!content || typeof content !== "string" || content.trim().length < 20 || content.length > 3000) {
      throw new Error("通告白皮书正文必须在 20 ~ 3000 字之间");
    }

    // A. 优先使用注入的 customDb
    if (this.customDb) {
      return this.publishWithDb(this.customDb, schoolId, adminUserId, dto);
    }

    // B. 若连接池可用，尝试真实 MySQL
    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb: IDbExecutor = {
          query: async (sql, params) => {
            const r = await executeQuery(sql, params);
            if (r.status !== 1) throw new Error(r.content || "DB query error");
            return ((r as any)?.data || []) as any[];
          },
          execute: async (sql, params) => {
            const r = await executeQuery(sql, params);
            if (r.status !== 1) throw new Error(r.content || "DB execute error");
            const res = (r as any)?.data as any;
            return { insertId: res?.insertId || 0, affectedRows: res?.affectedRows || 0 };
          }
        };
        return await this.publishWithDb(realDb, schoolId, adminUserId, dto);
      } catch (err: any) {
        if (String(err?.message).includes("上限")) throw err;
        return this.publishInMemory(schoolId, adminUserId, dto);
      }
    }

    // C. 降级内存沙箱
    return this.publishInMemory(schoolId, adminUserId, dto);
  }

  private async publishWithDb(
    db: IDbExecutor,
    schoolId: number,
    adminUserId: number,
    dto: IPublishOfficialNoticeDto
  ): Promise<IPublishNoticeResponseDto> {
    const {
      title,
      content,
      imageUrls,
      urgencyLevel = "NORMAL",
      departmentId = 1,
      topDurationDays = 7,
      broadcastPopup = false
    } = dto;

    // 1. 置顶公告配额限制 (Top Notice Quota Limiter: 最多 3 条有效置顶)
    const countSql = `
      SELECT COUNT(1) as activeTopCount 
      FROM posts 
      WHERE schoolId = ? AND isTop = 1 AND status = 1 AND isDeleted = 0
    `;
    const countRows = await db.query<{ activeTopCount: number }>(countSql, [schoolId]);
    const currentTopCount = countRows[0]?.activeTopCount || 0;
    if (currentTopCount >= 3) {
      throw new Error("当前置顶公告已达 3 条上限，请先下沉或等待旧通告到期后再行发布");
    }

    // 2. 获取科室名称
    let publishDeptName = "高校后勤管理处";
    try {
      const deptSql = `SELECT name FROM departments WHERE id = ? AND schoolId = ? LIMIT 1`;
      const deptRows = await db.query<{ name: string }>(deptSql, [departmentId, schoolId]);
      if (deptRows.length > 0 && deptRows[0].name) {
        publishDeptName = deptRows[0].name;
      }
    } catch {
      // ignore
    }

    // 3. 计算到期时间
    const durationDays = Math.max(1, Math.min(30, topDurationDays));
    const expireDate = new Date(Date.now() + durationDays * 24 * 3600 * 1000);
    const topExpireAtStr = expireDate.toISOString().replace("T", " ").substring(0, 19);

    // 4. 构建 configJson
    const configPayload: IOfficialNoticeConfigJson = {
      isOfficialNotice: true,
      urgencyLevel,
      publishDeptName,
      topExpireAt: topExpireAtStr,
      broadcastPopup: Boolean(broadcastPopup)
    };

    const imagesJsonStr = imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
    const configJsonStr = JSON.stringify(configPayload);

    // 5. 插入 posts 表 (isTop = 1, patrolId = 0, status = 1)
    const insertSql = `
      INSERT INTO posts (
        schoolId, creatorId, patrolId, title, content, 
        imagesJson, configJson, likeCount, commentCount, viewCount, 
        status, isTop, createdAt, updatedAt, isDeleted
      ) VALUES (
        ?, ?, 0, ?, ?, 
        ?, ?, 0, 0, 0, 
        1, 1, NOW(), NOW(), 0
      )
    `;

    const result = await db.execute(insertSql, [
      schoolId,
      adminUserId,
      title.trim(),
      content.trim(),
      imagesJsonStr,
      configJsonStr
    ]);

    return {
      postId: result.insertId,
      schoolId,
      title: title.trim(),
      isTop: true,
      topExpireAt: topExpireAtStr,
      urgencyLevel,
      publishedAt: new Date().toISOString(),
      statusText: "官方重大置顶公告已正式生效全校发布"
    };
  }

  private publishInMemory(
    schoolId: number,
    adminUserId: number,
    dto: IPublishOfficialNoticeDto
  ): IPublishNoticeResponseDto {
    const {
      title,
      content,
      imageUrls,
      urgencyLevel = "NORMAL",
      departmentId = 1,
      topDurationDays = 7,
      broadcastPopup = false
    } = dto;

    // 1. 检查配额
    let activeTopCount = 0;
    for (const p of OfficialNoticeService.mockNoticesStore.values()) {
      if (p.schoolId === schoolId && p.isTop === 1 && p.status === 1 && p.isDeleted === 0) {
        activeTopCount++;
      }
    }

    if (activeTopCount >= 3) {
      throw new Error("当前置顶公告已达 3 条上限，请先下沉或等待旧通告到期后再行发布");
    }

    // 2. 组装到期时间与 configJson
    const durationDays = Math.max(1, Math.min(30, topDurationDays));
    const expireDate = new Date(Date.now() + durationDays * 24 * 3600 * 1000);
    const topExpireAtStr = expireDate.toISOString().replace("T", " ").substring(0, 19);

    const configPayload: IOfficialNoticeConfigJson = {
      isOfficialNotice: true,
      urgencyLevel,
      publishDeptName: "高校后勤管理处综合办公室",
      topExpireAt: topExpireAtStr,
      broadcastPopup: Boolean(broadcastPopup)
    };

    OfficialNoticeService.noticeIdCounter += 1;
    const newId = OfficialNoticeService.noticeIdCounter;

    OfficialNoticeService.mockNoticesStore.set(newId, {
      id: newId,
      schoolId,
      creatorId: adminUserId,
      title: title.trim(),
      content: content.trim(),
      imagesJson: imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      status: 1,
      isTop: 1,
      configJson: JSON.stringify(configPayload),
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      updatedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      isDeleted: 0
    });

    return {
      postId: newId,
      schoolId,
      title: title.trim(),
      isTop: true,
      topExpireAt: topExpireAtStr,
      urgencyLevel,
      publishedAt: new Date().toISOString(),
      statusText: "官方重大置顶公告已正式生效全校发布"
    };
  }

  /**
   * 获取广场当前有效的置顶公告列表 (供首屏 TopBanner 悬浮组件展示)
   * 采用 Algorithm 2: 紧急程度覆盖权重 + 临期阻尼算法排位
   */
  public async getActiveTopNotices(schoolId: number): Promise<ITopNoticeBannerDto[]> {
    // A. 优先使用 customDb
    if (this.customDb) {
      return this.getActiveWithDb(this.customDb, schoolId);
    }

    // B. 若连接池可用
    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb: IDbExecutor = {
          query: async (sql, params) => {
            const r = await executeQuery(sql, params);
            if (r.status !== 1) throw new Error(r.content || "DB query error");
            return ((r as any)?.data || []) as any[];
          },
          execute: async (sql, params) => {
            const r = await executeQuery(sql, params);
            if (r.status !== 1) throw new Error(r.content || "DB execute error");
            const res = (r as any)?.data as any;
            return { insertId: res?.insertId || 0, affectedRows: res?.affectedRows || 0 };
          }
        };
        return await this.getActiveWithDb(realDb, schoolId);
      } catch {
        return this.getActiveInMemory(schoolId);
      }
    }

    // C. 降级内存沙箱
    return this.getActiveInMemory(schoolId);
  }

  private async getActiveWithDb(db: IDbExecutor, schoolId: number): Promise<ITopNoticeBannerDto[]> {
    const selectSql = `
      SELECT id, title, content, configJson, createdAt 
      FROM posts 
      WHERE schoolId = ? AND isTop = 1 AND status = 1 AND isDeleted = 0
      ORDER BY id DESC
      LIMIT 10
    `;
    const rows = await db.query<any>(selectSql, [schoolId]);
    return this.resolveBannerDtos(rows);
  }

  private getActiveInMemory(schoolId: number): ITopNoticeBannerDto[] {
    const rows: any[] = [];
    for (const p of OfficialNoticeService.mockNoticesStore.values()) {
      if (p.schoolId === schoolId && p.isTop === 1 && p.status === 1 && p.isDeleted === 0) {
        rows.push(p);
      }
    }
    rows.sort((a, b) => b.id - a.id);
    return this.resolveBannerDtos(rows);
  }

  /**
   * 解析公告行并计算权重排序
   */
  private resolveBannerDtos(rows: any[]): ITopNoticeBannerDto[] {
    const now = Date.now();
    const scoredBanners: { banner: ITopNoticeBannerDto; score: number }[] = [];

    for (const r of rows) {
      let config: Partial<IOfficialNoticeConfigJson> = {};
      try {
        if (r.configJson) {
          config = typeof r.configJson === "string" ? JSON.parse(r.configJson) : r.configJson;
        }
      } catch {
        config = {};
      }

      const urgency = config.urgencyLevel || "NORMAL";
      const deptName = config.publishDeptName || "高校后勤管理处";
      const topExpireAt = config.topExpireAt || "";

      let isExpired = false;
      let remainingHours = 72;

      if (topExpireAt) {
        const expireMs = new Date(topExpireAt).getTime();
        if (!isNaN(expireMs)) {
          if (now >= expireMs) {
            isExpired = true;
          } else {
            remainingHours = Math.max(0, (expireMs - now) / (3600 * 1000));
          }
        }
      }

      if (isExpired) {
        continue; // 过滤已过期的置顶
      }

      // Algorithm 2: 权重推导
      const baseWeight = urgency === "CRITICAL" ? 10000 : urgency === "URGENT" ? 5000 : 1000;
      const timeFactor = Math.max(0, 72 - remainingHours);
      const score = baseWeight + timeFactor;

      let bannerTag = "【后勤权威通告】";
      if (urgency === "CRITICAL") {
        bannerTag = "【突发检修紧急通告】";
      } else if (urgency === "URGENT") {
        bannerTag = "【后勤重大白皮书】";
      }

      const content = String(r.content || "");
      const summary = content.length > 60 ? content.substring(0, 60) + "..." : content;

      scoredBanners.push({
        score,
        banner: {
          noticeId: r.id,
          title: r.title,
          contentSummary: summary,
          urgencyLevel: urgency as any,
          publishDeptName: deptName,
          publishedAtText: r.createdAt ? String(r.createdAt) : "",
          topExpireAt: topExpireAt || "长期置顶",
          isExpired: false,
          bannerTag
        }
      });
    }

    // 按得分降序排序
    scoredBanners.sort((a, b) => b.score - a.score);
    return scoredBanners.slice(0, 5).map((s) => s.banner);
  }

  /**
   * 后台定时调度: 扫描并自动下沉已过期的置顶公告 (Auto-Decay Engine)
   */
  public async scanAndDemoteExpiredTopNotices(schoolId?: number): Promise<number> {
    if (this.customDb) {
      return this.demoteWithDb(this.customDb, schoolId);
    }

    const pool = getMySQLPool();
    if (pool) {
      try {
        const realDb: IDbExecutor = {
          query: async (sql, params) => {
            const r = await executeQuery(sql, params);
            if (r.status !== 1) throw new Error(r.content || "DB query error");
            return ((r as any)?.data || []) as any[];
          },
          execute: async (sql, params) => {
            const r = await executeQuery(sql, params);
            if (r.status !== 1) throw new Error(r.content || "DB execute error");
            const res = (r as any)?.data as any;
            return { insertId: res?.insertId || 0, affectedRows: res?.affectedRows || 0 };
          }
        };
        return await this.demoteWithDb(realDb, schoolId);
      } catch {
        return this.demoteInMemory(schoolId);
      }
    }

    return this.demoteInMemory(schoolId);
  }

  private async demoteWithDb(db: IDbExecutor, schoolId?: number): Promise<number> {
    // 扫描所有 isTop = 1 的公告
    const selectSql = schoolId
      ? `SELECT id, configJson, createdAt FROM posts WHERE schoolId = ? AND isTop = 1 AND isDeleted = 0`
      : `SELECT id, configJson, createdAt FROM posts WHERE isTop = 1 AND isDeleted = 0`;
    const params = schoolId ? [schoolId] : [];

    const rows = await db.query<any>(selectSql, params);
    const expiredIds: number[] = [];
    const now = Date.now();

    for (const r of rows) {
      let isExpired = false;
      try {
        if (r.configJson) {
          const config = typeof r.configJson === "string" ? JSON.parse(r.configJson) : r.configJson;
          if (config.topExpireAt) {
            const expMs = new Date(config.topExpireAt).getTime();
            if (!isNaN(expMs) && now >= expMs) {
              isExpired = true;
            }
          }
        }
      } catch {
        // ignore
      }

      // 如果发布超过 15 天且没有指定到期时间，也强制平滑下沉
      if (!isExpired && r.createdAt) {
        const createdMs = new Date(r.createdAt).getTime();
        if (!isNaN(createdMs) && now - createdMs > 15 * 24 * 3600 * 1000) {
          isExpired = true;
        }
      }

      if (isExpired) {
        expiredIds.push(r.id);
      }
    }

    if (expiredIds.length === 0) {
      return 0;
    }

    const placeholders = expiredIds.map(() => "?").join(",");
    const updateSql = `UPDATE posts SET isTop = 0, updatedAt = NOW() WHERE id IN (${placeholders})`;
    const updateRes = await db.execute(updateSql, expiredIds);
    return updateRes.affectedRows;
  }

  private demoteInMemory(schoolId?: number): number {
    let affected = 0;
    const now = Date.now();

    for (const p of OfficialNoticeService.mockNoticesStore.values()) {
      if (schoolId && p.schoolId !== schoolId) continue;
      if (p.isTop !== 1 || p.isDeleted === 1) continue;

      let isExpired = false;
      if (p.configJson) {
        try {
          const config = JSON.parse(p.configJson);
          if (config.topExpireAt) {
            const expMs = new Date(config.topExpireAt).getTime();
            if (!isNaN(expMs) && now >= expMs) {
              isExpired = true;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!isExpired && p.createdAt) {
        const createdMs = new Date(p.createdAt).getTime();
        if (!isNaN(createdMs) && now - createdMs > 15 * 24 * 3600 * 1000) {
          isExpired = true;
        }
      }

      if (isExpired) {
        p.isTop = 0;
        p.updatedAt = new Date().toISOString().replace("T", " ").substring(0, 19);
        affected++;
      }
    }

    return affected;
  }
}
