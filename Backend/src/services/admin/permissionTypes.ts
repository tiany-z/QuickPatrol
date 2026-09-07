/**
 * M18: 四级立体权限矩阵与校内网格化授权 TypeScript 强类型契约
 */

export interface IPermissionEntity {
  id: number;
  schoolId: number;
  userId: number; // 0 代表按标签调度
  tagId: number | null; // 关联 tags.id
  campusId: number; // 0 代表全校通配
  categoryId: number; // 0 代表全分类通配
  type: 1 | 2 | 3; // 1: 工单责任人/施工处理人, 2: 验收复核人/现场到场质检, 3: 业务监督人/抄送报表查看人
  createdAt?: string;
}

export interface IGridAxisCampusDto {
  campusId: number; // 0 为全校通配
  campusName: string;
  isWildcard: boolean;
}

export interface IGridAxisCategoryDto {
  categoryId: number; // 0 为全门类通配
  categoryName: string;
  isWildcard: boolean;
}

export interface IPermissionGridCellDto {
  cellKey: string; // "campusId_categoryId_type"
  campusId: number;
  categoryId: number;
  type: 1 | 2 | 3;
  assignments: Array<{
    ruleId: number;
    assignmentType: "user" | "tag";
    targetId: number;
    targetName: string;
    targetColor?: string; // 岗位标签附带的 Metro UI 色值
  }>;
}

export interface IPermissionMatrixResponse {
  schoolId: number;
  campuses: IGridAxisCampusDto[];
  categories: IGridAxisCategoryDto[];
  gridCells: Record<string, IPermissionGridCellDto>;
}

export interface IBatchGrantPermissionRequest {
  targetType: "user" | "tag";
  targetId: number;
  type: 1 | 2 | 3; // 1处理人, 2复核人, 3抄送人
  /** 期望点亮的网格单元格坐标列表 */
  gridPoints: Array<{
    campusId: number; // 0 代表全校通配
    categoryId: number; // 0 代表全分类通配
  }>;
}

export interface IGrantResultDto {
  addedCount: number;
  redundantCount: number;
  createdRuleIds: number[];
}

export interface IRevokePermissionRequest {
  ruleId: number;
}
