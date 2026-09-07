/**
 * 高校后勤巡查e速办 v4.0 - M32: 诉求责任科室流转与官方正式答复流契约类型
 * (Official Reply Stream & Department Flow Types)
 */

/**
 * 官方正式答复公函实体映射契约
 * 底层基于 post_comments 表存储 (replyCommentId = 0, isOfficial = 1)
 */
export interface IOfficialReplyEntity {
  /** 答复流水自增主键 */
  id: number;
  /** 所属高校学校租户ID */
  schoolId: number;
  /** 关联诉求建言ID (posts.id) */
  postId: number;
  /** 答复责任人自然人ID (users.id) */
  userId: number;
  /** 答复人官方职务头衔 (如: "后勤管理处饮食服务科科长") */
  responderTitle: string;
  /** 责任承办科室ID (departments.id) */
  departmentId: number;
  /** 责任承办科室全称 (如: "后勤处饮食服务中心") */
  departmentName: string;
  /** 官方红色印章图片 URL */
  officialSealUrl: string;
  /** 公函正式标题 (如: "关于梅园餐厅二楼打饭窗口保温问题的整改决定") */
  decreeTitle: string;
  /** 公函富文本详细答复内容 */
  content: string;
  /** 现场实况或整改佐证照片凭证列表 */
  imagesJson: string[] | null;
  /** 承诺整改完成天数 (1 ~ 15 天) */
  promiseDays: number;
  /** 承诺办结绝对截止时间 (格式化字符串 YYYY-MM-DD HH:mm:ss) */
  deadlineAt: string;
  /** 答复出具发布时间 */
  createdAt: string;
  /** 是否软删除: 0 正常, 1 已删除 */
  isDeleted: 0 | 1;
}

/**
 * 诉求在科室间的流转审批流水实体契约
 */
export interface IAppealDeptFlowEntity {
  id: number;
  schoolId: number;
  postId: number;
  fromDeptId: number;
  toDeptId: number;
  operatorUserId: number;
  /** 流转类型: 'AUTO_DISPATCH' | 'CLAIM' | 'REJECT_TO_OFFICE' | 'FORCE_ASSIGN' */
  actionType: 'AUTO_DISPATCH' | 'CLAIM' | 'REJECT_TO_OFFICE' | 'FORCE_ASSIGN';
  /** 流转原由与备注说明 */
  reason: string;
  createdAt: string;
}

/**
 * 科室主管主动认领诉求请求 DTO
 */
export interface IClaimAppealDto {
  appealId: number;
  /** 认领人所在科室ID */
  departmentId: number;
}

/**
 * 综合办公室人工/强制指派科室请求 DTO
 */
export interface IAssignDeptDto {
  appealId: number;
  /** 目标责任科室ID */
  targetDepartmentId: number;
  /** 指派督办备注说明 */
  assignNote: string;
  /** 是否锁定不可退单 (综合办二次仲裁时置为 true) */
  isLocked: boolean;
}

/**
 * 科室不属管辖申请退单仲裁请求 DTO
 */
export interface IRejectDeptDto {
  appealId: number;
  /** 详细退回理由 (必填，至少 5 字) */
  rejectReason: string;
}

/**
 * 科室出具官方正式红头答复请求 DTO
 */
export interface ISubmitReplyRequestDto {
  appealId: number;
  /** 答复公函正式标题 (5 ~ 50 字) */
  decreeTitle: string;
  /** 答复人对外职务头衔 (如: "饮食服务科主管") */
  responderTitle: string;
  /** 官方正式公函正文 (20 ~ 2000 字) */
  content: string;
  /** 现场实况/整改凭证照片 OSS 地址列表 */
  imageUrls?: string[];
  /** 承诺完成整改时限天数 (1 ~ 15 天) */
  promiseDays: number;
}

/**
 * 官方答复出具成功响应 DTO
 */
export interface ISubmitReplyResponseDto {
  replyId: number;
  appealId: number;
  schoolId: number;
  departmentName: string;
  responderTitle: string;
  /** 承诺办结截止时间 */
  deadlineAt: string;
  /** 系统计算生成的数字防伪特征码 (16位) */
  digitalFingerprint: string;
  repliedAt: string;
  statusText: string;
}

/**
 * 感谢卡种类枚举
 * SPEED: ⚡ 神速解决卡
 * WARMTH: 🌸 暖心关怀卡
 * ACTION: 🛠️ 雷厉风行卡
 * PRAISE: 🌟 全五星赞赏卡
 */
export type ThanksCardType = 'SPEED' | 'WARMTH' | 'ACTION' | 'PRAISE';

/**
 * 师生向科室赠送文创感谢卡请求 DTO
 */
export interface ISendThanksCardRequestDto {
  appealId: number;
  /** 感谢卡类型 */
  cardType: ThanksCardType;
  /** 师生真诚评语 (3 ~ 200 字) */
  studentComment: string;
  /** 匿名模式下必须携带本地私钥凭证卡进行防伪校验 */
  vaultToken?: string;
}

/**
 * 赠送感谢卡成功响应 DTO
 */
export interface ISendThanksCardResponseDto {
  cardId: number;
  appealId: number;
  cardType: ThanksCardType;
  cardTypeName: string;
  /** 本次获赠的啄木鸟治理积分 (如 +10) */
  pointsAwarded: number;
  /** 获得的协同治理勋章徽标 (如 "暖心使者") */
  badgeAwarded?: string;
  /** 科室累计获赠感谢卡总数 */
  departmentTotalThanksCount: number;
  createdAt: string;
}

/**
 * 将优秀办结诉求推选至校园公开空间请求 DTO
 */
export interface IPromoteToPublicSpaceDto {
  appealId: number;
  /** 推荐上榜理由 (如: "解决迅速、师生反馈极好，树立后勤为民服务典范") */
  recommendReason: string;
  /** 是否设为公开空间置顶 */
  isTop: boolean;
}

/**
 * 整改承诺 SLA 倒计时督办计算结果
 */
export interface ISlaCountdownResult {
  /** 状态: 绿色正常 | 黄色临期预警(<=24h) | 红色超时违约(<=0h) */
  slaStatus: 'GREEN' | 'YELLOW' | 'RED';
  /** 剩余小时数 (负数表示超时) */
  remainingHours: number;
  /** 超时扣除科室治理效能分 */
  penaltyScore: number;
  /** 状态展示文案 */
  statusText: string;
}

/**
 * 科室规则契约
 */
export interface IDeptRule {
  deptId: number;
  name: string;
  keywords: string[];
  categoryBias: string;
}

/**
 * 智能分派结果
 */
export interface IDispatchResult {
  recommendedDeptId: number;
  recommendedDeptName: string;
  confidence: number;
}

/**
 * ETag 增量版本比对结果
 */
export interface IEtagCheckResult {
  isModified: boolean;
  currentETag: string;
}
