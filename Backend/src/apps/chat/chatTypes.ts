/**
 * M25: 责任人主动发起聊天与师生多媒体会话实体契约与传输契约
 * (Patrol Chat & Media Session Types)
 */

/**
 * 即时协同会话室实体契约 (对应物理表 12: chat_rooms)
 */
export interface IChatRoomEntity {
  id: number;                     // 会话室ID (chatRoomId)
  schoolId: number;               // 所属学校ID (租户隔离)
  roomType: "patrol" | "direct" | "group"; // 会话类型
  title: string;                  // 会话标题
  patrolId: number | null;        // 关联工单ID
  creatorId: number;              // 提报人UID
  handlerId: number;              // 责任师傅UID
  initiatedByHandler: 0 | 1;      // 是否已被责任师傅主动激活: 0未激活静默态, 1已激活开启态
  isClosed: 0 | 1;                // 是否已结案归档只读: 0开启中, 1已归档锁定
  isPinned: 0 | 1;                // 师傅端是否置顶: 1置顶, 0普通
  creatorUnreadCount: number;     // 师生端未读数
  handlerUnreadCount: number;     // 师傅端未读数
  lastMessage: string;            // 最新消息摘要 (如 "[图片]" 或截断文字)
  lastMessageAt: string | null;   // 最新活跃时间 (ISO 或 SQL DATETIME)
  createdAt: string;              // 会话室创建时间
}

/**
 * 聊天消息明细实体契约 (对应物理表 13: chat_messages)
 */
export interface IChatMessageEntity {
  id: number;                     // 消息自增主键ID
  schoolId: number;               // 所属学校ID
  chatRoomId: number;             // 所属会话室ID
  senderId: number;               // 发送人UID (0代表系统)
  senderRole: 0 | 1 | 2 | 4 | 9;  // 身份: 0师生, 1责任师傅, 2质检人, 4管理员, 9系统通知
  type: 0 | 1 | 2 | 3;            // 消息形态: 0文本, 1现场实况图片, 2工单进度卡片, 3居中系统通知药丸
  content: string;                // 正文内容 (或 OSS 图片链接 / 进度卡片结构化 JSON)
  answerMessageId: number;        // 引用的前序消息ID (0为无引用)
  isWithDraw: 0 | 1;              // 是否已撤回: 0正常, 1已软屏蔽撤回
  createdAt: string;              // 发送时间
}

/**
 * 发送消息请求体
 */
export interface ISendMessageRequest {
  chatRoomId: number;
  type: 0 | 1 | 2;                // 仅允许业务客户端发送 0文本, 1图片, 2卡片 (系统3药丸仅后端自动注入)
  content: string;                // 文本正文或图片 OSS URL
  answerMessageId?: number;       // 引用的消息ID (可选)
}

/**
 * 引用消息摘要模型
 */
export interface IQuotedMessageDto {
  id: number;
  senderName: string;
  summary: string;
}

/**
 * 发送消息响应传输对象
 */
export interface ISendMessageResponseDto {
  messageId: number;
  chatRoomId: number;
  senderId: number;
  type: 0 | 1 | 2 | 3;
  content: string;
  isWithDraw: 0 | 1;
  createdAt: string;
  quotedMessage?: IQuotedMessageDto;
}

/**
 * 消息撤回请求体
 */
export interface IWithdrawMessageRequest {
  chatRoomId?: number;
  messageId: number;
}

/**
 * 消息撤回响应传输对象
 */
export interface IWithdrawMessageResponseDto {
  success: boolean;
  chatRoomId: number;
  messageId: number;
}

/**
 * 主动激活会话请求体
 */
export interface IInitiateRoomRequest {
  patrolId: number;
}

/**
 * 主动激活会话响应传输对象
 */
export interface IInitiateRoomResponseDto {
  success: boolean;
  chatRoomId: number;
}

/**
 * 标记已读请求体
 */
export interface IMarkReadRequest {
  chatRoomId: number;
}

/**
 * 类 QQ 会话列表大盘条目模型
 */
export interface IChatSessionSummaryDto {
  chatRoomId: number;
  patrolId: number;
  orderNo: string;
  peerUserId: number;
  peerUserName: string;
  peerAvatarUrl: string;
  roomTitle: string;
  lastMessageText: string;
  lastMessageTime: string;
  unreadCount: number;
  isPinned: boolean;
  isClosed: boolean;
  initiatedByHandler: boolean;
}

/**
 * WebSocket 即时协同广播帧协议模型
 */
export interface IChatWsFramePayload {
  event: "CHAT_MESSAGE_PUSH" | "MESSAGE_WITHDRAWN" | "ROOM_ACTIVATED" | "ROOM_ARCHIVED";
  schoolId: number;
  chatRoomId: number;
  message?: {
    id: number;
    senderId: number;
    senderName: string;
    senderRole: number;
    type: number;
    content: string;
    createdAt: string;
    answerMessageId: number;
  };
  withdrawnMessageId?: number;
}
