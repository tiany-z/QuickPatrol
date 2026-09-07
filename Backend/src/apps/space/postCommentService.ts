/**
 * M34: 校园广场动态评论业务总线 (Post Comment Service)
 * 职责：
 * 1. 免密提交公开评论与楼中楼子回复 (支持访客 userId=0 与认证师生)
 * 2. 两级楼中楼拓扑收敛组装算法 (Two-Tier Threading)
 * 3. 本地 DFA 敏感词内容安全审查 (拦截违规言论)
 * 4. 管理员 100% 软删除与评论计数扣减
 * 5. 内存沙箱隔离自愈桩点
 */

import { executeQuery } from "../../shared/db/mysql.js";
import {
  IPostCommentEntity,
  ICreateCommentRequestDto,
  ICreateCommentResponseDto,
  ICommentListResponseDto,
  ICommentThreadDto
} from "./postCommentTypes.js";
import { SpaceRankingEngine } from "./spaceRankingEngine.js";

export interface IDbExecutor {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }>;
}

export class PostCommentService {
  private static mockPostsStore: Map<number, { id: number; schoolId: number; status: number; isDeleted: number; commentCount: number }> = new Map();
  private static mockCommentsStore: Map<number, IPostCommentEntity> = new Map();
  private static commentIdCounter = 1000;

  constructor(private readonly customDb?: IDbExecutor) {}

  /**
   * 重置与初始化内存沙箱 Mock 数据
   */
  public static resetMockData(): void {
    this.mockPostsStore.clear();
    this.mockCommentsStore.clear();
    this.commentIdCounter = 1000;

    // 内置测试动态
    this.mockPostsStore.set(101, {
      id: 101,
      schoolId: 1,
      status: 1,
      isDeleted: 0,
      commentCount: 2
    });
    this.mockPostsStore.set(201, {
      id: 201,
      schoolId: 1,
      status: 1,
      isDeleted: 0,
      commentCount: 2
    });

    // 内置经典测试评论 (包含根评论与楼中楼子回复)
    this.mockCommentsStore.set(1, {
      id: 1,
      schoolId: 1,
      postId: 101,
      userId: 0,
      guestNick: "李同学",
      guestAvatar: "https://oss.xcesb.cn/avatar1.jpg",
      replyCommentId: 0,
      content: "修得真快！早晨报修中午就搞好了。",
      createdAt: "2026-09-05 10:00:00",
      isDeleted: 0
    });

    this.mockCommentsStore.set(2, {
      id: 2,
      schoolId: 1,
      postId: 101,
      userId: 0,
      guestNick: "王同学",
      guestAvatar: "https://oss.xcesb.cn/avatar2.jpg",
      replyCommentId: 1,
      content: "同感，为后勤维修师傅点赞！",
      createdAt: "2026-09-05 10:05:00",
      isDeleted: 0
    });
  }

