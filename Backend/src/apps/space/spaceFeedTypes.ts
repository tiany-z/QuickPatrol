/**
 * M33: 双轨合一校园公开空间与免密瀑布流 - 数据类型契约
 */

/**
 * 校园广场公开动态视图聚合实体映射契约
 * 对应 MySQL 预编译只读视图: v_post_feeds (视图 V04)
 */
export interface IVPostFeedEntity {
  /** 动态唯一ID (posts.id) */
  postId: number;
  /** 高校学校租户ID (强制隔离) */
  schoolId: number;
  /** 学校官方全称 (schools.name) */
  schoolName: string;
  /** 
   * 发布人ID (users.id)
   * 匿名建言模式下该值为 0
   */
  creatorId: number;
  /** 发布人对外公开昵称 (匿名模式下由系统映射为虚拟昵称) */
  nickName: string;
  /** 发布人头像 URL */
  avatarUrl: string;
  /** 关联巡查工单ID (0为师生柔性诉求/公告, >0为工程抢修对比) */
  patrolId: number;
  /** 动态正式标题 */
  title: string;
  /** 动态文字正文 */
  content: string;
  /** 图片展示相册 JSON 字符串 (包含原图或整改对比图) */
  imagesJson: string | null;
  /** 累计点赞总频次 */
  likeCount: number;
  /** 累计评论互动总频次 */
  commentCount: number;
  /** 累计全校浏览曝光量 */
  viewCount: number;
  /** 是否官方置顶: 0普通, 1置顶 */
  isTop: 0 | 1;
  /** 动态创建时间 (格式化 YYYY-MM-DD HH:mm:ss 或 ISO) */
  createdAt: string;
}

/**
 * 双轨瀑布流动态卡片类型
 */
export type SpaceCardTrackType = "REPAIR" | "OFFICIAL_REPLY" | "NOTICE";

/**
 * 轨 A: 抢修前后双图对比载荷
 */
export interface IRepairCompareDto {
  patrolId: number;
  beforeImageUrl: string;
  afterImageUrl: string;
  durationHours: number;
  handlerTag: string;
}

/**
 * 轨 B: 官方红头正式答复公函载荷
 */
export interface IOfficialDecreeDto {
  replyDeptName: string;
  responderTitle: string;
  sealUrl: string;
  promiseDays: number;
  remainingDaysText: string;
  hasThanksCard: boolean;
  thanksCardType?: string;
}

/**
 * 单条瀑布流卡片结构化呈现载荷
 */
export interface ISpaceFeedCardDto {
  postId: number;
  trackType: SpaceCardTrackType;
  title: string;
  content: string;
  displayLocation?: string;
  creatorName: string;
  creatorAvatar: string;
  isTop: boolean;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createdAt: string;
  /** 轨 A: 抢修前后双图对比载荷 (当 trackType === 'REPAIR' 时提供) */
  repairCompare?: IRepairCompareDto;
  /** 轨 B: 官方红头正式答复公函载荷 (当 trackType === 'OFFICIAL_REPLY' 时提供) */
  officialDecree?: IOfficialDecreeDto;
  /** 随附展示实景照片相册 */
  albumImages: string[];
  /** 热度推导分值 (可选) */
  gravityScore?: number;
}

/**
 * 免密拉取公开瀑布流请求 DTO
 */
export interface IPublicFeedQueryDto {
  /** 学校唯一英文代号 (如: lcu, pku) */
  schoolCode?: string;
  /** 当前分页页码 (从 1 开始) */
  page?: number;
  /** 每页条数 (默认 20，上限 50) */
  pageSize?: number;
  /** 筛选轨道分类 (all:全部双轨混排, repair:仅看工程抢修, reply:仅看官方答复公函) */
  filterTrack?: "all" | "repair" | "reply";
  /** 排序模式 (latest: 最新, hot: 基于 Hacker News 重力热榜) */
  sortBy?: "latest" | "hot";
}

/**
 * 瀑布流响应结果 DTO
 */
export interface IPublicFeedListDto {
  schoolId: number;
  schoolName: string;
  totalCount: number;
  currentPage: number;
  hasMore: boolean;
  cards: ISpaceFeedCardDto[];
  fromCache?: boolean;
}

/**
 * 访客点赞请求 DTO
 */
export interface IGuestLikeRequestDto {
  postId: number;
  /** 客户端设备指纹特征码 (通过前端 Canvas/屏幕尺寸/UA 计算生成) */
  clientFingerprint: string;
}

/**
 * 访客点赞响应 DTO
 */
export interface IGuestLikeResponseDto {
  postId: number;
  currentLikeCount: number;
  isLiked: boolean;
  message: string;
}

/**
 * 访客快捷留言发表请求 DTO
 */
export interface IGuestCommentRequestDto {
  postId: number;
  /** 访客填写的公开昵称 (如: "大二热心同学") */
  guestNick?: string;
  /** 访客选择的临时微信公开头像 URL */
  guestAvatar?: string;
  /** 留言文字正文 (2 ~ 300 字) */
  commentContent: string;
}

/**
 * 访客留言发表响应 DTO
 */
export interface IGuestCommentResponseDto {
  commentId: number;
  postId: number;
  guestNick: string;
  guestAvatar: string;
  commentContent: string;
  createdAt: string;
}

/**
 * 热榜评分候选项
 */
export interface IRankingScoreItem {
  postId: number;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  isTop: boolean;
  hasOfficialReply: boolean;
  hasThanksCard: boolean;
  createdAt: string | number;
}
