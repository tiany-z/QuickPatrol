/**
 * M36: 工单房责任人主动握手激活机制 强类型接口契约与数据模型定义
 * (Chat Handshake Activation Types)
 */

/**
 * 工单协同聊天室数据库物理实体契约
 * 对应底层物理表: chat_rooms (表 12)
 */
export interface IChatRoomEntity {
  /** 会话室唯一自增ID (主键) */
  id: number;
  /** 所属高校学校租户ID (强制多租户隔离) */
  schoolId: number;
  /** 会话场景类型: 'patrol' 工单协同, 'direct' 1v1 私聊, 'group' 应急抢险群聊 */
  roomType: "patrol" | "direct" | "group";
  /** 会话自定义专属标题 (工单类型可为空，群聊类型为群名称) */
  title: string;
  /** 关联巡查工单ID (patrol 类型必填，逻辑关联 patrols.id) */
  patrolId: number | null;
  /** 工单提报人/私聊发起人用户ID (师生 users.id) */
  creatorId: number;
  /** 承接责任人/私聊对象用户ID (维修师傅 users.id) */
  handlerId: number;
  /** 
   * 核心协同门禁: 责任人是否已主动发起聊天
   * 0: 未激活 (静默等待态，师生端输入框锁定)
   * 1: 已由处理人主动激活开启 (双向解锁沟通)
   */
  initiatedByHandler: 0 | 1;
  /** 会话状态: 0 正常开启中, 1 工单结案归档关闭 (只读冷冻) */
  isClosed: 0 | 1;
  /** 后勤师傅端是否置顶此会话: 1 置顶, 0 普通 */
  isPinned: 0 | 1;
  /** 师生端积攒未读消息数 */
  creatorUnreadCount: number;
  /** 后勤师傅端积攒未读消息数 */
  handlerUnreadCount: number;
  /** 最新一条消息摘要 (用于类 QQ 会话列表预览) */
  lastMessage: string;
  /** 最后活跃时间 (格式化 YYYY-MM-DD HH:mm:ss) */
  lastMessageAt: string | null;
  /** 会话创建时间 */
  createdAt: string;
}

/**
 * 师傅发起主动握手激活请求 DTO
 */
export interface IActivateHandshakeRequestDto {
  /** 目标会话室 ID (chat_rooms.id) */
  chatRoomId: number;
  /** 可选附带的初始打招呼文字 (若不填则下发系统默认气泡) */
  greetingMessage?: string;
}

/**
 * 主动握手激活成功响应 DTO
 */
export interface IActivateHandshakeResponseDto {
  chatRoomId: number;
  patrolId: number;
  initiatedByHandler: 1;
  handlerName: string;
  activatedAt: string;
  systemBubbleId: number;
  statusText: string;
}

/**
 * 打开聊天室时客户端首屏拉取的会话元数据与权限掩码
 */
export interface IChatRoomMetaDto {
  chatRoomId: number;
  schoolId: number;
  patrolId: number;
  roomType: "patrol" | "direct" | "group";
  title: string;
  creatorId: number;
  creatorName: string;
  creatorAvatar: string;
  handlerId: number;
  handlerName: string;
  handlerAvatar: string;
  handlerTag: string; // 师傅岗位标签: 如 "暖通抢修专工"
  initiatedByHandler: boolean;
  isClosed: boolean;
  isPinned: boolean;
  /** 当前请求人针对该会话的动态权限掩码 */
  permissions: {
    canInput: boolean;
    lockReason: string;
    showHandshakeButton: boolean;
  };
  /** 工单概览微卡片数据 (用于置顶吸顶条) */
  patrolSummary?: {
    orderNo: string;
    title: string;
    status: number;
    statusName: string;
    locationName: string;
  };
}

/**
 * WebSocket 房间广播信令载荷
 */
export interface IHandshakeBroadcastPayload {
  event: "CHAT_HANDSHAKE_ACTIVATED";
  schoolId: number;
  chatRoomId: number;
  patrolId: number;
  handlerUserId: number;
  handlerName: string;
  activatedAt: number;
  systemMessage: {
    messageId: number;
    content: string;
    type: 3; // 3: 系统居中通知气泡
    createdAt: string;
  };
}
