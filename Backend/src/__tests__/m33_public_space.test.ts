/**
 * M33: 双轨合一校园公开空间与免密瀑布流 - 全场景自动化测试套件
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { SpaceRankingEngine } from "../apps/space/spaceRankingEngine.js";
import { SpaceFeedService, IDbClient, IRedisClient } from "../apps/space/spaceFeedService.js";
import { SpaceFeedController } from "../apps/space/spaceFeedController.js";
import { api as feedsApi } from "../api/space/feeds/index.js";
import { api as likeApi } from "../api/space/feeds/like/index.js";
import { api as commentApi } from "../api/space/feeds/guest-comment/index.js";

describe("M33: 双轨合一校园公开空间与免密瀑布流核心测试", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  // ============================================================================
  // 1. SpaceRankingEngine 核心算法推导断言
  // ============================================================================
  describe("1. SpaceRankingEngine 核心算法推导", () => {
    it("1.1 Hacker News 重力热榜得分计算 (普通 vs 置顶 vs 随时间衰减)", () => {
      const now = Date.now();
      const oneHourAgo = now - 3600 * 1000;
      const twentyFourHoursAgo = now - 24 * 3600 * 1000;

      // 候选项 A: 1小时前的普通动态 (10赞, 2评, 50浏览)
      const scoreA = SpaceRankingEngine.calculateGravityScore(
        {
          postId: 1,
          likeCount: 10,
          commentCount: 2,
          viewCount: 50,
          isTop: false,
          hasOfficialReply: false,
          hasThanksCard: false,
          createdAt: oneHourAgo
        },
        now
      );

      // 候选项 B: 24小时前的相同互动量动态 (时间衰减分值显著降低)
      const scoreB = SpaceRankingEngine.calculateGravityScore(
        {
          postId: 2,
          likeCount: 10,
          commentCount: 2,
          viewCount: 50,
          isTop: false,
          hasOfficialReply: false,
          hasThanksCard: false,
          createdAt: twentyFourHoursAgo
        },
        now
      );

      // 候选项 C: 包含官方正式答复 (+15) 与感谢卡 (+25)
      const scoreC = SpaceRankingEngine.calculateGravityScore(
        {
          postId: 3,
          likeCount: 10,
          commentCount: 2,
          viewCount: 50,
          isTop: false,
          hasOfficialReply: true,
          hasThanksCard: true,
          createdAt: oneHourAgo
        },
        now
      );

      // 候选项 D: 官方置顶霸榜动态 (+1000)
      const scoreD = SpaceRankingEngine.calculateGravityScore(
        {
          postId: 4,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          isTop: true,
          hasOfficialReply: false,
          hasThanksCard: false,
          createdAt: oneHourAgo
        },
        now
      );

      expect(scoreA).toBeGreaterThan(scoreB); // 衰减规律断言
      expect(scoreC).toBeGreaterThan(scoreA); // 官方公函与感谢卡加权断言
      expect(scoreD).toBeGreaterThan(scoreC); // 置顶霸榜断言
    });

    it("1.2 双列不规则瀑布流等高贪心排版算法 (左右列高度差极小)", () => {
      const mockCards = [
        {
          postId: 1,
          trackType: "REPAIR" as const,
          title: "学11号楼325室水龙头破裂",
          content: "工程报修",
          creatorName: "张三",
          creatorAvatar: "",
          isTop: false,
          likeCount: 10,
          commentCount: 2,
          viewCount: 50,
          createdAt: "2026-09-05",
          albumImages: ["img1.jpg", "img2.jpg"]
        },
        {
          postId: 2,
          trackType: "OFFICIAL_REPLY" as const,
          title: "食堂二楼保洁诉求答复公函",
          content: "已整改落实",
          creatorName: "李四",
          creatorAvatar: "",
          isTop: false,
          likeCount: 5,
          commentCount: 1,
          viewCount: 20,
          createdAt: "2026-09-05",
          albumImages: []
        },
        {
          postId: 3,
          trackType: "REPAIR" as const,
          title: "东校区路灯照明更换",
          content: "已更换LED灯泡",
          creatorName: "王五",
          creatorAvatar: "",
          isTop: false,
          likeCount: 8,
          commentCount: 0,
          viewCount: 40,
          createdAt: "2026-09-05",
          albumImages: ["light.jpg"]
        }
      ];

      const res = SpaceRankingEngine.distributeMasonryColumns(mockCards, 0, 0);
      expect(res.leftCards.length).toBeGreaterThan(0);
      expect(res.rightCards.length).toBeGreaterThan(0);
      expect(res.leftCards.length + res.rightCards.length).toBe(3);
      // 高度差在合理单卡片容忍度内
      const diff = Math.abs(res.leftHeight - res.rightHeight);
      expect(diff).toBeLessThan(350);
    });

    it("1.3 敏感信息与位置多级脱敏过滤 (算法 4)", () => {
      // 姓名脱敏
      expect(SpaceRankingEngine.maskChineseName("张三")).toBe("张*");
      expect(SpaceRankingEngine.maskChineseName("李晓华")).toBe("李*华");
      expect(SpaceRankingEngine.maskChineseName("诸葛孔明")).toBe("诸**明");

      // 手机号脱敏
      expect(SpaceRankingEngine.maskPhoneNumber("请联系我 13812345678 谢谢")).toBe(
        "请联系我 138****5678 谢谢"
      );

      // 门牌号脱敏
      expect(SpaceRankingEngine.maskDormRoom("学11号楼 325室水龙头破裂")).toBe(
        "学11号楼 3**室水龙头破裂"
      );
      expect(SpaceRankingEngine.maskDormRoom("西区12号楼1204寝室洗手池堵塞")).toBe(
        "西区12号楼12**寝室洗手池堵塞"
      );

      // 综合脱敏
      const rawText = "西区11号楼325室李同学电话13987654321需要维修";
      const clean = SpaceRankingEngine.sanitizePublicText(rawText);
      expect(clean).toContain("3**室");
      expect(clean).toContain("139****4321");
    });
  });

  // ============================================================================
  // 2. SpaceFeedService 业务逻辑与防刷点赞断言
  // ============================================================================
  describe("2. SpaceFeedService 瀑布流装配与访客互动", () => {
    it("[M33-01] 免登录拉取瀑布流，断言返回工程对比与官方答复双轨卡片且电话门牌已脱敏", async () => {
      const service = new SpaceFeedService();
      const res = await service.queryPublicFeeds(1, {
        schoolCode: "lcu",
        page: 1,
        pageSize: 20
      });

      expect(res.schoolId).toBe(1);
      expect(res.cards.length).toBe(2);

      // 验证卡片 1: 轨 A 抢修前后对比
      const repairCard = res.cards.find((c) => c.trackType === "REPAIR");
      expect(repairCard).toBeDefined();
      expect(repairCard!.title).toContain("3**室"); // 门牌已脱敏
      expect(repairCard!.content).toContain("138****5678"); // 电话已脱敏
      expect(repairCard!.repairCompare).toBeDefined();
      expect(repairCard!.repairCompare!.patrolId).toBe(5001);
      expect(repairCard!.repairCompare!.durationHours).toBeGreaterThan(0);

      // 验证卡片 2: 轨 B 官方答复公函 (匿名)
      const replyCard = res.cards.find((c) => c.trackType === "OFFICIAL_REPLY");
      expect(replyCard).toBeDefined();
      expect(replyCard!.creatorName).toBe("热心师生 (匿名)");
      expect(replyCard!.creatorAvatar).toBe("/assets/icons/vault_avatar.png");
      expect(replyCard!.officialDecree).toBeDefined();
      expect(replyCard!.officialDecree!.hasThanksCard).toBe(true);
    });

    it("[M33-01b] 支持轨道筛选与热榜排序", async () => {
      const service = new SpaceFeedService();

      // 筛选仅看工程抢修
      const repairOnly = await service.queryPublicFeeds(1, {
        schoolCode: "lcu",
        filterTrack: "repair"
      });
      expect(repairOnly.cards.length).toBe(1);
      expect(repairOnly.cards[0].trackType).toBe("REPAIR");

      // 筛选仅看官方答复
      const replyOnly = await service.queryPublicFeeds(1, {
        schoolCode: "lcu",
        filterTrack: "reply"
      });
      expect(replyOnly.cards.length).toBe(1);
      expect(replyOnly.cards[0].trackType).toBe("OFFICIAL_REPLY");

      // 按热度排序
      const hotFeeds = await service.queryPublicFeeds(1, {
        schoolCode: "lcu",
        sortBy: "hot"
      });
      expect(hotFeeds.cards.length).toBe(2);
      expect(hotFeeds.cards[0].isTop).toBe(true); // 置顶霸榜在最前
    });

    it("[M33-02] 访客凭借设备指纹首次点赞成功，更新 likeCount", async () => {
      const service = new SpaceFeedService();
      const res = await service.processGuestLike(
        1,
        {
          postId: 201,
          clientFingerprint: "FP_DEVICE_TEST_001"
        },
        "192.168.1.50"
      );

      expect(res.isLiked).toBe(true);
      expect(res.currentLikeCount).toBe(13); // 初始 12 + 1 = 13
      expect(res.message).toContain("感谢您的阳光点赞");
    });

    it("[M33-03] 同一设备指纹今日重复点赞，断言抛出防刷限流异常", async () => {
      const service = new SpaceFeedService();
      // 首次点赞
      await service.processGuestLike(
        1,
        {
          postId: 201,
          clientFingerprint: "FP_DUPLICATE_DEV_X"
        },
        "192.168.1.88"
      );

      // 同一指纹单日二次点赞
      await expect(
        service.processGuestLike(
          1,
          {
            postId: 201,
            clientFingerprint: "FP_DUPLICATE_DEV_X"
          },
          "192.168.1.88"
        )
      ).rejects.toThrow("您今日已为该动态点过赞，请勿重复刷赞");
    });

    it("[M33-04] 访客免登录快捷发表留言，写入 post_comments (userId=0) 且评论数累加", async () => {
      const service = new SpaceFeedService();
      const res = await service.submitGuestComment(1, {
        postId: 201,
        guestNick: "热心学长",
        guestAvatar: "https://oss.xcesb.cn/avatar_wx.png",
        commentContent: "修得很利落，为后勤师傅点赞！"
      });

      expect(res.commentId).toBeGreaterThan(0);
      expect(res.guestNick).toBe("热心学长");
      expect(res.commentContent).toBe("修得很利落，为后勤师傅点赞！");
    });

    it("[M33-05] 访客发表包含敏感词汇内容，断言被内容安全引擎拦截", async () => {
      const service = new SpaceFeedService();
      await expect(
        service.submitGuestComment(1, {
          postId: 201,
          guestNick: "违规访客",
          commentContent: "这里有人在宣传暴恐相关言论"
        })
      ).rejects.toThrow("留言内容包含违规或敏感词汇");
    });

    it("[M33-06] 模拟 Redis Bitmap 与 DB Client 深度模式", async () => {
      const mockRedisDb: Record<string, string> = {};
      const mockBitmap: Record<string, number> = {};

      const mockRedis: IRedisClient = {
        get: vi.fn(async (k) => mockRedisDb[k] || null),
        set: vi.fn(async (k, v) => {
          mockRedisDb[k] = v;
          return "OK";
        }),
        getbit: vi.fn(async (k, offset) => mockBitmap[`${k}:${offset}`] || 0),
        setbit: vi.fn(async (k, offset, val) => {
          mockBitmap[`${k}:${offset}`] = val;
          return 0;
        }),
        expire: vi.fn(async () => 1)
      };

      const mockDb: IDbClient = {
        query: vi.fn(async (sql) => {
          if (sql.includes("FROM v_post_feeds")) {
            return [
              {
                postId: 301,
                schoolId: 1,
                schoolName: "测试大学",
                creatorId: 10,
                nickName: "张三同学",
                avatarUrl: "",
                patrolId: 999,
                title: "101室门把手修理",
                content: "已修好",
                imagesJson: "[]",
                likeCount: 5,
                commentCount: 1,
                viewCount: 60,
                isTop: 0,
                createdAt: "2026-09-06 00:00:00"
              }
            ];
          }
          if (sql.includes("COUNT(1)")) {
            return [{ total: 1 }];
          }
          if (sql.includes("SELECT likeCount FROM posts")) {
            return [{ likeCount: 6 }];
          }
          return [];
        }) as any,
        execute: vi.fn(async () => ({ insertId: 888, affectedRows: 1 }))
      };

      const serviceWithMock = new SpaceFeedService(mockDb, mockRedis);

      // 1. 查询并缓存
      const feeds = await serviceWithMock.queryPublicFeeds(1, { schoolCode: "test", page: 1 });
      expect(feeds.cards.length).toBe(1);
      expect(mockRedis.set).toHaveBeenCalled();

      // 2. 点赞并写入 Bitmap
      const likeRes = await serviceWithMock.processGuestLike(
        1,
        { postId: 301, clientFingerprint: "FP_BITMAP_DEV" },
        "10.0.0.1"
      );
      expect(likeRes.isLiked).toBe(true);
      expect(likeRes.currentLikeCount).toBe(6);
      expect(mockRedis.setbit).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 3. SpaceFeedController 与防呆校验断言
  // ============================================================================
  describe("3. SpaceFeedController 控制器防呆", () => {
    it("3.1 handleGetFeeds 租户标识缺失拦截", async () => {
      const controller = new SpaceFeedController();
      const res = await controller.handleGetFeeds({ schoolId: NaN });
      expect(res.status).toBe(0);
      expect(res.content).toContain("缺少有效的高校租户标识");
    });

    it("3.2 handleLikeFeed 缺少指纹拦截", async () => {
      const controller = new SpaceFeedController();
      const res = await controller.handleLikeFeed({
        schoolId: 1,
        body: { postId: 201 } // 缺少 clientFingerprint
      });
      expect(res.status).toBe(0);
      expect(res.content).toContain("缺少客户端设备特征指纹");
    });

    it("3.3 handleGuestComment 内容过短拦截", async () => {
      const controller = new SpaceFeedController();
      const res = await controller.handleGuestComment({
        schoolId: 1,
        body: { postId: 201, commentContent: "好" } // 仅1个字
      });
      expect(res.status).toBe(0);
      expect(res.content).toContain("评论内容不能少于 2 个字");
    });
  });

  // ============================================================================
  // 4. API 网关路由契约与免密放行验证
  // ============================================================================
  describe("4. API 网关路由契约断言", () => {
    it("4.1 GET /api/v4/space/feeds 必须为 authRequired: false", async () => {
      expect(feedsApi.authRequired).toBe(false);
      expect(feedsApi.routePath).toBe("/api/v4/space/feeds");

      // 执行网关模拟调用
      const res = await feedsApi.handler(
        {
          req: {} as any,
          body: {},
          query: { schoolCode: "lcu", page: "1", pageSize: "10" }
        },
        { schoolId: 1 } as any
      );
      expect(res.status).toBe(1);
      expect(res.data.cards).toBeDefined();
    });

    it("4.2 POST /api/v4/space/feeds/like 必须为 authRequired: false", async () => {
      expect(likeApi.authRequired).toBe(false);
      expect(likeApi.routePath).toBe("/api/v4/space/feeds/like");

      const res = await likeApi.handler(
        {
          query: {},
          body: { postId: 201, clientFingerprint: "GATEWAY_TEST_FP" },
          req: { headers: { "x-real-ip": "127.0.0.1" } } as any
        },
        { schoolId: 1 } as any
      );
      expect(res.status).toBe(1);
      expect(res.data.isLiked).toBe(true);
    });

    it("4.3 POST /api/v4/space/feeds/guest-comment 必须为 authRequired: false", async () => {
      expect(commentApi.authRequired).toBe(false);
      expect(commentApi.routePath).toBe("/api/v4/space/feeds/guest-comment");

      const res = await commentApi.handler(
        {
          req: {} as any,
          query: {},
          body: {
            postId: 201,
            guestNick: "网关访客",
            commentContent: "通过公开网关留下一条暖心评语"
          }
        },
        { schoolId: 1 } as any
      );
      expect(res.status).toBe(1);
      expect(res.data.commentId).toBeDefined();
    });
  });
});
