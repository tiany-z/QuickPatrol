/**
 * 高校后勤巡查e速办 v4.0 - 小程序端专属 AI 流式问答数据契约
 * 文件路径: miniprogram/pages/ai-copilot/contracts/copilotTypes.ts
 */

export enum CopilotSSEEventType {
  THINK_DELTA = 'think_delta',
  TOOL_START = 'tool_start',
  TOOL_END = 'tool_end',
  TEXT_DELTA = 'text_delta',
  SUGGESTIONS = 'suggestions',
  DONE = 'done',
  ACTION_CARDS = 'action_cards',
  ERROR = 'error'
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
  buttonType: 'primary' | 'default' | 'warn';
  actionType: 'NAVIGATE_PATROL_DETAIL' | 'DIAL_PHONE';
  targetParam: string;
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
  statusBadgeColor: 'blue' | 'orange' | 'green' | 'gray';
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
  timeText: string;
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
    role: 'user' | 'assistant';
    content: string;
    reasoningContent?: string;
    actionCards?: IAIActionCardPayload[];
    timeText: string;
  }>;
}

export interface ICopilotSSEPayload {
  eventType: CopilotSSEEventType;
  delta?: string;
  isInitial?: boolean;
  title?: string;
  toolInfo?: {
    toolName: string;
    pillTitle: string;
    inputArgs?: Record<string, unknown>;
    success?: boolean;
    durationMs?: number;
    summary?: string;
  };
  suggestions?: string[];
  cards?: IAIActionCardPayload[];
  sessionUuid?: string;
  metrics?: {
    totalDurationMs: number;
    thinkDurationMs?: number;
    totalTokens?: number;
    modelName: string;
  };
  errorMsg?: string;
  code?: string;
}

export type ThinkingPillStatus = 'THINKING' | 'TOOL_CALLING' | 'FINISHED' | 'FAILED';

export interface IThinkingPillState {
  status: ThinkingPillStatus;
  title: string;
  thinkContent: string;
  toolLogs: Array<{
    toolName: string;
    pillTitle: string;
    durationMs: number;
    success: boolean;
  }>;
  startTimeMs: number;
  elapsedSecondsText: string;
  isExpanded: boolean;
}

export type CopilotRole = 'user' | 'assistant' | 'system';

export interface ICopilotMessageItem {
  id: string;
  role: CopilotRole;
  renderedContent: string;
  thinkingPill: IThinkingPillState | null;
  isStreaming: boolean;
  suggestions?: string[];
  actionCards?: IAIActionCardPayload[];
  timeText: string;
  errorMessage?: string;
}

export interface ICopilotChatRequestDto {
  prompt: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  contextParam?: {
    currentPatrolId?: number;
    currentCampusId?: number;
    userRoleTag?: string;
  };
  sessionUuid?: string;
}
