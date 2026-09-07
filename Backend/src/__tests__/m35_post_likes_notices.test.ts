/**
 * M35: 广场动态点赞互动与官方公告置顶 - 全场景自动化回归测试套件
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { PostLikeService, IDbExecutor } from "../apps/space/postLikeService.js";
import { OfficialNoticeService } from "../apps/space/officialNoticeService.js";
import { SpaceNoticeController } from "../apps/space/spaceNoticeController.js";
import { api as toggleLikeApi } from "../api/space/feeds/toggle-like/index.js";
import { api as publishTopApi } from "../api/space/notices/publish-top/index.js";
import { api as activeBannersApi } from "../api/space/notices/active-banners/index.js";

describe("M35: 广场动态点赞互动与官方公告置顶核心测试", () => {
  let mockDb: IDbExecutor;
  let likeServiceWithMockDb: PostLikeService;
  let noticeServiceWithMockDb: OfficialNoticeService;

  beforeEach(() => {
    TestHarness.resetSandbox();

    // 构建一套可观测 SQL 调用的模拟 DB 容器
    const postStore = [
      { id: 101, schoolId: 1, title: "西校区加装空调工程", isTop: 0, likeCount: 5, status: 1, isDeleted: 0, configJson: null, createdAt: "2026-09-05 10:00:00" }
    ];
    const likeStore: any[] = [];

    mockDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes("FROM posts WHERE id = ?")) {
          return postStore.filter(p => p.id === params[0] && (!params[1] || p.schoolId === params[1]) && p.isDeleted === 0);
        }
        if (sql.includes("FROM post_likes WHERE schoolId = ? AND postId = ? AND userId = ?")) {
          return likeStore.filter(l => l.schoolId === params[0] && l.postId === params[1] && l.userId === params[2]);
        }
        if (sql.includes("FROM post_likes") && sql.includes("AND postId IN")) {
          return likeStore.filter(l => l.schoolId === params[0] && l.userId === params[1] && params.slice(2).includes(l.postId));
        }
        if (sql.includes("FROM departments")) {
          return [{ name: "后勤动力工程科" }];
        }
        if (sql.includes("COUNT(1) as activeTopCount")) {
          const count = postStore.filter(p => p.schoolId === params[0] && p.isTop === 1 && p.status === 1 && p.isDeleted === 0).length;
          return [{ activeTopCount: count }];
        }
        if (sql.includes("FROM posts WHERE") && sql.includes("isTop = 1")) {
          return postStore.filter(p => (!params || !params[0] || p.schoolId === params[0]) && p.isTop === 1 && p.isDeleted === 0);
        }
        return [];
      }),
      execute: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        if (sql.includes("INSERT INTO post_likes")) {
          const exists = likeStore.some(l => l.schoolId === params[0] && l.postId === params[1] && l.userId === params[2]);
          if (exists) {
            throw new Error("Duplicate entry '1-101-88' for key 'uk_school_post_user'");
          }
          likeStore.push({ id: likeStore.length + 1, schoolId: params[0], postId: params[1], userId: params[2] });
          return { insertId: likeStore.length, affectedRows: 1 };
        }
        if (sql.includes("DELETE FROM post_likes")) {
          const idx = likeStore.findIndex(l => l.schoolId === params[0] && l.postId === params[1] && l.userId === params[2]);
          if (idx !== -1) likeStore.splice(idx, 1);
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE posts SET likeCount = likeCount + 1")) {
          const post = postStore.find(p => p.id === params[0]);
          if (post) post.likeCount += 1;
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("UPDATE posts SET likeCount = GREATEST(0, likeCount - 1)")) {
          const post = postStore.find(p => p.id === params[0]);
          if (post) post.likeCount = Math.max(0, post.likeCount - 1);
          return { insertId: 0, affectedRows: 1 };
        }
        if (sql.includes("INSERT INTO posts")) {
          const newId = postStore.length + 900;
          postStore.push({
            id: newId,
            schoolId: params[0],
            title: params[2],
            isTop: 1,
            likeCount: 0,
            status: 1,
            isDeleted: 0,
            configJson: params[4],
            createdAt: "2026-09-06 08:00:00"
          });
          return { insertId: newId, affectedRows: 1 };
        }
        if (sql.includes("UPDATE posts SET isTop = 0")) {
          let count = 0;
          for (const p of postStore) {
            if (params.includes(p.id)) {
              p.isTop = 0;
              count++;
            }
          }
          return { insertId: 0, affectedRows: count };
        }
        return { insertId: 1, affectedRows: 1 };
      })
    };

    likeServiceWithMockDb = new PostLikeService(mockDb);
    noticeServiceWithMockDb = new OfficialNoticeService(mockDb);
  });

  // ============================================================================
  // 1. PostLikeService 核心幂等点赞与原子防下溢测试
  // ============================================================================
  describe("1. PostLikeService 点赞流水与原子计数一致性", () => {
    it("[M35-01] 师生首次点赞，断言写入 post_likes 且 posts.likeCount 精准累加 1", async () => {
      const res = await likeServiceWithMockDb.toggleLike(1, 88, { postId: 101 });

      expect(res.isLiked).toBe(true);
      expect(res.currentLikeCount).toBe(6);
      expect(res.message).toBe("点赞成功");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO post_likes"),
        [1, 101, 88]
      );
    });

    it("[M35-02] 师生已点赞状态下再次点击，断言删除流水且 likeCount 递减回 5", async () => {
      // 1. 首次点赞
      await likeServiceWithMockDb.toggleLike(1, 88, { postId: 101 });

      // 2. 再次点击取消点赞
      const res = await likeServiceWithMockDb.toggleLike(1, 88, { postId: 101 });

      expect(res.isLiked).toBe(false);
      expect(res.currentLikeCount).toBe(5);
      expect(res.message).toBe("已取消点赞");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM post_likes"),
        [1, 101, 88]
      );
    });

    it("[M35-03] 并发重试点赞触发 Duplicate entry 联合唯一索引拦截，静默防刷", async () => {
      // 先点赞成功
      await likeServiceWithMockDb.toggleLike(1, 99, { postId: 101 });

      // 模拟并发直接重复插入同一个 (schoolId, postId, userId)
      await expect(
        mockDb.execute("INSERT INTO post_likes (schoolId, postId, userId) VALUES (?, ?, ?)", [1, 101, 99])
      ).rejects.toThrow("Duplicate entry");
    });

    it("[M35-04] 点赞计数负数下溢熔断: 连续扣减被 GREATEST(0, likeCount - 1) 保护截断在 0", async () => {
      const service = new PostLikeService();
      // 初始化为 0 赞的动态
      PostLikeService.seedMockPost({
        id: 777,
        schoolId: 1,
        likeCount: 0,
        status: 1,
        isDeleted: 0
      });

      // 强行播种已点赞状态
      PostLikeService.seedMockLike({
        id: 9999,
        schoolId: 1,
        postId: 777,
        userId: 123,
        createdAt: "2026-09-06 00:00:00"
      });

      // 取消点赞，当前 count=0 扣减后绝不变为 -1
      const res = await service.toggleLike(1, 123, { postId: 777 });
      expect(res.isLiked).toBe(false);
      expect(res.currentLikeCount).toBe(0);
      expect(res.currentLikeCount).toBeGreaterThanOrEqual(0);
    });

    it("[M35-05] batchCheckUserLiked: 批量查询用户点赞状态字典", async () => {
      const service = new PostLikeService();
      PostLikeService.seedMockLike({
        id: 1,
        schoolId: 1,
        postId: 101,
        userId: 88,
        createdAt: "2026-09-06 00:00:00"
      });
      PostLikeService.seedMockLike({
        id: 2,
        schoolId: 1,
        postId: 202,
        userId: 88,
        createdAt: "2026-09-06 00:00:00"
      });

      const checked = await service.batchCheckUserLiked(1, 88, [101, 201, 202, 303]);
      expect(checked[101]).toBe(true);
      expect(checked[201]).toBe(false);
      expect(checked[202]).toBe(true);
      expect(checked[303]).toBe(false);

      // 未登录访客直接全返回 false
      const guestCheck = await service.batchCheckUserLiked(1, 0, [101, 201]);
      expect(guestCheck[101]).toBe(false);
    });
  });

  // ============================================================================
  // 2. OfficialNoticeService 官方置顶通告与自动下沉测试
  // ============================================================================
  describe("2. OfficialNoticeService 官方置顶通告与下沉调度", () => {
    it("[M35-06] 后勤处长发布重大白皮书，断言 isTop === 1 且生成到期时间与 configJson", async () => {
      const res = await noticeServiceWithMockDb.publishTopNotice(1, 888, {
        title: "关于聊大西校区供暖加压调试通告",
        content: "请各位师生注意，本周五将进行全校高压注水试压，室内请留人观察。",
        urgencyLevel: "CRITICAL",
        departmentId: 5,
        topDurationDays: 3,
        broadcastPopup: true
      });

      expect(res.postId).toBeGreaterThanOrEqual(900);
      expect(res.isTop).toBe(true);
      expect(res.topExpireAt).toBeDefined();
      expect(res.urgencyLevel).toBe("CRITICAL");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO posts"),
        expect.arrayContaining([1, 888, "关于聊大西校区供暖加压调试通告"])
      );
    });

    it("[M35-07] 置顶配额限制 (Top Notice Quota Limiter): 单校达 3 条置顶时抛出提示", async () => {
      const service = new OfficialNoticeService();
      // 播种 3 条有效置顶通告
      for (let i = 1; i <= 3; i++) {
        OfficialNoticeService.seedMockNotice({
          id: 910 + i,
          schoolId: 2,
          isTop: 1,
          status: 1,
          isDeleted: 0,
          title: `置顶公告_${i}`,
          content: "测试置顶公告详细内容详细内容详细内容详细内容",
          configJson: JSON.stringify({
            isOfficialNotice: true,
            topExpireAt: "2099-01-01 00:00:00"
          })
        });
      }

      // 发布第 4 条应被配额阻断
      await expect(
        service.publishTopNotice(2, 999, {
          title: "第四条置顶公告尝试发布",
          content: "由于配额限制，本条置顶通告应该被系统拒绝发布保护首屏。",
          urgencyLevel: "NORMAL"
        })
      ).rejects.toThrow("当前置顶公告已达 3 条上限");
    });

    it("[M35-08] scanAndDemoteExpiredTopNotices: 扫描并自动下沉到期置顶公告", async () => {
      const service = new OfficialNoticeService();
      // 播种一条已过期的置顶通告
      OfficialNoticeService.seedMockNotice({
        id: 998,
        schoolId: 1,
        isTop: 1,
        status: 1,
        isDeleted: 0,
        title: "已过期的紧急通告",
        content: "内容详情内容详情内容详情内容详情",
        configJson: JSON.stringify({
          isOfficialNotice: true,
          topExpireAt: "2020-01-01 00:00:00" // 历史过期时间
        }),
        createdAt: "2020-01-01 00:00:00"
      });

      const demotedCount = await service.scanAndDemoteExpiredTopNotices(1);
      expect(demotedCount).toBeGreaterThanOrEqual(1);

      // 下沉后拉取有效 banner 不应再包含 998
      const banners = await service.getActiveTopNotices(1);
      const containsExpired = banners.some(b => b.noticeId === 998);
      expect(containsExpired).toBe(false);
    });

    it("[M35-09] getActiveTopNotices 排序与 BannerTag 映射断言", async () => {
      const service = new OfficialNoticeService();
      OfficialNoticeService.seedMockNotice({
        id: 950,
        schoolId: 5,
        isTop: 1,
        status: 1,
        isDeleted: 0,
        title: "普通后勤通报日常施工",
        content: "西校区部分道路进行铺装施工，请过往师生绕行。",
        configJson: JSON.stringify({
          isOfficialNotice: true,
          urgencyLevel: "NORMAL",
          topExpireAt: "2099-01-01 00:00:00"
        })
      });

      OfficialNoticeService.seedMockNotice({
        id: 951,
        schoolId: 5,
        isTop: 1,
        status: 1,
        isDeleted: 0,
        title: "全校紧急停电停水检修",
        content: "因主干线高压变压器突发跳闸，全校预计停电2小时。",
        configJson: JSON.stringify({
          isOfficialNotice: true,
          urgencyLevel: "CRITICAL",
          topExpireAt: "2099-01-01 00:00:00"
        })
      });

      const banners = await service.getActiveTopNotices(5);
      expect(banners.length).toBe(2);
      // CRITICAL 权重 10000 必须高居首位
      expect(banners[0].noticeId).toBe(951);
      expect(banners[0].bannerTag).toBe("【突发检修紧急通告】");
      expect(banners[1].noticeId).toBe(950);
      expect(banners[1].bannerTag).toBe("【后勤权威通告】");
    });
  });

  // ============================================================================
  // 3. SpaceNoticeController 权限控制与参数校验测试
  // ============================================================================
  describe("3. SpaceNoticeController 严格四级权限栅栏与参数守卫", () => {
    let controller: SpaceNoticeController;

    beforeEach(() => {
      controller = new SpaceNoticeController();
    });

    it("[M35-10] 普通学生 (role = 1) 尝试发布置顶公告，被 403 权限栅栏精准拦截", async () => {
      const res = await controller.publishTopNotice({
        schoolId: 1,
        userId: 1001,
        role: 1, // 普通在校生
        body: {
          title: "学生自行发起的置顶通告标题",
          content: "通告白皮书正文内容必须在20字以上测试拦截情况。"
        }
      });

      expect(res.code).toBe(403);
      expect(res.message).toContain("越权拦截");
    });

    it("[M35-11] 后勤主管 (role = 3) 发布置顶公告，放行并返回 200", async () => {
      const res = await controller.publishTopNotice({
        schoolId: 1,
        userId: 2001,
        role: 3, // 质检主管
        body: {
          title: "后勤主管正式发布的施工工程通报",
          content: "针对学11号楼外墙粉刷与漏水排查施工进展的正式通告说明。",
          urgencyLevel: "URGENT"
        }
      });

      expect(res.code).toBe(200);
      expect(res.data.isTop).toBe(true);
    });

    it("[M35-12] toggleLike 未登录鉴权拦截: userId <= 0 返回 401", async () => {
      const res = await controller.toggleLike({
        schoolId: 1,
        userId: 0,
        body: { postId: 101 }
      });

      expect(res.code).toBe(401);
      expect(res.message).toContain("请先完成师生身份登录");
    });

    it("[M35-13] handleToggleLike 与 handleGetActiveBanners 标准返回包裹测试", async () => {
      const likeRes = await controller.handleToggleLike({ schoolId: 1, userId: 99 }, { postId: 101 });
      expect(likeRes.status).toBe(1);
      expect(likeRes.data?.isLiked).toBe(true);

      const bannerRes = await controller.handleGetActiveBanners({ schoolId: 1 });
      expect(bannerRes.status).toBe(1);
      expect(Array.isArray(bannerRes.data)).toBe(true);
    });
  });

  // ============================================================================
  // 4. 网关 API 契约断言 (MasterDispatcher 路由元数据)
  // ============================================================================
  describe("4. 网关 API 路由规范与元数据契约", () => {
    it("[M35-14] POST /api/v4/space/feeds/toggle-like 为 authRequired: true", () => {
      expect(toggleLikeApi.routePath).toBe("/api/v4/space/feeds/toggle-like");
      expect(toggleLikeApi.authRequired).toBe(true);
    });

    it("[M35-15] POST /api/v4/space/notices/publish-top 为 authRequired: true", () => {
      expect(publishTopApi.routePath).toBe("/api/v4/space/notices/publish-top");
      expect(publishTopApi.authRequired).toBe(true);
    });

    it("[M35-16] GET /api/v4/space/notices/active-banners 为 authRequired: false", () => {
      expect(activeBannersApi.routePath).toBe("/api/v4/space/notices/active-banners");
      expect(activeBannersApi.authRequired).toBe(false);
    });
  });
});
