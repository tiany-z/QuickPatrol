/**
 * M34: 广场动态访客免密评论与令牌桶防刷风控 - 数据类型契约
 */

/**
 * 校园广场动态评论实体映射契约
 * 对应底层物理表: post_comments (表 16)
 */
export interface IPostCommentEntity {
  /** 评论唯一ID (主键自增) */
  id: number;
  /** 学校租户唯一ID (多租户隔离) */
  schoolId: number;
  /** 关联广场动态ID (逻辑关联 posts.id) */
  postId: number;
  /** 
   * 评论发表人ID (关联 users.id)
   * 0: 免密访客身份 (结合 guestNick / guestAvatar 展示)
   * >0: 已登录在校师生职工身份
   */
  userId: number;
  /** 访客填写的公开临时昵称 (如: "东昌湖畔读者") */
  guestNick: string;
  /** 访客选择的临时微信头像图片 URL */
  guestAvatar: string;
  /** 
   * 回复上级评论ID
   * 0: 顶层根评论 (Root Comment)
   * >0: 回复某条具体评论 (楼中楼子评论)
   */
  replyCommentId: number;
  /** 评论正文字符串 (已清洗脱敏) */
  content: string;
  /** 评论发表时间 (格式化 YYYY-MM-DD HH:mm:ss 或 ISO) */
  createdAt: string;
  /** 软删除状态标记: 0正常显示, 1已违规下架/已删除 */
  isDeleted: 0 | 1;
}

/**
 * 单条评论基础展示载荷
 */
export interface ICommentItemDto {
  commentId: number;
  postId: number;
  isGuest: boolean;
  authorName: string;
  authorAvatar: string;
  content: string;
  replyToNick?: string; // 被回复人昵称 (二级回复有效)
  createdAtText: string; // 如 "刚刚", "10分钟前", "昨天"
}

/**
 * 两级收敛楼中楼完整卡片 DTO
 */
export interface ICommentThreadDto {
  /** 根评论节点 */
  rootComment: ICommentItemDto;
  /** 二级嵌套子回复列表 (预加载前 5 条，支持展开更多) */
  subReplies: ICommentItemDto[];
  /** 该根评论下的子回复总数 */
  totalSubCount: number;
}

/**
 * 访客/师生发表评论请求 DTO
 */
export interface ICreateCommentRequestDto {
  /** 目标动态 ID */
  postId: number;
  /** 回复的上级评论 ID (若为根评论则传 0) */
  replyCommentId?: number;
  /** 访客临时昵称 (未登录可选，默认赋予阳光化昵称) */
  guestNick?: string;
  /** 访客临时头像 URL */
  guestAvatar?: string;
  /** 评论内容正文 (2 ~ 500 字) */
  content: string;
  /** 客户端设备特征指纹 (用于防刷风控辅助) */
  clientFingerprint?: string;
}

/**
 * 评论发表成功响应 DTO
 */
export interface ICreateCommentResponseDto {
  commentId: number;
  postId: number;
  replyCommentId: number;
  authorName: string;
  authorAvatar: string;
  content: string;
  createdAtText: string;
  statusText: string;
}

/**
 * 分页拉取评论请求 DTO
 */
export interface IQueryCommentsRequestDto {
  postId: number;
  page?: number;
  pageSize?: number;
}

/**
 * 评论分页列表响应 DTO
 */
export interface ICommentListResponseDto {
  postId: number;
  totalRootCount: number;
  totalCommentCount: number;
  currentPage: number;
  hasMore: boolean;
  threads: ICommentThreadDto[];
}

/**
 * 管理员软删除违规评论请求 DTO
 */
export interface IDeleteCommentRequestDto {
  commentId: number;
  postId?: number;
  /** 违规下架处置理由 */
  deleteReason?: string;
}
