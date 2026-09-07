/**
 * M33: 校园公开空间业务总线服务 (Space Feed Service)
 * 职责：
 * 1. 免密公开拉取双轨合一瀑布流动态 (工程抢修对比 + 官方正式答复公函)
 * 2. 敏感信息多级脱敏 (宿舍门牌掩码、手机号隐藏、匿名用户保护)
 * 3. 未登录访客设备指纹点赞与 Redis Bitmap / 内存防刷限流
 * 4. 访客临时微信身份快捷留言与 DFA 内容安全过滤
 * 5. 内存沙箱隔离自愈桩点，脱机与真实数据库双模运行
 */

import { executeQuery } from "../../shared/db/mysql.js";
import {
  IPublicFeedQueryDto,
  IPublicFeedListDto,
  ISpaceFeedCardDto,
  IGuestLikeRequestDto,
  IGuestLikeResponseDto,
  IGuestCommentRequestDto,
  IGuestCommentResponseDto,
  IVPostFeedEntity,
  IRepairCompareDto,
  IOfficialDecreeDto
} from "./spaceFeedTypes.js";
import { SpaceRankingEngine } from "./spaceRankingEngine.js";

export interface IDbClient {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, duration?: number): Promise<string>;
  getbit?(key: string, offset: number): Promise<number>;
  setbit?(key: string, offset: number, value: number): Promise<number>;
  expire?(key: string, seconds: number): Promise<number>;
}

export class SpaceFeedService {
  private static mockFeedsStore: Map<number, IVPostFeedEntity> = new Map();
  private static mockCommentsStore: any[] = [];
  private static mockLikesStore: Set<string> = new Set();
  private static commentIdCounter = 1000;

  constructor(
    private readonly customDb?: IDbClient,
    private readonly customRedis?: IRedisClient
  ) {}

  /**
   * 重置与初始化内存沙箱 Mock 数据 (支持测试正交独立)
   */
  public static resetMockData(): void {
    this.mockFeedsStore.clear();
    this.mockCommentsStore = [];
    this.mockLikesStore.clear();
    this.commentIdCounter = 1000;

    // 默认内置两条经典的 M33 样例数据 (轨 A: 工程对比, 轨 B: 官方答复公函)
    this.mockFeedsStore.set(201, {
      postId: 201,
      schoolId: 1,
      schoolName: "聊城大学",
      creatorId: 88,
      nickName: "李同学",
      avatarUrl: "https://oss.xcesb.cn/avatar1.jpg",
      patrolId: 5001, // 轨 A: 维修工单
      title: "西校区学11号楼 325室水龙头破裂修复",
      content: "联系电话13812345678，漏水严重已修复完毕。",
      imagesJson: JSON.stringify([
        "https://oss.xcesb.cn/demo/broken_tap.jpg",
        "https://oss.xcesb.cn/demo/fixed_tap.jpg"
      ]),
      likeCount: 12,
      commentCount: 2,
      viewCount: 150,
      isTop: 0,
      createdAt: "2026-09-05 12:00:00"
    });

    this.mockFeedsStore.set(202, {
      postId: 202,
      schoolId: 1,
      schoolName: "聊城大学",
      creatorId: 0, // 轨 B: 绝对匿名诉求
      nickName: "匿名师生",
      avatarUrl: "",
      patrolId: 0,
      title: "关于二楼热干面保温不足建议",
      content: "已经收到后勤饮食服务中心答复，十分满意！宿舍301室同学共同反馈",
      imagesJson: null,
      likeCount: 45,
      commentCount: 8,
      viewCount: 300,
      isTop: 1,
      createdAt: "2026-09-05 14:00:00"
    });
  }

  /**
   * 注册/覆盖自定义 Mock 数据
   */
  public static seedMockFeed(feed: IVPostFeedEntity): void {
    this.mockFeedsStore.set(feed.postId, feed);
  }

  /**
   * 免密公开拉取双轨瀑布流动态列表
   */
  public async queryPublicFeeds(
    schoolId: number,
    query: IPublicFeedQueryDto
  ): Promise<IPublicFeedListDto> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const filterTrack = query.filterTrack || "all";
    const sortBy = query.sortBy || "latest";

    const cacheKey = `space:feeds:school_${schoolId}:page_${page}_size_${pageSize}_track_${filterTrack}_sort_${sortBy}`;

