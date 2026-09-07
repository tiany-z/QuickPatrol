/**
 * 高校后勤巡查e速办 v4.0 - M41: 科室工作群与突发险情应急抢险群聊类型与契约定义
 * (Chat Group Types & DTO Definitions)
 */

/**
 * 群成员角色权限枚举 (对齐数据库表 25 chk_group_role)
 */
export enum GroupMemberRole {
  MEMBER = 0, // 普通群成员
  ADMIN = 1,  // 群管理员
  OWNER = 2   // 群主
}

/**
 * 群聊会话扩展实体 (chat_rooms 表 12, roomType = 'group')
 */
export interface IChatGroupRoomEntity {
  id: number;
  schoolId: number;
  roomType: 'group';
  title: string;              // 群聊名称 (如 "西校区配电房突发抢险指挥群")
  patrolId: number | null;    // 关联工单ID (突发抢险必填, 常规群为 NULL)
  creatorId: number;          // 创建人 userId
  handlerId?: number;
  initiatedByHandler: 0 | 1;
  isClosed: 0 | 1;            // 是否已归档锁定 (1只读)
  isPinned?: 0 | 1;
  creatorUnreadCount?: number;
  handlerUnreadCount?: number;
  lastMessage: string;
  lastMessageAt: string | null;
  createdAt: string;
}

/**
 * 群成员物理表实体 (chat_group_members 表 25)
 */
export interface IChatGroupMemberEntity {
  id: number;
  schoolId: number;
  chatRoomId: number;
  userId: number;
  role: GroupMemberRole;
  nickInGroup: string;        // 群内专属昵称
  joinedAt: string;
  lastReadMessageId: number;  // 关键字段: 已读游标
  isMuted: 0 | 1;             // 免打扰: 0正常, 1免打扰
}

/**
 * 创建群聊请求 DTO
 */
export interface ICreateGroupRequestDto {
  title: string;
  /** 关联的突发抢修工单 ID (可选) */
  patrolId?: number;
  /** 初始被邀请成员的用户 ID 集合 */
  memberUserIds: number[];
  /** 初始创建公告内容 (可选) */
  initialNotice?: string;
}

/**
 * 创建群聊响应 DTO
 */
export interface ICreateGroupResponseDto {
  chatRoomId: number;
  title: string;
  memberCount: number;
  createdAt: string;
}

/**
 * 邀请/拉人请求 DTO
 */
export interface IGroupMemberManageDto {
  chatRoomId: number;
  /** 目标用户 ID 集合 */
  targetUserIds: number[];
}

/**
 * 踢出成员请求 DTO
 */
export interface IRemoveMemberDto {
  chatRoomId: number;
  targetUserId: number;
}

/**
 * 发布群公告请求 DTO
 */
export interface IPublishGroupNoticeDto {
  chatRoomId: number;
  content: string;
  /** 是否吸顶强提醒 */
  isPinned: boolean;
}

/**
 * 群公告详情契约
 */
export interface IGroupNoticeDetailDto {
  chatRoomId: number;
  content: string;
  publisherName: string;
  publishedAt: string;
  isPinned: boolean;
}

/**
 * 客户端上报已读游标请求 DTO
 */
export interface IGroupReadCursorAckDto {
  chatRoomId: number;
  /** 当前阅读到的最大消息 ID */
  lastReadMessageId: number;
}

/**
 * 已读游标响应 DTO
 */
export interface IGroupReadCursorResponseDto {
  chatRoomId: number;
  lastReadMessageId: number;
  effectiveUnreadCount: number;
  syncedAt: string;
}

/**
 * 群成员信息条目 DTO
 */
export interface IGroupMemberItemDto {
  userId: number;
  realName: string;
  nickName: string;
  nickInGroup: string;
  avatarUrl: string;
  role: GroupMemberRole;
  roleName: string;
  joinedAt: string;
  isMuted: boolean;
}

/**
 * 群聊详情大盘 DTO
 */
export interface IGroupDetailDto {
  chatRoomId: number;
  schoolId: number;
  title: string;
  patrolId: number | null;
  creatorId: number;
  creatorName: string;
  isClosed: boolean;
  memberCount: number;
  members: IGroupMemberItemDto[];
  notice: IGroupNoticeDetailDto | null;
  currentUserRole: GroupMemberRole;
  isOwnerOrAdmin: boolean;
  isMuted: boolean;
  createdAt: string;
}

/**
 * 切换免打扰模式请求 DTO
 */
export interface IToggleGroupMuteDto {
  chatRoomId: number;
  isMuted: boolean;
}

/**
 * 群消息全双工 WebSocket 下发信令
 */
export interface IGroupWsBroadcastPayload {
  event: 'GROUP_MESSAGE_ARRIVED';
  schoolId: number;
  chatRoomId: number;
  message: {
    id: number;
    senderId: number;
    senderName: string;
    senderRole: number;
    type: number;
    content: string;
    isAtAll: boolean; // 是否 @所有人
    createdAt: string;
  };
}

/**
 * 群公告发布全双工 WebSocket 下发信令
 */
export interface IGroupWsNoticePayload {
  event: 'GROUP_NOTICE_PUBLISHED';
  schoolId: number;
  chatRoomId: number;
  notice: {
    content: string;
    publisherName: string;
    isPinned: boolean;
    publishedAt: string;
  };
}

/**
 * 成员被踢强制熔断长连接信令
 */
export interface IGroupWsForceEvictPayload {
  event: 'FORCE_EVICT_MEMBER';
  schoolId: number;
  chatRoomId: number;
  evictedUserId: number;
  operatorId: number;
  reason: string;
}
