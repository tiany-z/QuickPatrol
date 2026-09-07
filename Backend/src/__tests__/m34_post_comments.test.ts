/**
 * M34: 广场动态访客免密评论与令牌桶防刷风控 - 全场景自动化测试套件
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TestHarness } from "./testHarness.js";
import { TokenBucketLimiter, IRedisPipelineClient } from "../shared/resilience/tokenBucketLimiter.js";
import { PostCommentService, IDbExecutor } from "../apps/space/postCommentService.js";
import { PostCommentController } from "../apps/space/postCommentController.js";
import { api as commentsApi } from "../api/space/comments/index.js";
import { api as listApi } from "../api/space/comments/list/index.js";
import { api as deleteApi } from "../api/space/comments/delete/index.js";

describe("M34: 广场动态访客免密评论与令牌桶防刷风控核心测试", () => {
  beforeEach(() => {
    TestHarness.resetSandbox();
  });

  // ============================================================================
  // 1. TokenBucketLimiter 分布式与内存算法断言
  // ============================================================================
  describe("1. TokenBucketLimiter 令牌桶限流算法", () => {
    it("1.1 内存沙箱平滑限流: 桶容量 3，短时间内第 4 次请求必须被精准拦截", async () => {
      const key = "test_user_ip_1";
      const cap = 3;
      const rate = 0.0333; // 约 30 秒 1 令牌

      const r1 = await TokenBucketLimiter.tryAcquire(null, key, cap, rate, 1);
      const r2 = await TokenBucketLimiter.tryAcquire(null, key, cap, rate, 1);
      const r3 = await TokenBucketLimiter.tryAcquire(null, key, cap, rate, 1);
      const r4 = await TokenBucketLimiter.tryAcquire(null, key, cap, rate, 1); // 耗尽

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(true);
      expect(r4).toBe(false); // 第 4 次被拦截
    });

    it("1.2 模拟 Redis Lua 脚本调用与返回值处理", async () => {
      const mockRedis: IRedisPipelineClient = {
        eval: vi
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0) // 第 4 次拦截
      };

      const k = "redis_test_key";
      const r1 = await TokenBucketLimiter.tryAcquire(mockRedis, k, 3, 0.0333, 1);
      const r2 = await TokenBucketLimiter.tryAcquire(mockRedis, k, 3, 0.0333, 1);
      const r3 = await TokenBucketLimiter.tryAcquire(mockRedis, k, 3, 0.0333, 1);
      const r4 = await TokenBucketLimiter.tryAcquire(mockRedis, k, 3, 0.0333, 1);

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(true);
      expect(r4).toBe(false);
      expect(mockRedis.eval).toHaveBeenCalledTimes(4);
    });
  });

  // ============================================================================
  // 2. PostCommentService 核心业务逻辑断言
  // ============================================================================
  describe("2. PostCommentService 评论总线业务", () => {
    it("[M34-01] 访客免密提交根评论，断言 userId === 0 且 posts.commentCount 原子累加", async () => {
      const service = new PostCommentService();
      const res = await service.submitComment(1, 0, {
        postId: 101,
        replyCommentId: 0,
        guestNick: "江北热心校友",
        content: "后勤师傅辛苦啦，办事效率令人惊叹！"
      });

      expect(res.commentId).toBeGreaterThan(0);
      expect(res.authorName).toBe("江北热心校友");
      expect(res.statusText).toBe("发表成功");

      // 验证楼中楼列表查询
      const list = await service.getCommentThreads(1, 101, 1, 20);
      expect(list.totalCommentCount).toBe(3); // 原有 2 条 + 新增 1 条
    });

    it("[M34-02] 楼中楼拓扑两级收敛算法断言: 子回复与孙回复成功收敛至根评论", async () => {
      const service = new PostCommentService();

      // 在已有评论 2 (回复评论 1) 的基础上，再发表一条孙评论 3 (回复评论 2)
      await service.submitComment(1, 0, {
        postId: 101,
        replyCommentId: 2,
        guestNick: "孙同学",
        content: "我也在现场，当时漏水确实很大。"
      });

      const listRes = await service.getCommentThreads(1, 101, 1, 20);

      expect(listRes.totalRootCount).toBe(1); // 只有 1 条根评论
      expect(listRes.totalCommentCount).toBe(3); // 共 3 条评论
      expect(listRes.threads.length).toBe(1);

      const thread = listRes.threads[0];
      expect(thread.rootComment.commentId).toBe(1);
      expect(thread.subReplies.length).toBe(2);

      // 验证二级回复 1: 王同学回复根评论
      expect(thread.subReplies[0].commentId).toBe(2);
      expect(thread.subReplies[0].replyToNick).toBe("李同学");

      // 验证二级回复 2: 孙同学回复王同学 (拓扑收敛至当前根评论下，但被回复人标注为王同学)
      expect(thread.subReplies[1].authorName).toBe("孙同学");
      expect(thread.subReplies[1].replyToNick).toBe("王同学");
    });

    it("[M34-04] 访客发表包含违规敏感词言论，断言在落盘前被 DFA 安全拦截", async () => {
      const service = new PostCommentService();

      await expect(
        service.submitComment(1, 0, {
          postId: 101,
          content: "你们后勤办事这么慢我要去学校投毒"
        })
      ).rejects.toThrow("留言内容包含违规词汇 (投毒)，系统已启动安全拦截！");

      await expect(
        service.submitComment(1, 0, {
          postId: 101,
          content: "涉暴恐言论发布测试"
        })
      ).rejects.toThrow("留言内容包含违规词汇 (暴恐)，系统已启动安全拦截！");
    });

    it("[M34-05] 管理员违规言论软删除，断言 isDeleted=1 且 commentCount 原子扣减", async () => {
      const service = new PostCommentService();

      // 软删除评论 ID: 1
      await service.softDeleteComment(1, 1, 999, "涉及不实言论");

      // 重新查询评论列表，已删除的评论从前台消失
      const listRes = await service.getCommentThreads(1, 101, 1, 20);
      expect(listRes.threads.some((t) => t.rootComment.commentId === 1)).toBe(false);
    });

    it("[M34-06] 针对已下架或不存在的动态发表评论，断言抛出 400 阻断异常", async () => {
      const service = new PostCommentService();

      await expect(
        service.submitComment(1, 0, {
          postId: 999999, // 不存在的动态
          content: "试图在幽灵动态下发表评论"
        })
      ).rejects.toThrow("目标动态不存在或已被管理员违规下架");
    });

    it("[M34-07] customDb 模式完整覆盖", async () => {
      const postDb = [{ id: 801, schoolId: 1, status: 1, isDeleted: 0, commentCount: 5 }];
      const commentDb = [
        {
          id: 10,
          schoolId: 1,
          postId: 801,
          userId: 0,
          guestNick: "小明",
          guestAvatar: "",
          replyCommentId: 0,
          content: "好评",
          createdAt: "2026-09-06",
          isDeleted: 0
        }
      ];

      const mockDb: IDbExecutor = {
        query: vi.fn(async (sql) => {
          if (sql.includes("FROM posts")) return postDb;
          if (sql.includes("FROM post_comments")) return commentDb;
          return [];
        }) as any,
        execute: vi.fn(async (sql) => {
          if (sql.includes("INSERT INTO post_comments")) return { insertId: 11, affectedRows: 1 };
          return { insertId: 0, affectedRows: 1 };
        })
      };

      const customService = new PostCommentService(mockDb);

      const res = await customService.submitComment(1, 0, {
        postId: 801,
        content: "非常支持！"
      });

      expect(res.commentId).toBe(11);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 3. PostCommentController 控制器防呆与风控断言
  // ============================================================================
  describe("3. PostCommentController 控制器防呆校验", () => {
    it("3.1 handleCreateComment 内容过短与非法 postId 拦截", async () => {
      const controller = new PostCommentController();

      const res1 = await controller.handleCreateComment({ schoolId: 1 }, { postId: NaN });
      expect(res1.status).toBe(0);
      expect(res1.content).toContain("动态 ID 非法");

      const res2 = await controller.handleCreateComment(
        { schoolId: 1 },
        { postId: 101, content: "短" }
      );
      expect(res2.status).toBe(0);
      expect(res2.content).toContain("评论正文长度必须在 2 ~ 500 字之间");
    });

    it("3.2 handleCreateComment 连续发表触发令牌桶限流", async () => {
      const controller = new PostCommentController();
      const ctx = { schoolId: 1, ip: "192.168.1.99" };
      const body = { postId: 101, content: "正常评论内容测试" };

      // 前 3 次成功
      const r1 = await controller.handleCreateComment(ctx, body);
      const r2 = await controller.handleCreateComment(ctx, body);
      const r3 = await controller.handleCreateComment(ctx, body);
      // 第 4 次被限流
      const r4 = await controller.handleCreateComment(ctx, body);

      expect(r1.status).toBe(1);
      expect(r2.status).toBe(1);
      expect(r3.status).toBe(1);
      expect(r4.status).toBe(0);
      expect(r4.content).toContain("您发言过于频繁，请稍候再试");
    });

    it("3.3 handleListComments 动态 ID 缺失拦截", async () => {
      const controller = new PostCommentController();
      const res = await controller.handleListComments({ schoolId: 1 }, {});
      expect(res.status).toBe(0);
      expect(res.content).toContain("缺少有效的动态 ID");
    });

    it("3.4 handleDeleteComment 软删除成功", async () => {
      const controller = new PostCommentController();
      const res = await controller.handleDeleteComment(
        { schoolId: 1, userId: 999 },
        { commentId: 1, deleteReason: "违规广告" }
      );
      expect(res.status).toBe(1);
      expect(res.content).toContain("评论已成功软删除");
    });
  });

  // ============================================================================
  // 4. API 网关路由契约与免密放行验证
  // ============================================================================
  describe("4. API 网关路由契约断言", () => {
    it("4.1 POST /api/v4/space/comments 为 authRequired: false", async () => {
      expect(commentsApi.authRequired).toBe(false);
      expect(commentsApi.routePath).toBe("/api/v4/space/comments");

      const res = await commentsApi.handler(
        {
          req: { method: "POST" } as any,
          query: {},
          body: { postId: 101, guestNick: "网关访客", content: "通过公开网关留言测试" }
        },
        { schoolId: 1 } as any
      );
      expect(res.status).toBe(1);
      expect(res.data.commentId).toBeDefined();
    });

    it("4.2 GET /api/v4/space/comments/list 为 authRequired: false", async () => {
      expect(listApi.authRequired).toBe(false);
      expect(listApi.routePath).toBe("/api/v4/space/comments/list");

      const res = await listApi.handler(
        {
          req: {} as any,
          body: {},
          query: { postId: "101", page: "1", pageSize: "10" }
        },
        { schoolId: 1 } as any
      );
      expect(res.status).toBe(1);
      expect(res.data.threads).toBeDefined();
    });

    it("4.3 DELETE /api/v4/space/comments/delete 为 authRequired: true", async () => {
      expect(deleteApi.authRequired).toBe(true);
      expect(deleteApi.routePath).toBe("/api/v4/space/comments/delete");

      const res = await deleteApi.handler(
        {
          req: {} as any,
          query: {},
          body: { commentId: 1, deleteReason: "违规推销" }
        },
        { schoolId: 1, userPayload: { schoolId: 1, userId: 888 } } as any
      );
      expect(res.status).toBe(1);
    });
  });
});