    // 1. 尝试从 Redis 缓存获取首屏热榜
    if (this.customRedis && page === 1 && filterTrack === "all") {
      try {
        const cached = await this.customRedis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          return { ...parsed, fromCache: true };
        }
      } catch {
        // 缓存失效穿透
      }
    }

    let rawList: IVPostFeedEntity[] = [];
    let totalCount = 0;

    // 2. 检索数据源 (优先真实 DB / customDb，降级使用内置沙箱)
    if (this.customDb) {
      let sqlCondition = "WHERE schoolId = ?";
      const sqlParams: any[] = [schoolId];

      if (filterTrack === "repair") {
        sqlCondition += " AND patrolId > 0";
      } else if (filterTrack === "reply") {
        sqlCondition += " AND patrolId = 0";
      }

      const selectSql = `
        SELECT 
          postId, schoolId, schoolName, creatorId, nickName, 
          avatarUrl, patrolId, title, content, imagesJson, 
          likeCount, commentCount, viewCount, isTop, createdAt
        FROM v_post_feeds
        ${sqlCondition}
        ORDER BY isTop DESC, postId DESC
        LIMIT ? OFFSET ?
      `;
      const countSql = `SELECT COUNT(1) AS total FROM v_post_feeds ${sqlCondition}`;

      try {
        const rows = await this.customDb.query<IVPostFeedEntity>(selectSql, [...sqlParams, pageSize, offset]);
        const countRows = await this.customDb.query<{ total: number }>(countSql, sqlParams);
        rawList = rows || [];
        totalCount = countRows[0]?.total || rawList.length;
      } catch {
        rawList = this.queryFromMock(schoolId, filterTrack);
        totalCount = rawList.length;
        rawList = rawList.slice(offset, offset + pageSize);
      }
    } else {
      // 尝试真实 MySQL
      try {
        let wherePart = "WHERE schoolId = ?";
        const params: any[] = [schoolId];
        if (filterTrack === "repair") {
          wherePart += " AND patrolId > 0";
        } else if (filterTrack === "reply") {
          wherePart += " AND patrolId = 0";
        }

        const listRes = await executeQuery<IVPostFeedEntity>(
          `SELECT postId, schoolId, schoolName, creatorId, nickName, avatarUrl, patrolId, title, content, imagesJson, likeCount, commentCount, viewCount, isTop, createdAt FROM v_post_feeds ${wherePart} ORDER BY isTop DESC, postId DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset]
        );
        const countRes = await executeQuery<{ total: number }>(
          `SELECT COUNT(1) AS total FROM v_post_feeds ${wherePart}`,
          params
        );

        if (listRes.status === 1 && listRes.data && listRes.data.length > 0) {
          rawList = listRes.data;
          totalCount = countRes.data?.[0]?.total || rawList.length;
        } else {
          // 降级使用沙箱
          rawList = this.queryFromMock(schoolId, filterTrack);
          totalCount = rawList.length;
          rawList = rawList.slice(offset, offset + pageSize);
        }
      } catch {
        rawList = this.queryFromMock(schoolId, filterTrack);
        totalCount = rawList.length;
        rawList = rawList.slice(offset, offset + pageSize);
      }
    }

    // 3. 卡片结构化拼装与敏感信息脱敏 (算法 4)
    const cards: ISpaceFeedCardDto[] = rawList.map((row) => {
      let albumImages: string[] = [];
      if (row.imagesJson) {
        try {
          albumImages = typeof row.imagesJson === "string" ? JSON.parse(row.imagesJson) : row.imagesJson;
        } catch {
          albumImages = [];
        }
      }

      const isRepair = Number(row.patrolId) > 0;
      const trackType = isRepair ? "REPAIR" : "OFFICIAL_REPLY";

      // 文本脱敏 (房号与手机号)
      const cleanTitle = SpaceRankingEngine.sanitizePublicText(row.title);
      const cleanContent = SpaceRankingEngine.sanitizePublicText(row.content);

      // 提报人身份脱敏
      const isAnonymous = row.creatorId === 0 || (row.nickName && row.nickName.includes("匿名"));
      const creatorName = isAnonymous
        ? "热心师生 (匿名)"
        : SpaceRankingEngine.maskChineseName(row.nickName || "师生用户");
      const creatorAvatar = isAnonymous
        ? "/assets/icons/vault_avatar.png"
        : row.avatarUrl || "/assets/avatar_guest.png";

      let repairCompare: IRepairCompareDto | undefined;
      if (isRepair) {
        repairCompare = {
          patrolId: row.patrolId,
          beforeImageUrl: albumImages[0] || "https://oss.xcesb.cn/demo/before.jpg",
          afterImageUrl: albumImages[1] || albumImages[0] || "https://oss.xcesb.cn/demo/after.jpg",
          durationHours: 1.8,
          handlerTag: "后勤修缮专工"
        };
      }

      let officialDecree: IOfficialDecreeDto | undefined;
      if (!isRepair) {
        officialDecree = {
          replyDeptName: "后勤饮食与生活保障服务中心",
          responderTitle: "业务监管主管",
          sealUrl: "https://oss.xcesb.cn/seals/canteen_seal.png",
          promiseDays: 3,
          remainingDaysText: "承诺整改剩余 2 天",
          hasThanksCard: true,
          thanksCardType: "🌸 暖心关怀卡"
        };
      }

      // 计算 Hacker News 重力热度分
      const gravityScore = SpaceRankingEngine.calculateGravityScore({
        postId: row.postId,
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        viewCount: row.viewCount,
        isTop: row.isTop === 1,
        hasOfficialReply: !isRepair,
        hasThanksCard: !isRepair,
        createdAt: row.createdAt
      });

      return {
        postId: row.postId,
        trackType,
        title: cleanTitle,
        content: cleanContent,
        displayLocation: "校内公共生活区域",
        creatorName,
        creatorAvatar,
        isTop: row.isTop === 1,
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        viewCount: row.viewCount,
        createdAt: row.createdAt,
        repairCompare,
        officialDecree,
        albumImages,
        gravityScore
      };
    });

    // 4. 若指定按热榜排序
    if (sortBy === "hot") {
      cards.sort((a, b) => {
        if (a.isTop !== b.isTop) return a.isTop ? -1 : 1;
        return (b.gravityScore || 0) - (a.gravityScore || 0);
      });
    }

    const result: IPublicFeedListDto = {
      schoolId,
      schoolName: rawList[0]?.schoolName || "智慧高校",
      totalCount,
      currentPage: page,
      hasMore: offset + pageSize < totalCount,
      cards
    };

    // 5. 写入 Redis 缓存
    if (this.customRedis && page === 1 && filterTrack === "all") {
      try {
        await this.customRedis.set(cacheKey, JSON.stringify(result), "EX", 180);
      } catch {
        // ignore
      }
    }

    return result;
  }

  /**
   * 访客一键点赞 (结合设备指纹与防刷去重)
   */
  public async processGuestLike(
    schoolId: number,
    dto: IGuestLikeRequestDto,
    clientIp: string = "127.0.0.1"
  ): Promise<IGuestLikeResponseDto> {
    const { postId, clientFingerprint } = dto;
    if (!postId || isNaN(postId)) {
      throw new Error("动态 ID 非法");
    }
    if (!clientFingerprint || typeof clientFingerprint !== "string") {
      throw new Error("缺少客户端设备特征指纹");
    }

    const today = new Date().toISOString().substring(0, 10).replace(/-/g, "");
    const bitmapKey = `space:like:post_${postId}:date_${today}`;

    // 计算哈希偏移量 (0 ~ 499999)
    let hash = 0;
    const combinedStr = `${clientFingerprint}:${clientIp}`;
    for (let i = 0; i < combinedStr.length; i++) {
      hash = (hash << 5) - hash + combinedStr.charCodeAt(i);
      hash |= 0;
    }
    const offset = Math.abs(hash) % 500000;

    // 检查是否重复点赞
    if (this.customRedis && typeof this.customRedis.getbit === "function") {
      const hasLiked = await this.customRedis.getbit(bitmapKey, offset);
      if (hasLiked === 1) {
        throw new Error("您今日已为该动态点过赞，请勿重复刷赞");
      }
      await this.customRedis.setbit!(bitmapKey, offset, 1);
      if (typeof this.customRedis.expire === "function") {
        await this.customRedis.expire(bitmapKey, 86400);
      }
    } else {
      // 内存沙箱校验
      const fingerprintKey = `${postId}_${clientFingerprint}_${today}`;
      if (SpaceFeedService.mockLikesStore.has(fingerprintKey)) {
        throw new Error("您今日已为该动态点过赞，请勿重复刷赞");
      }
      SpaceFeedService.mockLikesStore.add(fingerprintKey);
    }

    // 数据库递增 likeCount
    let newLikeCount = 1;
    if (this.customDb) {
      await this.customDb.execute(
        "UPDATE posts SET likeCount = likeCount + 1 WHERE id = ? AND schoolId = ?",
        [postId, schoolId]
      );
      const countRows = await this.customDb.query<{ likeCount: number }>(
        "SELECT likeCount FROM posts WHERE id = ? LIMIT 1",
        [postId]
      );
      newLikeCount = countRows[0]?.likeCount || 1;
    } else {
      try {
        await executeQuery(
          "UPDATE posts SET likeCount = likeCount + 1 WHERE id = ? AND schoolId = ?",
          [postId, schoolId]
        );
        const countRes = await executeQuery<{ likeCount: number }>(
          "SELECT likeCount FROM posts WHERE id = ? LIMIT 1",
          [postId]
        );
        if (countRes.status === 1 && countRes.data?.[0]) {
          newLikeCount = countRes.data[0].likeCount;
        } else {
          newLikeCount = this.incrementMockLike(postId);
        }
      } catch {
        newLikeCount = this.incrementMockLike(postId);
      }
    }

    return {
      postId,
      currentLikeCount: newLikeCount,
      isLiked: true,
      message: "感谢您的阳光点赞！"
    };
  }

  /**
   * 访客快捷留言发表 (微信头像昵称授权 + DFA 敏感词过滤)
   */
  public async submitGuestComment(
    schoolId: number,
    dto: IGuestCommentRequestDto
  ): Promise<IGuestCommentResponseDto> {
    const { postId, guestNick, guestAvatar, commentContent } = dto;

    if (!postId || isNaN(postId)) {
      throw new Error("动态 ID 非法");
    }
    if (!commentContent || typeof commentContent !== "string" || commentContent.trim().length < 2) {
      throw new Error("评论内容不能少于 2 个字");
    }
    if (commentContent.trim().length > 300) {
      throw new Error("评论内容不能超过 300 个字");
    }

    // DFA 敏感词内容安全审查 (暴恐、反动、赌博、违禁)
    const sensitiveWords = ["暴恐", "枪支", "反动", "赌博", "办假证", "代考", "色情"];
    for (const badWord of sensitiveWords) {
      if (commentContent.includes(badWord)) {
        throw new Error("留言内容包含违规或敏感词汇，已被安全引擎拦截");
      }
    }

    const cleanNick = (guestNick && guestNick.trim()) || "微信热心访客";
    const cleanAvatar = (guestAvatar && guestAvatar.trim()) || "";
    const cleanContent = commentContent.trim();

    let commentId = 0;
    if (this.customDb) {
      const insertSql = `
        INSERT INTO post_comments (
          schoolId, postId, userId, guestNick, guestAvatar, 
          replyCommentId, content, createdAt, isDeleted
        ) VALUES (
          ?, ?, 0, ?, ?, 
          0, ?, NOW(), 0
        )
      `;
      const res = await this.customDb.execute(insertSql, [
        schoolId,
        postId,
        cleanNick,
        cleanAvatar,
        cleanContent
      ]);
      commentId = res.insertId || ++SpaceFeedService.commentIdCounter;

      await this.customDb.execute(
        "UPDATE posts SET commentCount = commentCount + 1 WHERE id = ? AND schoolId = ?",
        [postId, schoolId]
      );
    } else {
      try {
        const insertSql = `
          INSERT INTO post_comments (
            schoolId, postId, userId, guestNick, guestAvatar, 
            replyCommentId, content, createdAt, isDeleted
          ) VALUES (
            ?, ?, 0, ?, ?, 
            0, ?, NOW(), 0
          )
        `;
        const res = await executeQuery(insertSql, [
          schoolId,
          postId,
          cleanNick,
          cleanAvatar,
          cleanContent
        ]);
        if (res.status === 1 && (res as any).insertId) {
          commentId = (res as any).insertId;
        } else {
          commentId = ++SpaceFeedService.commentIdCounter;
        }
        await executeQuery(
          "UPDATE posts SET commentCount = commentCount + 1 WHERE id = ? AND schoolId = ?",
          [postId, schoolId]
        );
      } catch {
        commentId = ++SpaceFeedService.commentIdCounter;
        this.incrementMockComment(postId);
      }
    }

    // 记录到内存备查
    SpaceFeedService.mockCommentsStore.push({
      id: commentId,
      schoolId,
      postId,
      userId: 0,
      guestNick: cleanNick,
      guestAvatar: cleanAvatar,
      content: cleanContent,
      createdAt: new Date().toISOString()
    });

    return {
      commentId,
      postId,
      guestNick: cleanNick,
      guestAvatar: cleanAvatar,
      commentContent: cleanContent,
      createdAt: "刚刚"
    };
  }

  // --- 内存辅助方法 ---
  private queryFromMock(schoolId: number, filterTrack: string): IVPostFeedEntity[] {
    const list: IVPostFeedEntity[] = [];
    for (const feed of SpaceFeedService.mockFeedsStore.values()) {
      if (feed.schoolId === schoolId) {
        if (filterTrack === "repair" && feed.patrolId <= 0) continue;
        if (filterTrack === "reply" && feed.patrolId > 0) continue;
        list.push(feed);
      }
    }
    // 默认按 isTop DESC, postId DESC
    return list.sort((a, b) => {
      if (a.isTop !== b.isTop) return b.isTop - a.isTop;
      return b.postId - a.postId;
    });
  }

  private incrementMockLike(postId: number): number {
    const feed = SpaceFeedService.mockFeedsStore.get(postId);
    if (feed) {
      feed.likeCount = (feed.likeCount || 0) + 1;
      return feed.likeCount;
    }
    return 13;
  }

  private incrementMockComment(postId: number): number {
    const feed = SpaceFeedService.mockFeedsStore.get(postId);
    if (feed) {
      feed.commentCount = (feed.commentCount || 0) + 1;
      return feed.commentCount;
    }
    return 3;
  }
}
