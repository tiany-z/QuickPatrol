/**
 * 高校后勤巡查e速办 v4.0 - M44: 微应用专属服务会话与 100% 富交互卡片流 强类型契约
 * (App Card Stream & Structured Card Types)
 */

/**
 * 胶囊状态颜色语义枚举
 */
export type CardStatusColor = "volcano" | "blue" | "orange" | "green" | "gray";

/**
 * 卡片头部元数据契约
 */
export interface ICardHeaderPayload {
  badgeTitle: string;          // 业务大类标签 (如 "特急派单", "到场核验")
  statusPill: string;          // 状态胶囊文本 (如 "待接单", "处理中")
  statusColor: CardStatusColor;// 状态颜色
  timestamp: string;           // 格式化时间戳
}

/**
 * 卡片核心键值对字段契约
 */
export interface ICardFieldPayload {
  label: string;               // 字段名 (如 "隐患点位", "工单编号")
  value: string;               // 字段值
  highlight?: boolean;         // 是否高亮显色
}

/**
 * 卡片底部交互按钮契约
 */
export interface ICardActionPayload {
  actionId: string;            // 动作唯一标识 (如 "ACCEPT_ORDER", "CALL_PHONE")
  text: string;                // 按钮显示文字
  type: "primary" | "default" | "warn"; // 按钮视觉样式
  url?: string;                // 点击若为跳转则带路由
  payload?: Record<string, any>; // 动作附带参数
  disabled?: boolean;          // 是否置灰禁用
}

/**
 * 100% 结构化富卡片标准数据模型
 */
export interface IStructuredCardPayload {
  header: ICardHeaderPayload;
  fields: ICardFieldPayload[];
  thumbnailUrl?: string;       // 现场损坏高清缩略图 (可选，用于卡片内轻量展示)
  rawImageUrl?: string;        // 现场损坏原始高清大图 (用于全屏画廊双指缩放)
  actions?: ICardActionPayload[];
  slaDeadlineAt?: string;      // 工单 SLA 履约截止绝对时间戳 (用于算法 1 倒计时)
}

/**
 * 查询微应用专属卡片流请求 DTO
 */
export interface IQueryAppFeedRequestDto {
  appId: string;
  /** 游标 ID: 拉取小于该 ID 的更早历史卡片 (首屏传 0) */
  cursorMessageId?: number;
  /** 每页数量 (默认 20，上限 50) */
  pageSize?: number;
}

/**
 * 单张卡片流视图模型 (交付前端渲染)
 */
export interface IAppFeedCardViewDto {
  messageId: number;
  appId: string;
  patrolId: number;
  title: string;
  contentSnippet: string;
  cardPayload: IStructuredCardPayload;
  isRead: boolean;
  createdAt: string;
  formattedTimeText: string;
  slaInfo?: {
    text: string;
    isUrgent: boolean;
    isOverdue: boolean;
    diffMinutes?: number;
  };
}

/**
 * 卡片流响应 DTO
 */
export interface IAppFeedListResponseDto {
  code: number;
  message: string;
  data: {
    appId: string;
    appName: string;
    appIcon: string;
    hasMore: boolean;
    nextCursorId: number;
    cards: IAppFeedCardViewDto[];
  };
}

/**
 * 批量标已读请求 DTO
 */
export interface IBatchAckFeedReadRequestDto {
  appId: string;
  /** 指定消息 ID 数组，若为空数组则代表全清该微应用全部未读 */
  messageIds?: number[];
}

/**
 * 批量标已读响应 DTO
 */
export interface IBatchAckFeedReadResponseDto {
  code: number;
  message: string;
  data: {
    appId: string;
    clearedCount: number;
    remainingUnread: number;
  };
}

/**
 * 卡片动作按钮点击事件抛送载荷
 */
export interface ICardActionEventPayload {
  actionId: string;
  messageId: number;
  patrolId: number;
  payload?: Record<string, any>;
}

/**
 * 卡片缩略图画廊全屏预览载荷
 */
export interface ICardGalleryPreviewPayload {
  currentUrl: string;
  allUrls: string[];
}

/**
 * 卡片流控制器 HTTP 上下文
 */
export interface IAppFeedHttpCtx {
  schoolId: number;
  userId: number;
  userRole?: number;
  params?: Record<string, any>;
  query?: Record<string, any>;
  body?: Record<string, any>;
}
