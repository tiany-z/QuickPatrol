/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根
 * (Chat Message Withdrawal & Security Audit Types)
 */

/**
 * 消息类型枚举 (对齐 M37)
 */
export enum ChatMessageType {
  TEXT = 0,        // 纯文本
  IMAGE = 1,       // 现场图片
  PATROL_CARD = 2, // 工单卡片
  SYSTEM = 3       // 居中通告
}

/**
 * 撤回操作人身份类型
 */
export enum WithdrawOperatorType {
  SENDER_SELF = 'SENDER_SELF',   // 发送人本人在 120 秒内自主撤回
  ADMIN_FORCE = 'ADMIN_FORCE',   // 校级安全管理员/督查强制熔断撤回
  SYSTEM_AUTO = 'SYSTEM_AUTO'    // 系统合规风控熔断撤回
}

/**
 * 消息物理存储实体 (chat_messages 表 13)
 */
export interface IChatMessageEntity {
  id: number;
  schoolId: number;
  chatRoomId: number;
  senderId: number;
  senderRole: 0 | 1 | 2 | 4 | 9; // 0师生, 1师傅, 2审核人, 4管理员, 9系统
  type: ChatMessageType;
  content: string;               // 原始正文 (即便撤回也物理留存)
  answerMessageId: number;       // 引用的父消息ID
  isWithDraw: 0 | 1;             // 0正常显示, 1已被撤回 (离库脱敏屏蔽)
  createdAt: string;
  updatedAt?: string;
}

/**
 * 客户端发起撤回消息请求 DTO
 */
export interface IWithdrawMessageRequestDto {
  /** 目标消息自增主键 ID */
  messageId: number;
  /** 所属工单协同会话室 ID */
  chatRoomId: number;
  /** 管理员特权撤回时的阻断事由 (可选) */
  adminReason?: string;
}

/**
 * 撤回成功响应 DTO
 */
export interface IWithdrawMessageResponseDto {
  /** 状态码 200 为成功 */
  code: number;
  /** 响应消息提示 */
  message: string;
  data: {
    messageId: number;
    chatRoomId: number;
    operatorId: number;
    operatorType: WithdrawOperatorType;
    isWithDraw: boolean;
    /** 是否支持点击“重新编辑”回填输入框 (仅限自撤文本) */
    reEditable: boolean;
    /** 用于重新编辑回填的原始纯文本 (仅自撤文本时下发) */
    originalText?: string;
    withdrawnAt: string;
  };
}

/**
 * 安全合规审计操作日志实体 (operation_logs 表 07)
 */
export interface IAuditLogEntity {
  id: number;
  schoolId: number;
  module: 'CHAT_IM' | 'PATROL_ORDER' | 'SECURITY';
  action: 'MESSAGE_WITHDRAW' | 'ADMIN_FORCE_WITHDRAW';
  targetId: number;       // 被撤回的 chat_messages.id
  operatorId: number;     // 操作人 userId
  operatorRole: number;
  clientIp: string;
  userAgent: string;
  /** 存根快照 JSON: 包含原消息文本、原图片 URL、发送时间戳等 */
  snapshotPayload: string;
  createdAt: string;
}

/**
 * 管理员调阅单条撤回存根明细 DTO
 */
export interface IWithdrawAuditDetailDto {
  messageId: number;
  chatRoomId: number;
  patrolId: number;
  patrolOrderNo: string;
  originalContent: string;
  originalType: ChatMessageType;
  sender: {
    id: number;
    name: string;
    roleName: string;
    studentOrWorkerNo: string;
  };
  operator: {
    id: number;
    name: string;
    roleName: string;
  };
  operatorType: WithdrawOperatorType;
  withdrawReason?: string;
  sentAt: string;
  withdrawnAt: string;
  elapsedSeconds: number;
  clientIp: string;
}

/**
 * WebSocket 撤回信令广播载荷契约
 */
export interface IMessageWithdrawnWsBroadcast {
  event: 'MESSAGE_WITHDRAWN';
  schoolId: number;
  chatRoomId: number;
  payload: {
    messageId: number;
    operatorId: number;
    operatorName: string;
    operatorRole: number;
    operatorType: WithdrawOperatorType;
    /** 是否为系统/管理员强制处置 */
    isSystemRecall: boolean;
    withdrawnAt: string;
    /** 会话大盘自愈更新数据 */
    updatedSessionSummary?: {
      lastMessage: string;
      lastMessageAt: string;
    };
  };
}

/**
 * 会话大盘自愈更新载荷
 */
export interface IRoomSummaryRollbackPayload {
  chatRoomId: number;
  schoolId: number;
  lastMessage: string;
  lastMessageAt: string;
  affectedReceiverRole: 'CREATOR' | 'HANDLER' | 'BOTH';
}
