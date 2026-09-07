/**
 * 高校后勤巡查e速办 v4.0 - M39: 聊天消息长按引用回复与源消息联动
 * (Chat Message Quoted Reply & Context Linking Types)
 */

import { ChatMessageType } from "./chatWithdrawTypes.js";

/**
 * 嵌入在聊天气泡中的被引用源消息摘要契约
 */
export interface IQuotedMessagePayload {
  /** 被引用源消息 ID */
  id: number;
  /** 源消息发送人 ID */
  senderId: number;
  /** 源消息发送人姓名/昵称 (如 "张师傅", "李同学") */
  senderName: string;
  /** 源消息发送人身份角色: 0师生, 1师傅, 2审核人, 4管理员, 9系统 */
  senderRole: number;
  /** 源消息类型 */
  type: ChatMessageType;
  /** 源消息精简摘要 (由算法 1 处理输出) */
  summary: string;
  /** 源消息是否已被撤回 (若为 true 则禁止点击跳转) */
  isWithdrawn: boolean;
}

/**
 * 拓展了引用卡片元数据的聊天消息全景呈现模型
 */
export interface IChatMessageQuoteView {
  id: number;
  schoolId: number;
  chatRoomId: number;
  senderId: number;
  senderName: string;
  senderAvatar: string;
  senderRole: number;
  type: ChatMessageType;
  content: string;
  /** 所引用的前序消息主键 ID (0 代表常规无引用消息) */
  answerMessageId: number;
  /** 关联注水的被引用源消息卡片 (当 answerMessageId > 0 时必定装载) */
  quotedMessage?: IQuotedMessagePayload;
  isWithDraw: boolean;
  isSelf: boolean;
  createdAt: string;
}

/**
 * 发送带引用的消息请求 DTO
 */
export interface ISendQuotedMessageRequestDto {
  chatRoomId: number;
  type: ChatMessageType;
  content: string;
  /** 引用的源消息 ID (必传，且必须 > 0) */
  answerMessageId: number;
  /** 客户端临时去重 ID (防弱网重发) */
  clientMsgId?: string;
}

/**
 * 发送带引用消息成功响应 DTO
 */
export interface ISendQuotedMessageResponseDto {
  code: number;
  message: string;
  data: {
    messageId: number;
    chatRoomId: number;
    clientMsgId: string;
    answerMessageId: number;
    quotedMessage: IQuotedMessagePayload;
    content: string;
    createdAt: string;
  };
}

/**
 * 拉取跨页极远源消息上下文切片请求 DTO
 */
export interface IQueryQuoteContextRequestDto {
  chatRoomId: number;
  /** 锚点中心消息 ID */
  anchorMessageId: number;
  /** 窗口切片大小 (默认 20 条，上限 50 条) */
  windowSize?: number;
}

/**
 * 跨页极远源消息上下文切片响应 DTO
 */
export interface IQuoteContextWindowDto {
  chatRoomId: number;
  anchorMessageId: number;
  /** 是否为非最新历史切片状态 */
  isHistoricalSlice: boolean;
  /** 窗口内包含的消息时序集合 (由旧到新正序排列) */
  messages: IChatMessageQuoteView[];
  hasEarlier: boolean;
  hasLater: boolean;
  hasMoreOlder?: boolean;
  hasMoreNewer?: boolean;
}

/**
 * 客户端输入框吸顶悬浮待发引用条状态
 */
export interface IQuoteBarState {
  visible: boolean;
  targetMessageId: number;
  senderName: string;
  summary: string;
  type: ChatMessageType;
}

/**
 * 客户端高亮呼吸灯触发状态
 */
export interface IHighlightTargetState {
  targetMessageId: number;
  isGlowActive: boolean;
  clearTimer?: any;
}
