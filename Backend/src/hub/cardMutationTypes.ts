/**
 * 高校后勤巡查e速办 v4.0 - M45: 卡片原地状态动态演进引擎 强类型契约
 * (Card State Dynamic In-Place Mutation Engine Types)
 */

import { IStructuredCardPayload } from "./appFeedTypes.js";

/**
 * 卡片交互动作指令类型枚举
 */
export enum CardActionType {
  ACCEPT_ORDER = "ACCEPT_ORDER",     // 抢单接单
  APPLY_DELAY = "APPLY_DELAY",       // 申请延期
  FINISH_WORK = "FINISH_WORK",       // 现场交卷
  CLOSE_ORDER = "CLOSE_ORDER",       // 归档结案
  REJECT_REVIEW = "REJECT_REVIEW"    // 质检驳回
}

/**
 * 卡片演进形态状态枚举
 */
export enum CardMorphismState {
  PENDING = "PENDING",               // 待接单/待处理
  IN_PROGRESS = "IN_PROGRESS",       // 施工中/抢修中
  DELAYING = "DELAYING",             // 延期审批中
  REVIEWING = "REVIEWING",           // 待质检复核
  ARCHIVED = "ARCHIVED"              // 已归档结案
}

/**
 * 客户端点击卡片按钮触发动作请求 DTO
 */
export interface ICardActionRequestDto {
  /** 目标消息 ID (对应 messages.id) */
  messageId: number;
  /** 所属业务工单 ID (对应 patrols.id) */
  patrolId: number;
  /** 动作指令标识 */
  actionId: CardActionType | string;
  /** 动作附带自定义扩展数据 (如延期理由、交卷描述) */
  actionPayload?: Record<string, any>;
}

/**
 * 卡片原地变迁执行成功响应 DTO
 */
export interface ICardActionResponseDto {
  code: number;
  message: string;
  data: {
    messageId: number;
    patrolId: number;
    nextState: CardMorphismState;
    /** 重铸后的最新结构化卡片载荷 */
    mutatedCardPayload: IStructuredCardPayload;
    mutatedAt: string;
  };
}

/**
 * Redis 总线与 WebSocket 全双工原地变迁广播信令
 */
export interface ICardMutatedWsBroadcast {
  event: "CARD_MUTATED";
  schoolId: number;
  messageId: number;
  patrolId: number;
  operatorId: number;
  operatorName: string;
  nextState: CardMorphismState;
  version: number;
  mutatedCardPayload: IStructuredCardPayload;
}

/**
 * 记录在卡片快照中的时间线流水存根契约
 */
export interface ICardAuditTimelineStub {
  timestamp: string;
  operatorName: string;
  operatorRoleTag: string;
  actionText: string;
}
