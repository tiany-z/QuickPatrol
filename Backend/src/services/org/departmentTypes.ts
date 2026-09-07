/**
 * M15: 部门树形拓扑与微前端组织架构中枢 TypeScript 强类型契约
 */

export interface IDepartmentEntity {
  id: number;
  schoolId: number;
  parentId: number | null;
  path: string; // 物化路径，如 "/1/3/7/"
  name: string;
  category: string;
  contactPhone: string;
  leaderId: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: 0 | 1;
}

export interface IDepartmentTreeNodeDto {
  id: number;
  schoolId: number;
  parentId: number | null;
  path: string;
  name: string;
  category: string;
  contactPhone: string;
  leaderId: number | null;
  leaderName?: string; // 关联 users 表扩展字段
  sortOrder: number;
  depth: number;
  children: IDepartmentTreeNodeDto[];
}

export interface IDepartmentFlatItem {
  id: number;
  schoolId: number;
  parentId: number | null;
  path: string;
  name: string;
  category: string;
  contactPhone: string;
  leaderId: number | null;
  leaderName?: string;
  sortOrder: number;
}

export interface ICreateDepartmentDto {
  parentId?: number | null;
  name: string;
  category?: string;
  contactPhone?: string;
  leaderId?: number | null;
  sortOrder?: number;
}

export interface IUpdateDepartmentDto {
  name?: string;
  category?: string;
  contactPhone?: string;
  leaderId?: number | null;
  sortOrder?: number;
}

export interface IRelocateDepartmentRequest {
  departmentId: number;
  targetParentId: number | null; // null 代表提升为全校顶级根部门
}

export interface IRelocateResultDto {
  departmentId: number;
  oldPath: string;
  newPath: string;
  affectedCount: number;
}

export interface ILeaderProbeResult {
  leaderId: number | null;
  inheritedFromDeptId: number | null;
  deptName?: string;
}