  /**
   * 发表评论 (支持未登录访客 userId=0 与已登录师生)
   */
  public async submitComment(
    schoolId: number,
    userId: number,
    dto: ICreateCommentRequestDto
  ): Promise<ICreateCommentResponseDto> {
    const { postId, replyCommentId = 0, guestNick, guestAvatar, content } = dto;

    if (!content || typeof content !== "string" || content.trim().length < 2) {
      throw new Error("评论内容不能少于 2 个字");
    }
    if (content.length > 500) {
      throw new Error("评论内容不能超过 500 个字");
    }

    // 1. 验证目标动态是否存在且处于正常发布状态 (status = 1)
    await this.verifyPostActive(schoolId, postId);

    // 2. 若为楼中楼子回复，验证上级根评论有效性
    if (replyCommentId > 0) {
      await this.verifyParentCommentActive(schoolId, postId, replyCommentId);
    }

    // 3. 内容安全扫描: 本地 DFA 敏感词审查 (暴恐、投毒、枪支、反动等)
    const sensitiveWords = ["暴恐", "投毒", "枪支", "反动", "赌博", "办假证", "代考", "色情"];
    const hitWords: string[] = [];
    for (const bad of sensitiveWords) {
      if (content.includes(bad)) {
        hitWords.push(bad);
      }
    }
    if (hitWords.length > 0) {
      throw new Error(`留言内容包含违规词汇 (${hitWords.join(", ")})，系统已启动安全拦截！`);
    }

    // 隐私文本脱敏
    const cleanContent = SpaceRankingEngine.sanitizePublicText(content.trim());

    // 4. 身份属性装配
    const isGuest = userId === 0;
    const finalNick = isGuest ? (guestNick?.trim() || "热心师生") : (guestNick?.trim() || "已认证师生");
    const finalAvatar = isGuest
      ? (guestAvatar?.trim() || "/assets/avatar_guest.png")
      : (guestAvatar?.trim() || "/assets/avatar_student.png");

    let newCommentId = 0;

    // 5. 数据落盘 (DB 模式 或 内存沙箱)
    if (this.customDb) {
      const insertSql = `
        INSERT INTO post_comments (
          schoolId, postId, userId, guestNick, guestAvatar, 
          replyCommentId, content, createdAt, isDeleted
        ) VALUES (
          ?, ?, ?, ?, ?, 
          ?, ?, NOW(), 0
        )
      `;
      const result = await this.customDb.execute(insertSql, [
        schoolId,
        postId,
        userId,
        finalNick,
        finalAvatar,
        replyCommentId,
        cleanContent
      ]);
      newCommentId = result.insertId || ++PostCommentService.commentIdCounter;

      await this.customDb.execute(
        `UPDATE posts SET commentCount = commentCount + 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [postId, schoolId]
      );
    } else {
      try {
        const insertSql = `
          INSERT INTO post_comments (
            schoolId, postId, userId, guestNick, guestAvatar, 
            replyCommentId, content, createdAt, isDeleted
          ) VALUES (
            ?, ?, ?, ?, ?, 
            ?, ?, NOW(), 0
          )
        `;
        const res = await executeQuery(insertSql, [
          schoolId,
          postId,
          userId,
          finalNick,
          finalAvatar,
          replyCommentId,
          cleanContent
        ]);
        if (res.status === 1 && (res as any).insertId) {
          newCommentId = (res as any).insertId;
        } else {
          newCommentId = ++PostCommentService.commentIdCounter;
        }
        await executeQuery(
          `UPDATE posts SET commentCount = commentCount + 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
          [postId, schoolId]
        );
      } catch {
        newCommentId = ++PostCommentService.commentIdCounter;
      }
    }

    // 同步写入沙箱
    const newEntity: IPostCommentEntity = {
      id: newCommentId,
      schoolId,
      postId,
      userId,
      guestNick: finalNick,
      guestAvatar: finalAvatar,
      replyCommentId,
      content: cleanContent,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      isDeleted: 0
    };
    PostCommentService.mockCommentsStore.set(newCommentId, newEntity);

    const targetPost = PostCommentService.mockPostsStore.get(postId);
    if (targetPost) {
      targetPost.commentCount = (targetPost.commentCount || 0) + 1;
    }

