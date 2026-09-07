/**
 * M09: 飞书式 4-Tab 导航中枢与微前端路由守卫 (TabBar & Router Guard)
 * 强类型接口契约与数据模型定义
 */

/** 角色二进制位掩码常数定义 */
export enum RoleBitmask {
  GUEST = 1 << 0, // 00000001 (1) - 未登录访客
  STUDENT = 1 << 1, // 00000010 (2) - 学生
  STAFF = 1 << 2, // 00000100 (4) - 教职工
  WORKER = 1 << 3, // 00001000 (8) - 维保师傅
  INSPECTOR = 1 << 4, // 00010000 (16) - 质检复核员
  SUPERVISOR = 1 << 5, // 00100000 (32) - 科室主管
  ADMIN = 1 << 6, // 01000000 (64) - 校管理员
  ROOT = 1 << 7, // 10000000 (128) - 平台超管
}

/** 微应用路由元数据契约 */
export interface IMicroAppRoute {
  /** 微应用唯一标识 (如 "app-patrol", "app-feedback") */
  appId: string;
  /** 微应用中文名称 */
  name: string;
  /** 微应用矢量图标 */
  icon: string;
  /** 分包入口绝对路径 (如 "/sub-patrol/pages/create") */
  entryPath: string;
  /** 准入需要的角色位掩码 (如 RoleBitmask.STUDENT | RoleBitmask.STAFF) */
  requiredRoleMask: number;
  /** 是否属于免密公开应用 (如校园指南) */
  isPublic: boolean;
  /** 未登录拦截时向用户展示的说明文案 */
  loginPromptText?: string;
  /** 动态角标数量 */
  badgeCount?: number;
}

/** 挂起意图与拦截上下文契约 */
export interface IPendingIntent {
  /** 触发拦截的微应用 ID */
  appId: string;
  /** 目标跳转 URL (包含分包路径与查询参数) */
  url: string;
  /** 查询参数键值对 */
  query?: Record<string, any>;
  /** 挂起时间戳 */
  timestamp: number;
}

/** 底部 TabBar 项配置契约 */
export interface ITabBarItem {
  /** 页面路由路径 */
  pagePath: string;
  /** 标题文案 (如 "消息", "工作台", "日历", "AI") */
  text: string;
  /** 未激活态默认图标 */
  iconPath: string;
  /** 激活态高亮图标 */
  selectedIconPath: string;
  /** 动态未读红点数字 (0 不显示, -1 纯红点, >0 显示数字) */
  badgeCount: number;
}

/** 用户认证数据模型 */
export interface IAuthUser {
  userId: number;
  openId: string;
  boundPhone: string;
  realName: string;
  role: number;
  roleName: string;
  roleMask: number; // 当前用户的复合角色位掩码
  schoolId: number;
  schoolName: string;
  token: string;
}

/** 全局认证状态 Store 契约 */
export interface IAuthState {
  /** 是否已登录认证 */
  isLoggedIn: boolean;
  /** 当前用户信息 (未登录时为 null) */
  user: IAuthUser | null;
  /** 当前高校租户 ID */
  currentSchoolId: number;
  /** 当前活动工作视角: 1师生巡查端, 2师傅施工端 */
  activeType?: 1 | 2;
  /** 用户有资格切换的全部身份列表 */
  availableIdentities?: Array<{ type: 1 | 2; typeName: string; desc: string }>;
}

