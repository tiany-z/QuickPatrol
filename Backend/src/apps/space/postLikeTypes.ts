/**
 * M35: 广场动态点赞互动与官方公告置顶 强类型接口契约与数据模型定义
 */

/**
 * 广场动态点赞流水实体映射契约
 * 对应底层物理表: post_likes (表 17)
 */
export interface IPostLikeEntity {
  /** 点赞流水自增主键 */
  id: number;
  /** 所属高校学校租户ID */
  schoolId: number;
  /** 关联广场动态ID (posts.id) */
  postId: number;
  /** 点赞人用户ID (关联 users.id) */
  userId: number;
  /** 点赞时间 (格式化 YYYY-MM-DD HH:mm:ss) */
  createdAt: string;
}

/**
 * 官方重大公告扩展属性契约 (保存在 posts.configJson 中)
 */
export interface IOfficialNoticeConfigJson {
  /** 明确声明为官方重大通告 */
  isOfficialNotice: boolean;
  /** 紧急程度: 'NORMAL' (日常白皮书) | 'URGENT' (重要通知) | 'CRITICAL' (突发停水停电) */
  urgencyLevel: 'NORMAL' | 'URGENT' | 'CRITICAL';
  /** 发布科室全称 (如: "后勤管理处能源保障科") */
  publishDeptName: string;
  /** 官方置顶到期时间 (逾期自动下沉) */
  topExpireAt: string;
  /** 是否需要全校微信小程序首页悬浮弹窗通告 */
  broadcastPopup: boolean;
}

/**
 * 切换点赞状态请求 DTO
 */
export interface IToggleLikeRequestDto {
  /** 目标动态 ID */
  postId: number;
}

/**
 * 切换点赞状态响应 DTO
 */
export interface IToggleLikeResponseDto {
  postId: number;
  /** 操作后的最新点赞状态: true 为已赞，false 为已取消赞 */
  isLiked: boolean;
  /** 动态当前最新的有效点赞总量 */
  currentLikeCount: number;
  /** 提示文案: 如 "点赞成功" 或 "已取消点赞" */
  message: string;
}

/**
 * 发布官方重大置顶通告请求 DTO (需校级管理员或后勤处长权限 role >= 3)
 */
export interface IPublishOfficialNoticeDto {
  /** 公告正式通告标题 (5 ~ 60 字) */
  title: string;
  /** 通告详细白皮书富文本正文 (20 ~ 3000 字) */
  content: string;
  /** 附带展示图表/现场施工进度相册 */
  imageUrls?: string[];
  /** 紧急程度: 'NORMAL' | 'URGENT' | 'CRITICAL' */
  urgencyLevel?: 'NORMAL' | 'URGENT' | 'CRITICAL';
  /** 承办责任科室 ID */
  departmentId?: number;
  /** 计划置顶持续天数 (1 ~ 30 天，默认 7 天) */
  topDurationDays?: number;
  /** 是否需要全校弹窗重要广播 */
  broadcastPopup?: boolean;
}

/**
 * 发布官方置顶通告响应 DTO
 */
export interface IPublishNoticeResponseDto {
  postId: number;
  schoolId: number;
  title: string;
  isTop: boolean;
  topExpireAt: string;
  urgencyLevel: string;
  publishedAt: string;
  statusText: string;
}

/**
 * 广场首屏置顶通告横幅卡片展示 DTO
 */
export interface ITopNoticeBannerDto {
  noticeId: number;
  title: string;
  contentSummary: string;
  urgencyLevel: 'NORMAL' | 'URGENT' | 'CRITICAL';
  publishDeptName: string;
  publishedAtText: string;
  topExpireAt: string;
  isExpired: boolean;
  bannerTag: string; // 如 "【后勤重大白皮书】" 或 "【突发检修紧急通告】"
}
