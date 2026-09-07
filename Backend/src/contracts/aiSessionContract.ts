/**
 * 高校后勤巡查e速办 v4.0 - M49: AI 会话持久化与智能工单卡片直达
 * 文件路径: src/contracts/aiSessionContract.ts
 * 核心契约: 会话实体、问答流水实体、工单直达卡片载荷与 Token 审计数据模型
 */

/**
 * ai_agent_sessions 物理表实体契约
 */
export interface IAIAgentSessionEntity {
  id: number;
  schoolId: number;
  userId: number;
  sessionUuid: string;
  title: string;
  modelProvider: string;
  modelName: string;
  messageCount: number;
  totalTokensUsed: number;
  isPinned: number;
  isArchived: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * ai_agent_messages 物理表实体契约
 */
export interface IAIAgentMessageEntity {
  id: number;
  schoolId: number;
  sessionId: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoningContent?: string | null;
  toolCallsJson?: string | null;
  actionCardsJson?: string | null;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  createdAt: string;
}

/**
 * 智能工单直达卡片内部键值字段定义
 */
export interface IActionCardField {
  label: string;
  value: string;
  isHighlight?: boolean;
}

/**
 * 卡片交互动作按钮定义
 */
export interface IActionCardButton {
  actionId: string;
  label: string;
  buttonType: "primary" | "default" | "warn";
  /** 点击后触发的行为: 'NAVIGATE_PATROL_DETAIL' | 'DIAL_PHONE' */
  actionType: "NAVIGATE_PATROL_DETAIL" | "DIAL_PHONE";
  targetParam: string; // 路由参数或电话号码
}

/**
 * 结构化工单直达卡片载荷 (Action Card Payload)
 */
export interface IAIActionCardPayload {
  cardId: string;
  patrolId: number;
  patrolSn: string;
  title: string;
  locationName: string;
  urgencyLevel: number;
  statusText: string;
  statusBadgeColor: "blue" | "orange" | "green" | "gray";
  fields: IActionCardField[];
  actions: IActionCardButton[];
  slaRemainingText?: string;
}

/**
 * 抽屉式历史会话列表单项 DTO
 */
export interface IAISessionSummaryDto {
  sessionUuid: string;
  title: string;
  modelName: string;
  messageCount: number;
  totalTokensUsed: number;
  isPinned: boolean;
  timeText: string; // 如 "刚刚", "10分钟前", "昨天"
  updatedAt: string;
}

/**
 * 单条会话历史消息全量回溯 DTO
 */
export interface IAISessionDetailDto {
  sessionUuid: string;
  title: string;
  modelName: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    reasoningContent?: string;
    actionCards?: IAIActionCardPayload[];
    timeText: string;
  }>;
}

/**
 * 工具调用持久化快照契约
 */
export interface IToolSnapshotLog {
  toolName: string;
  summaryTitle: string;
  durationMs: number;
  success: boolean;
  inputArgsSummary?: string;
}

/**
 * Token 与耗时审计度量
 */
export interface ITokenUsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
}
