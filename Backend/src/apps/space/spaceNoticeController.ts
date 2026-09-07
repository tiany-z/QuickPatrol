/**
 * M35: 点赞与官方公告控制器 (Space Notice Controller)
 * 职责：
 * 1. 师生点赞与取消点赞 (POST /api/v4/space/feeds/toggle-like)
 * 2. 官方重大工程白皮书发布与四级权限栅栏拦截 (POST /api/v4/space/notices/publish-top)
 * 3. 广场首屏置顶通告横幅获取 (GET /api/v4/space/notices/active-banners)
 */

import { PostLikeService } from "./postLikeService.js";
import { OfficialNoticeService } from "./officialNoticeService.js";
import {
  IToggleLikeRequestDto,
  IPublishOfficialNoticeDto,
  IToggleLikeResponseDto,
  IPublishNoticeResponseDto,
  ITopNoticeBannerDto
} from "./postLikeTypes.js";
import { StandardResult, returnSuccess, returnError } from "../../shared/flow/result.js";

export interface INoticeHttpCtx {
  schoolId: number;
  userId: number;
  role?: number;
  body?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
  ip?: string;
}

export class SpaceNoticeController {
  constructor(
    private readonly likeService: PostLikeService = new PostLikeService(),
    private readonly noticeService: OfficialNoticeService = new OfficialNoticeService()
  ) {}

  /**
   * POST /api/v4/space/feeds/:id/toggle-like 或 /toggle-like
   * 师生切换点赞/取消点赞 (返回原生 HTTP 响应体)
   */
  public async toggleLike(ctx: INoticeHttpCtx): Promise<any> {
    const rawPostId =
      ctx.body?.postId ??
      ctx.params?.id ??
      ctx.params?.postId ??
      ctx.query?.id ??
      ctx.query?.postId;

    const postId = parseInt(String(rawPostId), 10);
    const { schoolId, userId } = ctx;

    if (!postId || isNaN(postId)) {
      return { code: 400, message: "动态 ID 非法" };
    }

    if (!userId || userId <= 0) {
      return { code: 401, message: "请先完成师生身份登录后点赞" };
    }

    const dto: IToggleLikeRequestDto = { postId };

    try {
      const result = await this.likeService.toggleLike(schoolId, userId, dto);
      return { code: 200, message: result.message, data: result };
    } catch (err: unknown) {
      return { code: 400, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 切换点赞状态
   */
  public async handleToggleLike(
    ctx: { schoolId: number; userId: number },
    body?: any,
    params?: any
  ): Promise<StandardResult<IToggleLikeResponseDto>> {
    const rawPostId = body?.postId ?? params?.id ?? params?.postId;
    const postId = parseInt(String(rawPostId), 10);
    const { schoolId, userId } = ctx;

    if (!postId || isNaN(postId)) {
      return returnError("动态 ID 非法");
    }

    if (!userId || userId <= 0) {
      return returnError("请先完成师生身份登录后点赞");
    }

    try {
      const result = await this.likeService.toggleLike(schoolId, userId, { postId });
      return returnSuccess(result, result.message);
    } catch (err: any) {
      return returnError(err?.message || "点赞操作失败");
    }
  }

  /**
   * POST /api/v4/space/notices/publish-top
   * 发布重大工程置顶公告 (需 role >= 3)
   */
  public async publishTopNotice(ctx: INoticeHttpCtx): Promise<any> {
    const { schoolId, userId, role = 1, body } = ctx;

    // 严格权限栅栏: 仅质检主管(3)、校级管理员(4)、超级管理员(9)有权发布置顶通告
    if (![3, 4, 9].includes(role)) {
      return { code: 403, message: "越权拦截: 仅后勤主管或校级管理员有权发布广场置顶公告" };
    }

    const {
      title,
      content,
      imageUrls,
      urgencyLevel,
      departmentId,
      topDurationDays,
      broadcastPopup
    } = body || {};

    if (!title || typeof title !== "string" || title.trim().length < 5 || title.length > 60) {
      return { code: 400, message: "通告标题必须在 5 ~ 60 字之间" };
    }

    if (!content || typeof content !== "string" || content.trim().length < 20 || content.length > 3000) {
      return { code: 400, message: "通告白皮书正文必须在 20 ~ 3000 字之间" };
    }

    const dto: IPublishOfficialNoticeDto = {
      title: title.trim(),
      content: content.trim(),
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      urgencyLevel: urgencyLevel || "NORMAL",
      departmentId: parseInt(departmentId, 10) || 1,
      topDurationDays: parseInt(topDurationDays, 10) || 7,
      broadcastPopup: Boolean(broadcastPopup)
    };

    try {
      const result = await this.noticeService.publishTopNotice(schoolId, userId, dto);
      return { code: 200, message: "发布成功", data: result };
    } catch (err: unknown) {
      return { code: 400, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 发布官方置顶通告
   */
  public async handlePublishTopNotice(
    ctx: { schoolId: number; userId: number; role: number },
    body: any
  ): Promise<StandardResult<IPublishNoticeResponseDto>> {
    const { schoolId, userId, role } = ctx;

    if (![3, 4, 9].includes(role)) {
      return returnError("越权拦截: 仅后勤主管或校级管理员有权发布广场置顶公告");
    }

    const {
      title,
      content,
      imageUrls,
      urgencyLevel,
      departmentId,
      topDurationDays,
      broadcastPopup
    } = body || {};

    if (!title || typeof title !== "string" || title.trim().length < 5 || title.length > 60) {
      return returnError("通告标题必须在 5 ~ 60 字之间");
    }

    if (!content || typeof content !== "string" || content.trim().length < 20 || content.length > 3000) {
      return returnError("通告白皮书正文必须在 20 ~ 3000 字之间");
    }

    const dto: IPublishOfficialNoticeDto = {
      title: title.trim(),
      content: content.trim(),
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      urgencyLevel: urgencyLevel || "NORMAL",
      departmentId: parseInt(departmentId, 10) || 1,
      topDurationDays: parseInt(topDurationDays, 10) || 7,
      broadcastPopup: Boolean(broadcastPopup)
    };

    try {
      const result = await this.noticeService.publishTopNotice(schoolId, userId, dto);
      return returnSuccess(result, "官方重大置顶公告已正式生效全校发布");
    } catch (err: any) {
      return returnError(err?.message || "发布置顶公告失败");
    }
  }

  /**
   * GET /api/v4/space/notices/top-banners 或 /active-banners
   * 获取当前有效置顶通告 (文档 6.3 命名对齐)
   */
  public async getTopBanners(ctx: INoticeHttpCtx): Promise<any> {
    const { schoolId } = ctx;
    try {
      const banners = await this.noticeService.getActiveTopNotices(schoolId);
      return { code: 200, message: "获取成功", data: banners };
    } catch (err: unknown) {
      return { code: 500, message: (err as Error).message };
    }
  }

  /**
   * 网关 Handler 标准封装: 获取置顶通告横幅列表
   */
  public async handleGetActiveBanners(
    ctx: { schoolId: number }
  ): Promise<StandardResult<ITopNoticeBannerDto[]>> {
    try {
      const banners = await this.noticeService.getActiveTopNotices(ctx.schoolId);
      return returnSuccess(banners, "获取成功");
    } catch (err: any) {
      return returnError(err?.message || "获取置顶通告失败");
    }
  }
}
