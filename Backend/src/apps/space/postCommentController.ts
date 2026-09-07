/**
 * M34: 广场动态评论与风控控制器 (Post Comment Controller)
 * 职责：
 * 1. 免密公网端点接入与分布式令牌桶平滑防刷
 * 2. 评论字数清洗与注入防护
 * 3. 统一封装标准 StandardResult 信封
 */

import { PostCommentService } from "./postCommentService.js";
import { TokenBucketLimiter, IRedisPipelineClient } from "../../shared/resilience/tokenBucketLimiter.js";
import { ICreateCommentRequestDto } from "./postCommentTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../shared/flow/result.js";

export interface ICommentContext {
  schoolId: number;
  userId?: number;
  ip?: string;
  role?: number;
}

export class PostCommentController {
  constructor(
    private readonly commentService: PostCommentService = new PostCommentService(),
    private readonly redis?: IRedisPipelineClient | null
  ) {}

  /**
   * POST /api/v4/space/comments
   * 发表公开评论 / 楼中楼回复 (免密调用，前置令牌桶限流)
   */
  public async handleCreateComment(
    ctx: ICommentContext,
    body: any
  ): Promise<StandardResult<any>> {
    const { schoolId, userId = 0, ip = "127.0.0.1" } = ctx;
    const { postId, replyCommentId = 0, guestNick, guestAvatar, content, clientFingerprint } = body || {};

    const targetPostId = Number(postId);
    if (!targetPostId || isNaN(targetPostId)) {
      return returnError("动态 ID 非法");
    }

    // 1. 分布式令牌桶平滑限流探针 (单 IP 桶容量 3，每分钟产 2 令牌)
    const cleanIp = ip.replace(/:/g, "_");
    const bucketKey = `space:token_bucket:school_${schoolId}:ip_${cleanIp}`;
    const allowed = await TokenBucketLimiter.tryAcquire(this.redis, bucketKey, 3, 0.0333, 1);
    if (!allowed) {
      return returnError("您发言过于频繁，请稍候再试 (Too Many Requests)");
    }

    // 2. 基础入参校验
    if (!content || typeof content !== "string" || content.trim().length < 2 || content.length > 500) {
      return returnError("评论正文长度必须在 2 ~ 500 字之间");
    }

    const dto: ICreateCommentRequestDto = {
      postId: targetPostId,
      replyCommentId: parseInt(String(replyCommentId), 10) || 0,
      guestNick: guestNick?.trim() ? String(guestNick).substring(0, 30) : "热心师生",
      guestAvatar: guestAvatar?.trim() ? String(guestAvatar).substring(0, 500) : "",
      content: content.trim(),
      clientFingerprint
    };

    try {
      const result = await this.commentService.submitComment(schoolId, userId, dto);
      return returnSuccess(result, "发表评论成功");
    } catch (err: unknown) {
      return returnError((err as Error).message);
    }
  }

  /**
   * GET /api/v4/space/comments
   * 分页拉取楼中楼评论树
   */
  public async handleListComments(
    ctx: ICommentContext,
    query: any
  ): Promise<StandardResult<any>> {
    const { schoolId } = ctx;
    const postId = Number(query?.postId || query?.id);

    if (!postId || isNaN(postId)) {
      return returnError("缺少有效的动态 ID");
    }

    const page = parseInt(query?.page, 10) || 1;
    const pageSize = parseInt(query?.pageSize, 10) || 20;

    try {
      const data = await this.commentService.getCommentThreads(schoolId, postId, page, pageSize);
      return returnSuccess(data, "获取评论列表成功");
    } catch (err: unknown) {
      return returnError(`评论拉取异常: ${(err as Error).message}`);
    }
  }

  /**
   * DELETE /api/v4/space/comments
   * 管理员软删除违规留言
   */
  public async handleDeleteComment(
    ctx: ICommentContext,
    body: any
  ): Promise<StandardResult<any>> {
    const { schoolId, userId = 0 } = ctx;
    const commentId = Number(body?.commentId || body?.id);
    const reason = body?.deleteReason || "违规言论下架";

    if (!commentId || isNaN(commentId)) {
      return returnError("缺少有效的评论 ID");
    }

    try {
      await this.commentService.softDeleteComment(schoolId, commentId, userId, reason);
      return returnSuccess(null, "评论已成功软删除并扣减动态计数");
    } catch (err: unknown) {
      return returnError((err as Error).message);
    }
  }
}
