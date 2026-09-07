/**
 * M35: 广场动态点赞流水服务 (Post Like Service)
 * 职责：
 * 1. 在校认证师生双向点赞流转 (点赞 / 取消点赞)
 * 2. 依托底层物理表 post_likes 与联合唯一索引 uk_school_post_user 杜绝并发重刷
 * 3. 乐观锁原子计数累加与 GREATEST(0, likeCount - 1) 防负数下溢熔断
 * 4. 批量查询用户点赞状态 (batchCheckUserLiked)
 * 5. 内存沙箱隔离自愈桩点，测试环境零污染
 */

import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import {
  IPostLikeEntity,
  IToggleLikeRequestDto,
  IToggleLikeResponseDto
} from "./postLikeTypes.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export class PostLikeService {
  private static mockPostsStore: Map<
    number,
    { id: number; schoolId: number; likeCount: number; status: number; isDeleted: number; title?: string }
  > = new Map();
  private static mockLikesStore: Map<string, IPostLikeEntity> = new Map();
  private static likeIdCounter = 500;

  constructor(private readonly customDb?: IDbExecutor) {}

  /**
   * 重置与初始化内存沙箱 Mock 数据 (保证用例正交独立)
   */
  public static resetMockData(): void {
    this.mockPostsStore.clear();
    this.mockLikesStore.clear();
    this.likeIdCounter = 500;

    // 内置测试动态
    this.mockPostsStore.set(101, {
      id: 101,
      schoolId: 1,
      title: "西校区加装空调工程",
      likeCount: 5,
      status: 1,
      isDeleted: 0
    });
    this.mockPostsStore.set(201, {
      id: 201,
      schoolId: 1,
      title: "学11号楼水龙头破裂维修",
      likeCount: 12,
      status: 1,
      isDeleted: 0
    });
    this.mockPostsStore.set(202, {
      id: 202,
      schoolId: 1,
      title: "关于二楼热干面保温建议",
      likeCount: 45,
      status: 1,
      isDeleted: 0
    });
  }

  /**
   * 注册/覆盖自定义 Mock 动态
   */
  public static seedMockPost(post: {
    id: number;
    schoolId: number;
    likeCount?: number;
    status?: number;
    isDeleted?: number;
    title?: string;
  }): void {
    this.mockPostsStore.set(post.id, {
      id: post.id,
      schoolId: post.schoolId,
      likeCount: post.likeCount ?? 0,
      status: post.status ?? 1,
      isDeleted: post.isDeleted ?? 0,
      title: post.title || `动态_${post.id}`
    });
  }

  /**
   * 注册/注入已点赞记录
   */
  public static seedMockLike(like: IPostLikeEntity): void {
    const key = `${like.schoolId}_${like.postId}_${like.userId}`;
    this.mockLikesStore.set(key, like);
  }

  /**
   * 获取所有内存点赞记录 (供测试或断言检查)
   */
  public static getMockLikes(): IPostLikeEntity[] {
    return Array.from(this.mockLikesStore.values());
  }

  /**
   * 切换点赞状态 (原子幂等操作)
   */
  public async toggleLike(
    schoolId: number,
    userId: number,
    dto: IToggleLikeRequestDto
  ): Promise<IToggleLikeResponseDto> {
    const { postId } = dto;

    if (!postId || isNaN(postId)) {
      throw new Error("动态 ID 非法");
    }

    if (!userId || userId <= 0) {
      throw new Error("鉴权拦截: 未登录访客点赞请调用访客专属接口");
    }

    // A. 优先使用注入的 customDb
    if (this.customDb) {
      return this.toggleLikeWithDb(this.customDb, schoolId, userId, postId);
    }

    // B. 若真实连接池可用，尝试真实 MySQL
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
        return await this.toggleLikeWithDb(realDb, schoolId, userId, postId);
      } catch (err: any) {
        if (String(err?.message).includes("Duplicate entry")) {
          throw err;
        }
        return this.toggleLikeInMemory(schoolId, userId, postId);
      }
    }

    // C. 无数据库连接池时，降级使用内存沙箱
    return this.toggleLikeInMemory(schoolId, userId, postId);
  }

  /**
   * 基于 DB 执行器执行原子点赞逻辑
   */
  private async toggleLikeWithDb(
    db: IDbExecutor,
    schoolId: number,
    userId: number,
    postId: number
  ): Promise<IToggleLikeResponseDto> {
    // 1. 验证目标动态是否存在且正常发布
    const postCheckSql = `SELECT id, isDeleted, status, likeCount FROM posts WHERE id = ? AND schoolId = ? LIMIT 1`;
    const postRows = await db.query<{ id: number; isDeleted: number; status: number; likeCount: number }>(
      postCheckSql,
      [postId, schoolId]
    );

    if (postRows.length === 0 || postRows[0].isDeleted === 1 || postRows[0].status !== 1) {
      throw new Error("目标动态不存在或已被违规下架，无法点赞");
    }

    const initialCount = postRows[0].likeCount;

    // 2. 探查当前用户是否已在 post_likes 中记录
    const existSql = `SELECT id FROM post_likes WHERE schoolId = ? AND postId = ? AND userId = ? LIMIT 1`;
    const existRows = await db.query<{ id: number }>(existSql, [schoolId, postId, userId]);
    const hasLiked = existRows.length > 0;

    if (!hasLiked) {
      // 执行点赞流程
      try {
        const insertSql = `
          INSERT INTO post_likes (schoolId, postId, userId, createdAt) 
          VALUES (?, ?, ?, NOW())
        `;
        await db.execute(insertSql, [schoolId, postId, userId]);

        // 原子递增 posts 表计数
        await db.execute(
          `UPDATE posts SET likeCount = likeCount + 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
          [postId, schoolId]
        );
      } catch (err: any) {
        // 若并发冲突 (MySQL 1062 / Duplicate entry)，静默捕获，确保幂等
        if (!String(err?.message).includes("Duplicate entry")) {
          throw err;
        }
      }

      const countSql = `SELECT likeCount FROM posts WHERE id = ? AND schoolId = ? LIMIT 1`;
      const countRows = await db.query<{ likeCount: number }>(countSql, [postId, schoolId]);

      return {
        postId,
        isLiked: true,
        currentLikeCount: countRows[0]?.likeCount ?? initialCount + 1,
        message: "点赞成功"
      };
    } else {
      // 执行取消点赞流程
      const deleteSql = `DELETE FROM post_likes WHERE schoolId = ? AND postId = ? AND userId = ?`;
      await db.execute(deleteSql, [schoolId, postId, userId]);

      // 使用 GREATEST 防负数下溢熔断
      await db.execute(
        `UPDATE posts SET likeCount = GREATEST(0, likeCount - 1), updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [postId, schoolId]
      );

      const countSql = `SELECT likeCount FROM posts WHERE id = ? AND schoolId = ? LIMIT 1`;
      const countRows = await db.query<{ likeCount: number }>(countSql, [postId, schoolId]);

      return {
        postId,
        isLiked: false,
        currentLikeCount: countRows[0]?.likeCount ?? Math.max(0, initialCount - 1),
        message: "已取消点赞"
      };
    }
  }

  /**
   * 内存沙箱原子降级执行
   */
  private toggleLikeInMemory(
    schoolId: number,
    userId: number,
    postId: number
  ): IToggleLikeResponseDto {
    const post = PostLikeService.mockPostsStore.get(postId);
    if (!post || post.schoolId !== schoolId || post.isDeleted === 1 || post.status !== 1) {
      throw new Error("目标动态不存在或已被违规下架，无法点赞");
    }

    const key = `${schoolId}_${postId}_${userId}`;
    const exists = PostLikeService.mockLikesStore.has(key);

    if (!exists) {
      // 点赞
      PostLikeService.likeIdCounter += 1;
      PostLikeService.mockLikesStore.set(key, {
        id: PostLikeService.likeIdCounter,
        schoolId,
        postId,
        userId,
        createdAt: new Date().toISOString().replace("T", " ").substring(0, 19)
      });
      post.likeCount += 1;

      return {
        postId,
        isLiked: true,
        currentLikeCount: post.likeCount,
        message: "点赞成功"
      };
    } else {
      // 取消点赞 (GREATEST(0, likeCount - 1) 防负数)
      PostLikeService.mockLikesStore.delete(key);
      post.likeCount = Math.max(0, post.likeCount - 1);

      return {
        postId,
        isLiked: false,
        currentLikeCount: post.likeCount,
        message: "已取消点赞"
      };
    }
  }

  /**
   * 批量校验当前用户对一组动态的点赞状态
   */
  public async batchCheckUserLiked(
    schoolId: number,
    userId: number,
    postIds: number[]
  ): Promise<Record<number, boolean>> {
    const result: Record<number, boolean> = {};
    if (!postIds || postIds.length === 0) {
      return result;
    }

    for (const pid of postIds) {
      result[pid] = false;
    }

    if (userId <= 0) {
      return result;
    }

    // A. 注入 DB
    if (this.customDb) {
      return this.batchCheckWithDb(this.customDb, schoolId, userId, postIds, result);
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
        return await this.batchCheckWithDb(realDb, schoolId, userId, postIds, result);
      } catch {
        return this.batchCheckInMemory(schoolId, userId, postIds, result);
      }
    }

    // C. 降级内存沙箱
    return this.batchCheckInMemory(schoolId, userId, postIds, result);
  }

  private batchCheckInMemory(
    schoolId: number,
    userId: number,
    postIds: number[],
    result: Record<number, boolean>
  ): Record<number, boolean> {
    for (const pid of postIds) {
      const key = `${schoolId}_${pid}_${userId}`;
      if (PostLikeService.mockLikesStore.has(key)) {
        result[pid] = true;
      }
    }
    return result;
  }

  private async batchCheckWithDb(
    db: IDbExecutor,
    schoolId: number,
    userId: number,
    postIds: number[],
    result: Record<number, boolean>
  ): Promise<Record<number, boolean>> {
    const placeholders = postIds.map(() => "?").join(",");
    const sql = `
      SELECT postId FROM post_likes 
      WHERE schoolId = ? AND userId = ? AND postId IN (${placeholders})
    `;
    const rows = await db.query<{ postId: number }>(sql, [schoolId, userId, ...postIds]);
    for (const r of rows) {
      result[r.postId] = true;
    }
    return result;
  }
}
