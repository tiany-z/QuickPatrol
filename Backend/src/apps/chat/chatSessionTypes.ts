/**
 * 高校后勤巡查e速办 v4.0 - M40: 视口停留已读瞬间消除与工单置顶排序大盘类型契约
 * (Read Receipts & Sticky Pinning Dashboard Types)
 */

/**
 * 对应底层物化视图 v_chat_sessions 的物理实体契约
 */
export interface IChatSessionViewEntity {
  chatRoomId: number;
  schoolId: number;
  patrolId: number;
  patrolOrderNo?: string;
  patrolStatus?: number;
  patrolTitle?: string;
  patrolLocation?: string;
  categoryName?: string;
  creatorId: number;
  creatorName?: string;
  creatorAvatar?: string;
  creatorRealName?: string;
  creatorNickName?: string;
  creatorAvatarUrl?: string;
  handlerId: number;
  handlerName?: string;
  handlerAvatar?: string;
  handlerRealName?: string;
  initiatedByHandler: 0 | 1;
  isClosed: 0 | 1;
  isPinned?: 0 | 1;
  lastMessage: string;
  lastMessageAt: string;
  creatorUnreadCount: number;
  handlerUnreadCount: number;
  roomCreatedAt?: string;
}

/**
 * 传输给端侧的格式化会话条目 DTO
 */
export interface IChatSessionItemDto {
  chatRoomId: number;
  patrolId: number;
  patrolOrderNo: string;
  patrolStatus: number;
  patrolStatusName: string;
  /** 对方展示昵称 (若是学生看师傅则为师傅名，师傅看学生则为学生名) */
  targetPeerName: string;
  /** 对方头像 */
  targetPeerAvatar: string;
  /** 对方角色标签: "报修师生" | "主责师傅" */
  targetPeerRoleTag: string;
  /** 报修位置名称 (如 "西校区12号楼302") */
  locationName: string;
  /** 最后一条消息的摘要文本 (如 "[现场图片]", "[回复] 好的收到") */
  lastMessage: string;
  /** 最后消息时间 (ISO 格式) */
  lastMessageAt: string;
  /** 格式化后的人性化时间展示 (如 "刚刚", "14:20", "昨天") */
  formattedTimeText: string;
  /** 当前用户在该会话中的未读数 */
  unreadCount: number;
  /** 当前用户是否已将该会话置顶 */
  isPinned: boolean;
}

/**
 * 标记会话已读请求 DTO
 */
export interface IAckReadRequestDto {
  chatRoomId: number;
}

/**
 * 标记会话已读响应 DTO
 */
export interface IAckReadResponseDto {
  code: number;
  message: string;
  data: {
    chatRoomId: number;
    clearedCount: number;
    remainingTotalUnread: number;
    clearedAt: string;
  };
}

/**
 * 切换会话置顶状态请求 DTO
 */
export interface IToggleSessionPinRequestDto {
  chatRoomId: number;
  /** true 置顶，false 取消置顶 */
  pin: boolean;
}

/**
 * 切换置顶状态响应 DTO
 */
export interface IToggleSessionPinResponseDto {
  code: number;
  message: string;
  data: {
    chatRoomId: number;
    isPinned: boolean;
    updatedAt: string;
  };
}

/**
 * WebSocket READ_ACK 广播信令载荷
 */
export interface IReadAckWsBroadcast {
  event: "CHAT_ROOM_READ_CLEARED";
  schoolId: number;
  chatRoomId: number;
  userId: number;
  clearedUnreadCount: number;
  remainingTotalUnread: number;
}

/**
 * 全局底部红点徽章同步载荷
 */
export interface IGlobalBadgeSyncPayload {
  schoolId: number;
  userId: number;
  totalUnreadCount: number;
}
