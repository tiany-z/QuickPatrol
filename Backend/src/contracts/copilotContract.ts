/**
 * 高校后勤巡查e速办 v4.0 - M47 小程序专属 AI 流式问答工作台 (SSE Copilot UI)
 * 契约定义与数据模型
 */

/**
 * Copilot SSE 广播标准事件名枚举
 */
export enum CopilotSSEEventType {
  /** 思考链推理字符增量 (用于 DeepSeek-R1 / OpenAI o1 reasoning_content) */
  THINK_DELTA = 'think_delta',
  /** 工具调用开始触发 (准备执行 M48 工具) */
  TOOL_START = 'tool_start',
  /** 工具调用执行结束 */
  TOOL_END = 'tool_end',
  /** 最终回答正文打字机字符增量 */
  TEXT_DELTA = 'text_delta',
  /** 生成完毕附加的快捷追问推荐气泡列表 */
  SUGGESTIONS = 'suggestions',
  /** 正常结束帧 (附带本次 Token 审计与耗时) */
  DONE = 'done',
  /** 智能实体水合生成的工单直达卡片快照 (M49) */
  ACTION_CARDS = 'action_cards',
  /** 异常报错帧 */
  ERROR = 'error'
}

/**
 * SSE 帧数据载荷联合契约
 */
export interface ICopilotSSEPayload {
  eventType: CopilotSSEEventType;
  /** 字符增量 (适用于 think_delta 和 text_delta) */
  delta?: string;
  /** 思考启动标记与短标题 */
  isInitial?: boolean;
  title?: string;
  /** 工具调用阶段元数据 (适用于 tool_start / tool_end) */
  toolInfo?: {
    toolName: string;
    pillTitle: string;
    inputArgs?: Record<string, unknown>;
    success?: boolean;
    durationMs?: number;
    summary?: string;
  };
  /** 快捷追问气泡列表 (适用于 suggestions) */
  suggestions?: string[];
  /** 智能工单直达卡片快照 (适用于 action_cards) */
  cards?: any[];
  /** 会话全局唯一标识 UUID */
  sessionUuid?: string;
  /** 统计审计度量 (适用于 done) */
  metrics?: {
    totalDurationMs: number;
    thinkDurationMs?: number;
    totalTokens?: number;
    modelName: string;
  };
  /** 错误信息 (适用于 error) */
  errorMsg?: string;
  code?: string;
}

/**
 * 思考药丸胶囊所处的生命阶段
 */
export type ThinkingPillStatus = 'THINKING' | 'TOOL_CALLING' | 'FINISHED' | 'FAILED';

/**
 * 单条 AI 消息绑定的 Thinking Pill 数据模型
 */
export interface IThinkingPillState {
  /** 当前阶段状态 */
  status: ThinkingPillStatus;
  /** 胶囊当前显示的短标题 (如 "正在深度思考后勤处置规范...") */
  title: string;
  /** 累积思考链完整文本明细 (展开抽屉时查看) */
  thinkContent: string;
  /** 调用的工具流水明细快照 */
  toolLogs: Array<{
    toolName: string;
    pillTitle: string;
    durationMs: number;
    success: boolean;
  }>;
  /** 思考阶段启动时间戳 (毫秒) */
  startTimeMs: number;
  /** 累计总思考耗时 (秒，保留一位小数，如 "3.2s") */
  elapsedSecondsText: string;
  /** 是否处于用户手动展开明细态 */
  isExpanded: boolean;
}

/**
 * 消息角色身份
 */
export type CopilotRole = 'user' | 'assistant' | 'system';

/**
 * 前端问答流消息视图实体契约
 */
export interface ICopilotMessageItem {
  id: string;
  role: CopilotRole;
  renderedContent: string;
  thinkingPill: IThinkingPillState | null;
  isStreaming: boolean;
  suggestions?: string[];
  timeText: string;
  errorMessage?: string;
}

/**
 * 发送给服务端的对话请求体 DTO
 */
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
}
