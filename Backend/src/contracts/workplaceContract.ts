/**
 * 高校后勤巡查e速办 v4.0 - M50: 飞书工作台微应用矩阵与动态门禁
 * 文件路径: src/contracts/workplaceContract.ts
 * 核心契约: 微应用卡片模型、四象限分组、全景聚合响应 DTO 与用户拖拽排序契约
 */

/**
 * 微应用呈现与交互状态
 * - ACTIVE: 权限完备，彩色高亮呈现，角标跳动，点击直接进入分包
 * - FROSTED_LOCK: 未登录访客毛玻璃微质感锁，点击弹出半屏微信登录授权
 * - RESTRICTED: 已登录但角色或标签不足，置灰灰锁，点击给出友好权限指引
 * - HIDDEN: 物理隐身剔除，不占用界面空间
 */
export type AppAccessStatus = "ACTIVE" | "FROSTED_LOCK" | "RESTRICTED" | "HIDDEN";

/**
 * 微应用所属业务象限
 */
export type AppCategory = "emergency" | "service" | "daily" | "management";

/**
 * 工作台单个微应用卡片展现模型
 */
export interface IWorkplaceAppItem {
  id: number;
  appCode: string;
  name: string;
  icon: string;
  category: AppCategory;
  entryRoute: string;
  accessStatus: AppAccessStatus;
  /** 实时待办角标数字 (0 表示无角标或不显示) */
  badgeCount: number;
  /** 是否已被用户设为首页置顶 */
  isPinned: boolean;
  /** 排序权重 */
  sortOrder: number;
}

/**
 * 四象限业务分组视图模型
 */
export interface IWorkplaceCategoryGroup {
  categoryKey: AppCategory;
  categoryTitle: string;
  subtitle: string;
  icon: string;
  apps: IWorkplaceAppItem[];
}

/**
 * 工作台首页完整聚合下发载荷
 */
export interface IWorkplaceViewResponseDto {
  schoolId: number;
  schoolName: string;
  /** 是否处于未登录访客模式 */
  isGuest: boolean;
  /** 顶部置顶的常用微应用列表 (最多 7 个) */
  pinnedApps: IWorkplaceAppItem[];
  /** 四象限业务分组列表 */
  groups: IWorkplaceCategoryGroup[];
  /** AI Copilot 顶部横幅卡片元数据 */
  aiCopilotBanner: {
    enabled: boolean;
    greeting: string;
    placeholder: string;
    quickPrompts: string[];
  };
}

/**
 * 客户端保存拖拽排序请求载荷
 */
export interface IWorkplaceSortPayloadDto {
  /** 声明置顶微应用的 appCode 列表 (按期望的展示顺序排列) */
  pinnedAppCodes: string[];
  /** 调整过顺序的完整应用 code 列表 */
  orderedAppCodes?: string[];
  /** 别名兼容 */
  pinnedAppKeys?: string[];
}

/**
 * 各子微应用内部角标返回契约
 */
export interface IAppBadgeResponseDto {
  code: number;
  appCode: string;
  badgeCount: number;
  message?: string;
}
