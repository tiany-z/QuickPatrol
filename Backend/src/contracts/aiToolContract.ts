/**
 * 高校后勤巡查e速办 v4.0 - M48: 7 大受控后勤事实数据工具箱
 * 契约定义与数据模型
 */

/**
 * 严格遵循 OpenAI 规范的 JSON Schema 属性定义
 */
export interface IToolJSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: {
    type: string;
  };
}

/**
 * 单个工具对外声明元数据 (向大模型注册时下发)
 */
export interface IToolDeclaration {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, IToolJSONSchemaProperty>;
      required: string[];
    };
  };
}

/**
 * 传递给每个受控工具的强类型安全上下文
 * 严格由框架与 JWT 鉴权中间件装配，杜绝任何外部伪造
 */
export interface IToolExecutionContext {
  /** 当前用户所属学校租户 ID (不可逾越的隔离边界) */
  readonly schoolId: number;
  /** 当前发起提问的操作人自然人 ID */
  readonly userId: number;
  /** 用户角色标识 (如 'student', 'teacher', 'repairman', 'admin') */
  readonly userRole: string;
  /** 用户当前所属主校区 ID (可选) */
  readonly campusId?: number;
  /** 跟踪本次对话生命周期的会话 ID */
  readonly sessionId?: string;
}

/**
 * 工具 1: query_patrol_stats 入参与出参
 */
export interface IQueryPatrolStatsArgs {
  timeRange?: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH';
  campusId?: number;
}
export interface IQueryPatrolStatsResult {
  timeRange: string;
  totalReported: number;
  completedCount: number;
  inProgressCount: number;
  pendingAcceptCount: number;
  slaComplianceRate: string; // 如 "98.5%"
  avgDurationMinutes: number;
}

/**
 * 工具 2: query_patrol_list 入参与出参
 */
export interface IQueryPatrolListArgs {
  keyword?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  urgency?: number;
  limit?: number;
}
export interface IPatrolSummaryItem {
  id: number;
  patrolSn: string;
  title: string;
  location: string;
  categoryName: string;
  urgencyLevel: number;
  statusText: string;
  reportTime: string;
  handlerName?: string;
}

/**
 * 工具 3: query_patrol_detail 入参与出参
 */
export interface IQueryPatrolDetailArgs {
  patrolSnOrId: string;
}
export interface IPatrolDetailFactResult {
  patrolSn: string;
  title: string;
  location: string;
  categoryName: string;
  description: string;
  urgencyLevel: number;
  statusText: string;
  reporterName: string; // 脱敏后
  reporterPhone: string; // 脱敏后
  reportedAt: string;
  handlerName?: string;
  acceptedAt?: string;
  finishedAt?: string;
  handleRemark?: string;
  inspectionResult?: string;
  evaluationStars?: number;
}

/**
 * 工具 4: query_my_patrols 入参与出参
 */
export interface IQueryMyPatrolsArgs {
  statusFilter?: 'ALL' | 'UNRESOLVED' | 'RESOLVED';
}

/**
 * 工具 5: query_campus_and_departments 入参与出参
 */
export interface IQueryCampusDeptArgs {
  campusKeyword?: string;
  serviceCategory?: string;
}
export interface IDepartmentFactItem {
  deptName: string;
  campusName: string;
  officeLocation: string;
  hotlinePhone: string;
  dutyLeader: string;
  serviceScope: string;
}

/**
 * 工具 6: query_post_feeds 入参与出参
 */
export interface IQueryPostFeedsArgs {
  topic?: 'NOTICE' | 'EMERGENCY' | 'ALL';
  keyword?: string;
}
export interface IPostFeedFactItem {
  id: number;
  title: string;
  contentSnippet: string;
  publisherDept: string;
  publishTime: string;
  affectedBuildings?: string;
}

/**
 * 工具 7: query_service_regulations 入参与出参
 */
export interface IQueryServiceRegulationsArgs {
  category?: 'SLA_LIMITS' | 'FREE_OR_CHARGE' | 'FLOW_GUIDE';
  query?: string;
}
export interface IRegulationRuleItem {
  ruleCode: string;
  ruleTitle: string;
  commitmentTimeText: string;
  chargePolicy: string;
  officialClause: string;
}

/**
 * 沙箱最终封包交付给 Agent 的标准结果结构
 */
export interface IToolExecutionResult {
  /** 工具调用是否成功 */
  success: boolean;
  /** 工具名称标识 */
  toolName: string;
  /** 执行消耗时间 (毫秒) */
  durationMs: number;
  /** 格式化后的简要事实文本 (便于前端 Thinking Pill 展示) */
  summaryTitle: string;
  /** 回传给大模型的结构化事实数据载荷 */
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
  /** 若执行失败返回的人性化错误描述 */
  errorMessage?: string;
}
