/**
 * 高校后勤巡查e速办 v4.0 - M37: 类 QQ 聊天气泡渲染与多媒体扩展条契约模型
 * (Chat Bubbles & Media Bar Types)
 */

/**
 * 消息类型枚举
 */
export enum ChatMessageType {
  TEXT = 0,        // 普通文本 (含 Emoji 解析)
  IMAGE = 1,       // 现场图片直链
  PATROL_CARD = 2, // 工单微卡片
  SYSTEM = 3       // 居中系统通知小胶囊
}

/**
 * 聊天消息明细物理实体契约
 * 对应底层物理表: chat_messages (表 13)
 */
export interface IChatMessageEntity {
  /** 消息自增主键 */
  id: number;
  /** 高校学校租户ID */
  schoolId: number;
  /** 关联会话室ID (chat_rooms.id) */
  chatRoomId: number;
  /** 发送人自然人ID (0代表系统通知) */
  senderId: number;
  /** 发送人角色身份: 0师生, 1责任师傅, 2审核人, 4学校管理员, 9系统广播 */
  senderRole: 0 | 1 | 2 | 4 | 9;
  /** 消息类型 */
  type: ChatMessageType;
  /** 消息正文字符串 (或图片 OSS 链接 / 卡片 JSON) */
  content: string;
  /** 引用的前序消息ID (0为无引用, >0为所引用的 chat_messages.id) */
  answerMessageId: number;
  /** 是否已被撤回: 0正常显示, 1已撤回 (内容离库不外发) */
  isWithDraw: 0 | 1;
  /** 消息发送落盘时间 (格式化 YYYY-MM-DD HH:mm:ss 或 ISO) */
  createdAt: string;
}

/**
 * 发送消息请求 DTO
 */
export interface ISendMessageRequestDto {
  /** 目标会话室 ID */
  chatRoomId: number;
  /** 消息类型 */
  type: ChatMessageType;
  /** 消息内容 (纯文本、图片 URL 或卡片载荷) */
  content: string;
  /** 引用的前序消息 ID (可选，M39 引用回复使用) */
  answerMessageId?: number;
  /** 客户端本地生成的临时去重流水号 (防弱网重发) */
  clientMsgId?: string;
}

/**
 * 发送消息成功响应 DTO
 */
export interface ISendMessageResponseDto {
  messageId: number;
  chatRoomId: number;
  clientMsgId: string;
  type: ChatMessageType;
  content: string;
  senderId: number;
  senderName: string;
  senderAvatar: string;
  isSelf: boolean;
  createdAt: string;
  statusText: string;
}

/**
 * 分页拉取历史消息请求 DTO (支持向上翻阅倒序拉取)
 */
export interface IQueryMessagesRequestDto {
  chatRoomId: number;
  /** 游标 ID: 拉取小于该 messageId 的更早历史 (首次传 0 则拉取最新) */
  cursorMessageId?: number;
  /** 单次拉取条数 (默认 20，上限 50) */
  pageSize?: number;
}

/**
 * 历史消息单项结构
 */
export interface IChatMessageListItem {
  id: number;
  type: ChatMessageType;
  content: string;
  senderId: number;
  senderRole: number;
  senderName: string;
  senderAvatar: string;
  isSelf: boolean;
  isWithDraw: boolean;
  answerMessageId: number;
  quotedMessage?: any;
  createdAt: string;
  /** 算法 1 计算后的图片尺寸规格 (仅对 type === 1 有效) */
  imageMeta?: {
    boxWidth: number;
    boxHeight: number;
  };
}

/**
 * 历史消息分页结果 DTO
 */
export interface IChatMessageListDto {
  chatRoomId: number;
  hasMore: boolean;
  minMessageId: number;
  messages: IChatMessageListItem[];
}

/**
 * 常用语模版契约
 */
export interface IQuickReplyTemplate {
  templateId: number;
  /** 适用角色: 'HANDLER' (师傅专用) | 'STUDENT' (师生专用) */
  roleScope: 'HANDLER' | 'STUDENT';
  category: string; // 如 "到场确认", "请假延期", "配件缺少"
  text: string;     // 如 "已到宿舍楼下，请开门"
}

/**
 * 工单卡片消息载荷 (type === 2 时的 content JSON 结构)
 */
export interface IInlinePatrolCardPayload {
  patrolId: number;
  orderNo: string;
  categoryName: string;
  locationName: string;
  status: number;
  statusName: string;
  thumbnailUrl?: string;
  createdAt: string;
}

/**
 * 跨节点 WebSocket 下发的新消息广播信令
 */
export interface IChatMessageWsBroadcast {
  event: 'CHAT_MESSAGE_ARRIVED';
  schoolId: number;
  chatRoomId: number;
  message: {
    id: number;
    type: ChatMessageType;
    content: string;
    senderId: number;
    senderName: string;
    senderAvatar: string;
    senderRole: number;
    answerMessageId: number;
    createdAt: string;
    isWithDraw: boolean;
  };
}
