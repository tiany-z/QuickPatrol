/**
 * 高校后勤巡查e速办 v4.0 - M42: 统一消息中枢 (NotificationHub) 契约与类型定义
 * (NotificationHub Event Bus Types & Contracts)
 */

/**
 * 通知优先级枚举 (对齐物理表 14 messages.priority CHECK 约束)
 */
export enum NotificationPriority {
  LOW = "low",
  NORMAL = "normal",
  URGENT = "urgent"
}

/**
 * 外部离线穿透状态枚举 (对齐物理表 14 messages.externalPushStatus CHECK 约束)
 */
export enum ExternalPushStatus {
  NONE = "none",
  WX_SENT = "wx_sent",
  SMS_SENT = "sms_sent",
  FAILED = "failed"
}

/**
 * 结构化富卡片头部定义 (对齐 M44/M45 标准卡片流规范)
 */
export interface ICardHeader {
  badgeTitle: string;
  statusPill: string;
  statusColor: "blue" | "green" | "orange" | "volcano" | "gray";
  timestamp: string;
}

/**
 * 结构化卡片键值对字段
 */
export interface ICardField {
  label: string;
  value: string;
  highlight?: boolean;
}

/**
 * 结构化卡片交互动作按钮
 */
export interface ICardAction {
  actionId: string;
  text: string;
  type: "primary" | "default" | "warn";
  url?: string;
}

/**
 * 标准富交互结构化卡片核心载荷 (M44/M45 通用模型)
 */
export interface IStructuredCardPayload {
  header: ICardHeader;
  fields: ICardField[];
  thumbnailUrl?: string;
  actions?: ICardAction[];
}

/**
 * 业务微应用向 NotificationHub 提交的标准事件定义
 */
export interface IAppNotificationEvent {
  /** 租户学校 ID (多租户绝对物理隔离) */
  schoolId: number;
  /** 来源微应用标识 (必须在 apps 注册表中合法存在) */
  appId: "app-patrol" | "app-appeal" | "app-inspection" | "app-calendar" | "app-feedback" | "app-space" | "system" | string;
  /** 目标接收人自然人 ID */
  receiverId: number;
  /** 关联业务工单或核心实体 ID (可选，无则传 0) */
  patrolId?: number;
  /** 通知大标题 (128 字以内) */
  title: string;
  /** 纯文本降级摘要 (用于短信穿透或锁屏通知条预览) */
  content: string;
  /** 富交互结构化卡片核心载荷 (用于 M44/M45 卡片流渲染) */
  cardPayload?: IStructuredCardPayload;
  /** 小程序内跳页面路径 (如 "/packages/apps/app-patrol/pages/detail/index?id=101") */
  linkUrl?: string;
  /** 优先级: low, normal, urgent */
  priority?: NotificationPriority | "low" | "normal" | "urgent";
  /** 客户端业务生成的唯一去重幂等键 (可选，默认自动由内容生成 SHA-256 指纹) */
  idempotentKey?: string;
}

/**
 * 站内通知与离线穿透物理实体契约 (对齐物理表 14 messages)
 */
export interface IMessageNotificationEntity {
  id: number;
  schoolId: number;
  receiverId: number;
  appId: string;
  patrolId: number;
  title: string;
  content: string;
  /** JSON 原生字段: 结构化富卡片载荷 */
  cardPayloadJson: string | null;
  linkUrl: string;
  priority: NotificationPriority;
  isRead: 0 | 1;
  readAt: string | null;
  externalPushStatus: ExternalPushStatus;
  smsSent: 0 | 1;
  createdAt: string;
}

/**
 * 飞书式工作台微应用注册实体契约 (对齐物理表 26 apps)
 */
export interface IAppRegistryEntity {
  id: number;
  schoolId: number;
  appCode: string;
  name: string;
  icon: string;
  category: "daily" | "service" | "emergency" | "management" | string;
  entryRoute: string;
  minRole: number;
  isPublic: 0 | 1;
  isEnabled: 0 | 1;
  isDeleted: 0 | 1;
  sortOrder: number;
}

/**
 * Tab 1 会话大盘中展示的微应用聚合条目 DTO
 */
export interface IAppSessionItemDto {
  appCode: string;
  appName: string;
  appIcon: string;
  category: string;
  entryRoute: string;
  /** 该微应用未读通知总数 */
  unreadCount: number;
  /** 最近一条通知的标题摘要 */
  lastNoticeTitle: string;
  /** 最近一条通知的纯文本正文摘要 */
  lastNoticeSnippet: string;
  /** 最近一条通知的时间 (ISO 格式) */
  lastNoticeAt: string;
  /** 人性化时间展示 (如 "刚刚", "10:30", "昨天") */
  formattedTimeText: string;
}

/**
 * 获取微应用会话列表响应 DTO
 */
export interface IAppSessionListResponseDto {
  code: number;
  message: string;
  data: {
    totalUnread: number;
    sessions: IAppSessionItemDto[];
  };
}

/**
 * 分页拉取某个微应用专属通知流水请求 DTO
 */
export interface IQueryAppNotificationsDto {
  appId: string;
  page?: number;
  pageSize?: number;
  /** 仅查询未读 (可选) */
  onlyUnread?: boolean;
}

/**
 * 标为已读回执请求 DTO
 */
export interface IAckNotificationReadDto {
  /** 指定某条通知 ID (传 0 则代表一键清空该微应用下全部未读) */
  messageId: number;
  appId: string;
}

/**
 * Redis 广播与 WebSocket 实时下发的数据包契约
 */
export interface INotificationBusPublishPayload {
  event: "NEW_NOTIFICATION_ARRIVED";
  schoolId: number;
  receiverId: number;
  message: {
    id: number;
    appId: string;
    appName: string;
    appIcon: string;
    title: string;
    content: string;
    priority: NotificationPriority;
    createdAt: string;
  };
}
