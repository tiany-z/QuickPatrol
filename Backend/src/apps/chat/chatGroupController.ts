/**
 * 高校后勤巡查e速办 v4.0 - M41: 科室工作群与突发险情应急抢险群聊控制器
 * (Chat Group Controller)
 */

import { ChatGroupService } from "./chatGroupService.js";
import {
  ICreateGroupRequestDto,
  IPublishGroupNoticeDto,
  IGroupMemberManageDto
} from "./chatGroupTypes.js";
import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";

export interface IChatHttpCtx {
  schoolId: number;
  userId: number;
  userRole?: number;
  params?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
}

export class ChatGroupController {
  private static defaultService: ChatGroupService = new ChatGroupService();

  constructor(private readonly groupService: ChatGroupService = ChatGroupController.defaultService) {}

  /**
   * POST /api/v4/chat/groups/create
   * 创建科室工作群或突发抢险群
   */
  public async createGroup(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, body } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const { title, patrolId, memberUserIds, initialNotice } = body || {};

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return returnError("缺少必要参数: title 必须为非空字符串");
    }

    if (memberUserIds !== undefined && !Array.isArray(memberUserIds)) {
      return returnError("参数非法: memberUserIds 必须为用户ID数组");
    }

    const dto: ICreateGroupRequestDto = {
      title: title.trim(),
      patrolId: typeof patrolId === "number" ? patrolId : undefined,
      memberUserIds: Array.isArray(memberUserIds) ? memberUserIds.map(Number).filter((n) => !isNaN(n)) : [],
      initialNotice: typeof initialNotice === "string" ? initialNotice.trim() : undefined
    };

    try {
      const res = await this.groupService.createGroup(schoolId, userId, dto);
      return returnSuccess(res, "群聊创建成功");
    } catch (err: any) {
      return returnError(err.message || "创建群聊失败");
    }
  }

  /**
   * POST /api/v4/chat/groups/notice
   * 发布群公告 (仅限群主与管理员)
   */
  public async publishNotice(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, body, params, query } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const chatRoomId = Number(body?.chatRoomId || params?.id || query?.chatRoomId || 0);
    const content = body?.content;
    const isPinned = body?.isPinned !== undefined ? Boolean(body.isPinned) : true;

    if (!chatRoomId || chatRoomId <= 0) {
      return returnError("缺少必要参数: chatRoomId");
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return returnError("缺少必要参数: content 公告内容不可为空");
    }

    try {
      const res = await this.groupService.publishNotice(schoolId, userId, {
        chatRoomId,
        content: content.trim(),
        isPinned
      });
      return returnSuccess(res, "群公告发布成功");
    } catch (err: any) {
      return returnError(err.message || "发布群公告失败");
    }
  }

  /**
   * POST /api/v4/chat/groups/read-cursor
   * 更新已读游标 (算法 1)
   */
  public async updateReadCursor(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, body, params, query } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const chatRoomId = Number(body?.chatRoomId || params?.id || query?.chatRoomId || 0);
    const lastReadMessageId = Number(body?.lastReadMessageId ?? 0);

    if (!chatRoomId || chatRoomId <= 0) {
      return returnError("缺少必要参数: chatRoomId");
    }

    if (isNaN(lastReadMessageId) || lastReadMessageId < 0) {
      return returnError("参数非法: lastReadMessageId 必须为非负整数");
    }

    try {
      const res = await this.groupService.updateReadCursor(schoolId, chatRoomId, userId, lastReadMessageId);
      return returnSuccess(res, "已读游标同步成功");
    } catch (err: any) {
      return returnError(err.message || "游标同步失败");
    }
  }

  /**
   * GET /api/v4/chat/groups/detail
   * 获取群聊详情与成员列表
   */
  public async getGroupDetail(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, params, query } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const chatRoomId = Number(query?.chatRoomId || params?.id || 0);

    if (!chatRoomId || chatRoomId <= 0) {
      return returnError("缺少必要参数: chatRoomId");
    }

    try {
      const res = await this.groupService.getGroupDetail(schoolId, chatRoomId, userId);
      return returnSuccess(res, "获取群聊详情成功");
    } catch (err: any) {
      return returnError(err.message || "获取群聊详情失败");
    }
  }

  /**
   * POST /api/v4/chat/groups/members/invite
   * 邀请成员入群
   */
  public async addMembers(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, body } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const chatRoomId = Number(body?.chatRoomId || 0);
    const targetUserIds = body?.targetUserIds;

    if (!chatRoomId || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return returnError("参数非法: chatRoomId 与 targetUserIds 数组为必填项");
    }

    try {
      const res = await this.groupService.addMembers(schoolId, userId, {
        chatRoomId,
        targetUserIds: targetUserIds.map(Number).filter((n) => !isNaN(n))
      });
      return returnSuccess(res, `成功拉入 ${res.addedCount} 名成员`);
    } catch (err: any) {
      return returnError(err.message || "邀请成员入群失败");
    }
  }

  /**
   * POST /api/v4/chat/groups/members/kick
   * 移出群成员或主动退群
   */
  public async removeMember(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, body } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const chatRoomId = Number(body?.chatRoomId || 0);
    const targetUserId = Number(body?.targetUserId || userId); // 默认操作自己

    if (!chatRoomId || !targetUserId) {
      return returnError("缺少必要参数: chatRoomId 与 targetUserId");
    }

    try {
      const res = await this.groupService.removeMember(schoolId, userId, chatRoomId, targetUserId);
      const msg = res.isDisbanded ? "已解散并退出群聊" : "已成功移出群成员";
      return returnSuccess(res, msg);
    } catch (err: any) {
      return returnError(err.message || "移除群成员失败");
    }
  }

  /**
   * POST /api/v4/chat/groups/mute
   * 切换消息免打扰模式
   */
  public async toggleMute(ctx: IChatHttpCtx): Promise<StandardResult<any>> {
    const { schoolId, userId, body } = ctx;

    if (!schoolId || !userId) {
      return returnError("未授权的用户身份");
    }

    const chatRoomId = Number(body?.chatRoomId || 0);
    const isMuted = Boolean(body?.isMuted);

    if (!chatRoomId) {
      return returnError("缺少必要参数: chatRoomId");
    }

    try {
      const res = await this.groupService.toggleMute(schoolId, userId, chatRoomId, isMuted);
      return returnSuccess(res, isMuted ? "已开启免打扰" : "已关闭免打扰");
    } catch (err: any) {
      return returnError(err.message || "切换免打扰失败");
    }
  }
}