    return {
      commentId: newCommentId,
      postId,
      replyCommentId,
      authorName: finalNick,
      authorAvatar: finalAvatar,
      content: cleanContent,
      createdAtText: "刚刚",
      statusText: "发表成功"
    };
  }

  /**
   * 分页拉取评论并重组为两级楼中楼拓扑结构 (算法 2)
   */
  public async getCommentThreads(
    schoolId: number,
    postId: number,
    page: number = 1,
    pageSize: number = 20
  ): Promise<ICommentListResponseDto> {
    const pageNo = Math.max(1, page || 1);
    const limit = Math.min(50, Math.max(1, pageSize || 20));
    const offset = (pageNo - 1) * limit;

    let allComments: IPostCommentEntity[] = [];

    if (this.customDb) {
      const selectSql = `
        SELECT id, schoolId, postId, userId, guestNick, guestAvatar, replyCommentId, content, createdAt, isDeleted
        FROM post_comments
        WHERE schoolId = ? AND postId = ? AND isDeleted = 0
        ORDER BY id ASC
      `;
      try {
        allComments = await this.customDb.query<IPostCommentEntity>(selectSql, [schoolId, postId]);
      } catch {
        allComments = this.getCommentsFromMock(schoolId, postId);
      }
    } else {
      try {
        const res = await executeQuery<IPostCommentEntity>(
          `SELECT id, schoolId, postId, userId, guestNick, guestAvatar, replyCommentId, content, createdAt, isDeleted FROM post_comments WHERE schoolId = ? AND postId = ? AND isDeleted = 0 ORDER BY id ASC`,
          [schoolId, postId]
        );
        if (res.status === 1 && res.data && res.data.length > 0) {
          allComments = res.data;
        } else {
          allComments = this.getCommentsFromMock(schoolId, postId);
        }
      } catch {
        allComments = this.getCommentsFromMock(schoolId, postId);
      }
    }

    const totalCommentCount = allComments.length;

    // 算法 2: 楼中楼多级评论拓扑两级收敛 (Two-Tier Threading)
    const lookupMap = new Map<number, IPostCommentEntity>();
    for (const c of allComments) {
      lookupMap.set(c.id, c);
    }

    const rootList: IPostCommentEntity[] = [];
    const childrenMap = new Map<number, Array<{ comment: IPostCommentEntity; replyToNick: string }>>();

    for (const c of allComments) {
      if (c.replyCommentId === 0) {
        rootList.push(c);
      } else {
        // 向上寻找祖先根评论 (防循环深度上限 10)
        let curr: IPostCommentEntity = c;
        let depth = 0;
        let directParentNick = "";

        while (curr.replyCommentId > 0 && depth < 10) {
          const parent = lookupMap.get(curr.replyCommentId);
          if (!parent) break;
          if (depth === 0) {
            directParentNick = parent.guestNick || "用户";
          }
          curr = parent;
          depth++;
        }

        const rootId = curr.id;
        if (!childrenMap.has(rootId)) {
          childrenMap.set(rootId, []);
        }
        childrenMap.get(rootId)!.push({
          comment: c,
          replyToNick: directParentNick
        });
      }
    }

    // 根评论倒序排列 (最新的根评论在前面)
    rootList.reverse();

    // 分页切片根评论
    const pagedRoots = rootList.slice(offset, offset + limit);

    // 组装最终 DTO
    const threads: ICommentThreadDto[] = pagedRoots.map((root) => {
      const subList = childrenMap.get(root.id) || [];
      return {
        rootComment: {
          commentId: root.id,
          postId: root.postId,
          isGuest: root.userId === 0,
          authorName: root.guestNick || "热心师生",
          authorAvatar: root.guestAvatar || "/assets/avatar_guest.png",
          content: root.content,
          createdAtText: root.createdAt
        },
        subReplies: subList.slice(0, 5).map((sub) => ({
          commentId: sub.comment.id,
          postId: sub.comment.postId,
          isGuest: sub.comment.userId === 0,
          authorName: sub.comment.guestNick || "热心师生",
          authorAvatar: sub.comment.guestAvatar || "/assets/avatar_guest.png",
          content: sub.comment.content,
          replyToNick: sub.replyToNick,
          createdAtText: sub.comment.createdAt
        })),
        totalSubCount: subList.length
      };
    });

    return {
      postId,
      totalRootCount: rootList.length,
      totalCommentCount,
      currentPage: pageNo,
      hasMore: offset + limit < rootList.length,
      threads
    };
  }

  /**
   * 管理员软删除违规留言 (100% 软删除)
   */
  public async softDeleteComment(
    schoolId: number,
    commentId: number,
    operatorUserId: number,
    reason: string = "违规下架"
  ): Promise<void> {
    let postId = 0;

    if (this.customDb) {
      const checkSql = `SELECT id, postId FROM post_comments WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`;
      const rows = await this.customDb.query<{ id: number; postId: number }>(checkSql, [commentId, schoolId]);
      if (rows.length === 0) {
        throw new Error("未找到该评论或已处于删除状态");
      }
      postId = rows[0].postId;

      await this.customDb.execute(
        `UPDATE post_comments SET isDeleted = 1 WHERE id = ? AND schoolId = ?`,
        [commentId, schoolId]
      );
      await this.customDb.execute(
        `UPDATE posts SET commentCount = GREATEST(0, commentCount - 1) WHERE id = ? AND schoolId = ?`,
        [postId, schoolId]
      );
    } else {
      const memoryItem = PostCommentService.mockCommentsStore.get(commentId);
      if (!memoryItem || memoryItem.schoolId !== schoolId || memoryItem.isDeleted === 1) {
        throw new Error("未找到该评论或已处于删除状态");
      }
      postId = memoryItem.postId;
      memoryItem.isDeleted = 1;

      const targetPost = PostCommentService.mockPostsStore.get(postId);
      if (targetPost) {
        targetPost.commentCount = Math.max(0, targetPost.commentCount - 1);
      }

      try {
        await executeQuery(
          `UPDATE post_comments SET isDeleted = 1 WHERE id = ? AND schoolId = ?`,
          [commentId, schoolId]
        );
        await executeQuery(
          `UPDATE posts SET commentCount = GREATEST(0, commentCount - 1) WHERE id = ? AND schoolId = ?`,
          [postId, schoolId]
        );
      } catch {
        // ignore
      }
    }
  }

  private async verifyPostActive(schoolId: number, postId: number): Promise<void> {
    if (this.customDb) {
      const postCheckSql = `SELECT id, status FROM posts WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`;
      const postRows = await this.customDb.query<{ id: number; status: number }>(postCheckSql, [postId, schoolId]);
      if (postRows.length === 0 || postRows[0].status !== 1) {
        throw new Error("目标动态不存在或已被管理员违规下架，无法评论");
      }
    } else {
      const mockPost = PostCommentService.mockPostsStore.get(postId);
      if (mockPost) {
        if (mockPost.schoolId !== schoolId || mockPost.isDeleted === 1 || mockPost.status !== 1) {
          throw new Error("目标动态不存在或已被管理员违规下架，无法评论");
        }
        return;
      }
      let dbFound = false;
      try {
        const res = await executeQuery<{ id: number; status: number }>(
          `SELECT id, status FROM posts WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`,
          [postId, schoolId]
        );
        if (res.status === 1 && res.data && res.data.length > 0 && res.data[0].status === 1) {
          dbFound = true;
        }
      } catch {
        // DB offline
      }
      if (!dbFound) {
        throw new Error("目标动态不存在或已被管理员违规下架，无法评论");
      }
    }
  }

  private async verifyParentCommentActive(schoolId: number, postId: number, replyCommentId: number): Promise<void> {
    if (this.customDb) {
      const parentCheckSql = `SELECT id, isDeleted FROM post_comments WHERE id = ? AND postId = ? LIMIT 1`;
      const parentRows = await this.customDb.query<{ id: number; isDeleted: number }>(parentCheckSql, [replyCommentId, postId]);
      if (parentRows.length === 0 || parentRows[0].isDeleted === 1) {
        throw new Error("您回复的评论已被删除，无法继续回复");
      }
    } else {
      const parent = PostCommentService.mockCommentsStore.get(replyCommentId);
      if (parent) {
        if (parent.postId !== postId || parent.isDeleted === 1) {
          throw new Error("您回复的评论已被删除，无法继续回复");
        }
        return;
      }
      let dbFound = false;
      try {
        const res = await executeQuery<{ id: number; isDeleted: number }>(
          `SELECT id, isDeleted FROM post_comments WHERE id = ? AND postId = ? LIMIT 1`,
          [replyCommentId, postId]
        );
        if (res.status === 1 && res.data && res.data.length > 0 && res.data[0].isDeleted === 0) {
          dbFound = true;
        }
      } catch {
        // DB offline
      }
      if (!dbFound) {
        throw new Error("您回复的评论已被删除，无法继续回复");
      }
    }
  }

  private getCommentsFromMock(schoolId: number, postId: number): IPostCommentEntity[] {
    const list: IPostCommentEntity[] = [];
    for (const c of PostCommentService.mockCommentsStore.values()) {
      if (c.schoolId === schoolId && c.postId === postId && c.isDeleted === 0) {
        list.push(c);
      }
    }
    return list.sort((a, b) => a.id - b.id);
  }
}
