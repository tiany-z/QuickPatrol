/**
 * 高校后勤巡查e速办 v4.0 - M31: 师生诉求与绝对匿名加盐散列保险箱契约类型
 * (Confidential Feedback Appeal & Vault Types)
 */

/**
 * 师生诉求与校园建言献策数据库实体映射契约
 * 对应底层物理表: posts (表15)
 */
export interface IConfidentialAppealEntity {
  /** 动态诉求自增ID (主键) */
  id: number;
  /** 所属高校学校租户ID (强制多租户隔离) */
  schoolId: number;
  /** 
   * 发布人自然人ID (users.id)
   * 绝对匿名模式下: 物理强置为 0，彻底切断外键溯源链条
   * 实名模式下: 关联真实提报人 users.id
   */
  creatorId: number;
  /** 关联巡查工单ID: 师生柔性建言固定为 0 */
  patrolId: number;
  /** 建言诉求标题 (如: "关于梅园餐厅二楼打饭窗口分量不足与卫生建议") */
  title: string;
  /** 建言诉求详细描述正文 */
  content: string;
  /** 现场照片凭证 OSS 地址数组 (JSON Array) */
  imagesJson: string | null;
  /** 浏览频次 */
  viewCount: number;
  /** 点赞频次 (支持公开后师生互动) */
  likeCount: number;
  /** 评论与追问频次 */
  commentCount: number;
  /** 
   * 状态机: 
   * 1: 正常受理工单/公开展示, 0: 待科室认领/审核中, -1: 违规下架/驳回作废
   */
  status: 1 | 0 | -1;
  /** 是否全校置顶: 0普通, 1置顶 */
  isTop: 0 | 1;
  /** 创建时间 (格式化 YYYY-MM-DD HH:mm:ss) */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 软删除标记: 0正常, 1已删除 */
  isDeleted: 0 | 1;
}

/**
 * 凭证卡内部解密载荷契约
 */
export interface IVaultTokenPayload {
  postId: number;
  schoolId: number;
  anonymousHash: string;
  nonceSalt: string;
  createdAt: number;
}

/**
 * 师生提报诉求建言请求 DTO
 */
export interface ICreateAppealRequestDto {
  /** 学校唯一租户标识 */
  schoolCode?: string;
  /** 校区ID */
  campusId?: number;
  /** 诉求所属分类 (canteen:食堂, dorm:宿舍, traffic:交通, service:作风, other:其他) */
  categoryType: "canteen" | "dorm" | "traffic" | "service" | "other";
  /** 建议流转直达的目标科室ID (可选) */
  targetDepartmentId?: number;
  /** 建言标题 (5 ~ 60 字) */
  title: string;
  /** 建言详细内容 (10 ~ 1000 字) */
  content: string;
  /** 现场实况照片列表 */
  imageUrls?: string[];
  /** 核心开关: 是否开启【绝对匿名隐私保险箱】模式 */
  isAnonymous: boolean;
  /** 是否授权在答复办结后公开推送至【校园公开空间】 */
  allowPublicDisplay?: boolean;
  /** 实名模式下提报人联系电话 (匿名模式下必须传空或被服务端强制剥除) */
  contactPhone?: string;
}

/**
 * 诉求提报成功响应 DTO
 */
export interface ICreateAppealResponseDto {
  /** 诉求自增工单编号 */
  appealId: number;
  /** 租户学校ID */
  schoolId: number;
  /** 状态文本说明 */
  statusText: string;
  /** 是否已开启绝对匿名保护 */
  isAnonymous: boolean;
  /** 
   * 客户端追踪私钥凭证卡 (Vault Token)
   * 仅在 isAnonymous === true 时由服务端经过 AES-256-GCM 签发回传
   */
  vaultToken?: string;
  /** 提交时间存根 */
  submittedAt: string;
}

/**
 * 凭客户端 Vault Token 批量追溯诉求进展请求 DTO
 */
export interface IBatchQueryByTokensRequestDto {
  /** 学校代号 */
  schoolCode?: string;
  /** 客户端本地持久化存储的 Vault Token 列表 (支持单次最多查询 50 个) */
  vaultTokens: string[];
}

/**
 * 官方正式答复模型
 */
export interface IOfficialReplyDto {
  replyId: number;
  replyDeptName: string;
  responderTitle: string; // 如 "后勤处饮食科科长"
  replyContent: string;   // 官方富文本正式答复
  promiseDays: number;    // 承诺整改完成时限天数
  repliedAt: string;
}

/**
 * 追问线程单项模型
 */
export interface IInquiryThreadDto {
  threadId: number;
  isFromStudent: boolean; // true: 提报学生追问, false: 科室官方回音
  senderName: string;     // 如 "匿名提报人" 或 "科室跟进人"
  content: string;
  createdAt: string;
}

/**
 * 单条诉求的最新进展聚合详情
 */
export interface IAnonymousAppealDetailDto {
  /** 诉求唯一ID (postId) */
  appealId: number;
  /** 诉求标题 */
  title: string;
  /** 诉求内容 */
  content: string;
  /** 现场图片 */
  imageUrls: string[];
  /** 诉求分类标识及中文名 */
  categoryType: string;
  categoryName: string;
  /** 提报时间 */
  createdAt: string;
  /** 办理状态 (0: 待认领分派, 1: 科室正在核实处理, 2: 官方已正式答复, -1: 违规不予受理) */
  processStatus: 0 | 1 | 2 | -1;
  /** 承办责任科室名称 */
  handlingDeptName?: string;
  /** 官方最新正式答复详情 */
  officialReply?: IOfficialReplyDto;
  /** 师生针对官方答复的追问沟通记录列表 */
  inquiryThreads: IInquiryThreadDto[];
}

/**
 * 师生凭借私钥凭证针对答复追加追问请求 DTO
 */
export interface IAppendInquiryRequestDto {
  /** 诉求ID */
  appealId: number;
  /** 客户端持有的私钥凭证卡 (服务端强制校验是否与该 appealId 强绑定) */
  vaultToken: string;
  /** 追问内容文本 (5 ~ 500 字) */
  inquiryContent: string;
  /** 补充追问现场照片 */
  imageUrls?: string[];
}

/**
 * 追问响应 DTO
 */
export interface IAppendInquiryResponseDto {
  /** 新建的对话流水号 ID */
  threadId: number;
  /** 诉求ID */
  appealId: number;
  /** 追问时间 */
  createdAt: string;
  /** 状态提示 */
  message: string;
}
