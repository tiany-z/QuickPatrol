/**
 * M33: 校园公开空间控制器 (Space Feed Controller)
 * 职责：
 * 1. 免密公网端点入参严格清洗与限频防呆
 * 2. 统一将底层异常包装为标准 StandardResult 信封结构
 */

import { SpaceFeedService } from "./spaceFeedService.js";
import {
  IPublicFeedQueryDto,
  IPublicFeedListDto,
  IGuestLikeRequestDto,
  IGuestLikeResponseDto,
  IGuestCommentRequestDto,
  IGuestCommentResponseDto
} from "./spaceFeedTypes.js";
import { returnSuccess, returnError, StandardResult } from "../../shared/flow/result.js";

export class SpaceFeedController {
  constructor(private readonly spaceService: SpaceFeedService = new SpaceFeedService()) {}

  /**
   * GET /api/v4/space/feeds
   * 免密拉取双轨瀑布流列表
   */
  public async handleGetFeeds(ctx: {
    schoolId: number;
    schoolCode?: string;
    query?: any;
  }): Promise<StandardResult<IPublicFeedListDto>> {
    const { schoolId, schoolCode, query } = ctx;
    if (!schoolId || isNaN(schoolId)) {
      return returnError("缺少有效的高校租户标识");
    }

    const queryDto: IPublicFeedQueryDto = {
      schoolCode: schoolCode || query?.schoolCode || "lcu",
      page: parseInt(query?.page, 10) || 1,
      pageSize: parseInt(query?.pageSize, 10) || 20,
      filterTrack: query?.filterTrack || "all",
      sortBy: query?.sortBy || "latest"
    };

    try {
      const data = await this.spaceService.queryPublicFeeds(schoolId, queryDto);
      return returnSuccess(data, "获取公开空间瀑布流成功");
    } catch (err: unknown) {
      return returnError(`拉取瀑布流异常: ${(err as Error).message}`);
    }
  }

  /**
   * POST /api/v4/space/feeds/like
   * 访客一键防刷点赞
   */
  public async handleLikeFeed(ctx: {
    schoolId: number;
    ip?: string;
    body?: any;
    params?: any;
  }): Promise<StandardResult<IGuestLikeResponseDto>> {
    const { schoolId, ip = "127.0.0.1", body, params } = ctx;
    const postId = Number(params?.id || body?.postId);
    const clientFingerprint = body?.clientFingerprint;

    if (!postId || isNaN(postId)) {
      return returnError("动态 ID 非法");
    }
    if (!clientFingerprint || typeof clientFingerprint !== "string" || !clientFingerprint.trim()) {
      return returnError("缺少客户端设备特征指纹");
    }

    const dto: IGuestLikeRequestDto = {
      postId,
      clientFingerprint: clientFingerprint.trim()
    };

    try {
      const result = await this.spaceService.processGuestLike(schoolId, dto, ip);
      return returnSuccess(result, "点赞成功");
    } catch (err: unknown) {
      return returnError((err as Error).message);
    }
  }

  /**
   * POST /api/v4/space/feeds/guest-comment
   * 访客快捷发表留言
   */
  public async handleGuestComment(ctx: {
    schoolId: number;
    body?: any;
    params?: any;
  }): Promise<StandardResult<IGuestCommentResponseDto>> {
    const { schoolId, body, params } = ctx;
    const postId = Number(params?.id || body?.postId);
    const { guestNick, guestAvatar, commentContent } = body || {};

    if (!postId || isNaN(postId)) {
      return returnError("动态 ID 非法");
    }
    if (!commentContent || typeof commentContent !== "string" || commentContent.trim().length < 2) {
      return returnError("评论内容不能少于 2 个字");
    }

    const dto: IGuestCommentRequestDto = {
      postId,
      guestNick: guestNick ? String(guestNick).substring(0, 30) : "热心师生",
      guestAvatar: guestAvatar ? String(guestAvatar).substring(0, 500) : "",
      commentContent: commentContent.trim().substring(0, 300)
    };

    try {
      const result = await this.spaceService.submitGuestComment(schoolId, dto);
      return returnSuccess(result, "留言成功");
    } catch (err: unknown) {
      return returnError((err as Error).message);
    }
  }
}
