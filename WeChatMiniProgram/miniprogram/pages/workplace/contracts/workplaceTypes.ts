/**
 * 高校后勤巡查e速办 v4.0 - M50: 飞书工作台微应用矩阵与动态门禁
 * 文件路径: miniprogram/pages/workplace/contracts/workplaceTypes.ts
 * 小程序端数据模型契约
 */

export type AppAccessStatus = "ACTIVE" | "FROSTED_LOCK" | "RESTRICTED" | "HIDDEN";

export type AppCategory = "emergency" | "service" | "daily" | "management";

export interface IWorkplaceAppItem {
  id: number;
  appCode: string;
  name: string;
  icon: string;
  category: AppCategory;
  entryRoute: string;
  accessStatus: AppAccessStatus;
  badgeCount: number;
  isPinned: boolean;
  sortOrder: number;
}

export interface IWorkplaceCategoryGroup {
  categoryKey: AppCategory;
  categoryTitle: string;
  subtitle: string;
  icon: string;
  apps: IWorkplaceAppItem[];
}

export interface IWorkplaceViewResponseDto {
  schoolId: number;
  schoolName: string;
  isGuest: boolean;
  pinnedApps: IWorkplaceAppItem[];
  groups: IWorkplaceCategoryGroup[];
  aiCopilotBanner: {
    enabled: boolean;
    greeting: string;
    placeholder: string;
    quickPrompts: string[];
  };
}

export interface IWorkplaceSortPayloadDto {
  pinnedAppKeys: string[];
  pinnedAppCodes?: string[];
  orderedAppCodes?: string[];
}
