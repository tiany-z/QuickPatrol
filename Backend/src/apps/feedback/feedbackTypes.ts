/**
 * 高校后勤巡查e速办 v4.0 - M29: 满意度五星评价与超时自动好评结案类型契约
 * 严格遵照物理表 10 feedbacks 与业务契约设计
 */

/**
 * 物理表 feedbacks (表 10) 强类型实体契约
 */
export interface IFeedbackEntity {
  /** 评价主键ID (自增) */
  id: number;
  /** 所属学校ID (租户隔离) */
  schoolId: number;
  /** 关联工单ID (逻辑关联 patrols.id, 联合唯一) */
  patrolId: number;
  /** 评价人用户ID (逻辑关联 users.id, 0 为系统超时自动代结) */
  userId: number;
  /** 综合评分 (1~5 星, CHECK) */
  score: number;
  /** 响应时效评分 (1~5 星, CHECK) */
  speedScore: number;
  /** 施工质量评分 (1~5 星, CHECK) */
  qualityScore: number;
  /** 服务态度评分 (1~5 星, CHECK) */
  attitudeScore: number;
  /** 用户心得评语 (LONGTEXT) */
  comment: string;
  /** 满意度标签数组 (JSON Array) */
  tagsJson: string[];
  /** 是否为超时未评系统自动默认好评: 0自主评价, 1系统自动 */
  isAutoPassed: 0 | 1;
  /** 评价提交时间 (ISO8601 或字符串) */
  createdAt: string;
}

/**
 * 师生提交服务评价请求载荷 DTO
 */
export interface ISubmitFeedbackRequestDto {
  /** 综合星级评分 (1~5) */
  score: number;
  /** 响应时效星级 (1~5, 选填, 默认等于 score) */
  speedScore?: number;
  /** 施工质量星级 (1~5, 选填, 默认等于 score) */
  qualityScore?: number;
  /** 服务态度星级 (1~5, 选填, 默认等于 score) */
  attitudeScore?: number;
  /** 用户心得评语 (最长 500 字符) */
  comment?: string;
  /** 勾选的满意度标签列表 (最多 5 个) */
  tags?: string[];
}

/**
 * 评价成功响应 DTO
 */
export interface ISubmitFeedbackResponseDto {
  /** 生成的评价记录ID */
  feedbackId: number;
  /** 工单ID */
  patrolId: number;
  /** 最终记录的综合评分 */
  effectiveScore: number;
  /** 是否触发差评告警 */
  isNegativeAlertTriggered: boolean;
  /** 评价提交时间 ISO8601 */
  evaluatedAt: string;
}

/**
 * 工单评价详情视图 DTO
 */
export interface IFeedbackDetailDto {
  feedbackId: number;
  patrolId: number;
  evaluatorId: number;
  evaluatorName: string;
  score: number;
  speedScore: number;
  qualityScore: number;
  attitudeScore: number;
  comment: string;
  tags: string[];
  isAutoPassed: boolean;
  createdAt: string;
}

/**
 * 师傅个人口碑档案与星级画像 DTO
 */
export interface IMasterReputationProfileDto {
  masterId: number;
  masterName: string;
  /** 累计评价总单数 */
  totalEvaluations: number;
  /** 综合平均得分 (保留一位小数, 如 4.9) */
  averageScore: number;
  /** 各子维度平均分 */
  dimensionAverages: {
    speed: number;
    quality: number;
    attitude: number;
  };
  /** 五星好评率 (score >= 4 的百分比, 0~100) */
  positiveRate: number;
  /** Top 3 热门高频标签 */
  topTags: Array<{ tag: string; count: number }>;
  /** 净推荐值 NPS (-100 ~ 100) */
  nps: number;
}
