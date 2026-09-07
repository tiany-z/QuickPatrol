/**
 * 高校后勤巡查e速办 v4.0 - M31: 师生诉求提报页面状态契约
 */

export interface IAppealCategoryItem {
  key: "canteen" | "dorm" | "traffic" | "service" | "other";
  name: string;
}

export interface ICreateAppealPageState {
  title: string;
  content: string;
  categoryIndex: number;
  categories: IAppealCategoryItem[];
  isAnonymous: boolean;
  allowPublicDisplay: boolean;
  imageUrls: string[];
  isSubmitting: boolean;
  hasDraft: boolean;
}
