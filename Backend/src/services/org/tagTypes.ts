/**
 * M16: 岗位职能标签中台与“权限随岗不随人”调度 TypeScript 强类型契约
 */

export interface ITagEntity {
  id: number;
  schoolId: number;
  name: string;
  color: string; // Hex, 如 "#D83B01"
  desc: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: 0 | 1;
}

export interface ITagMemberEntity {
  id: number;
  schoolId: number;
  tagId: number;
  userId: number;
  createdAt: string;
}

export interface ITagMemberSummaryDto {
  userId: number;
  realName: string;
  phone: string;
  jobNo: string;
  userStatus: number; // 0正常, 1封禁
  assignedAt: string;
}

export interface ITagAssignmentDto {
  tagId: number;
  schoolId: number;
  tagName: string;
  tagColor: string;
  tagDesc: string;
  sortOrder: number;
  activeMembersCount: number;
  members: ITagMemberSummaryDto[];
  authorizedScopes: {
    campusNames: string[];
    categoryNames: string[];
  };
}

export interface ICreateTagDto {
  name: string;
  color?: string; // 可选，不传则算法自适应分配
  desc?: string;
  sortOrder?: number;
  initialMemberUserIds?: number[];
}

export interface IUpdateTagDto {
  name?: string;
  color?: string;
  desc?: string;
  sortOrder?: number;
}

export interface IHandoverTagRequest {
  tagId: number;
  fromUserId: number;
  toUserId: number;
  reason?: string;
}

export interface IHandoverResultDto {
  tagId: number;
  tagName: string;
  fromUserId: number;
  fromUserName: string;
  toUserId: number;
  toUserName: string;
  transferredAt: string;
}

export interface IDynamicWorklistQuery {
  schoolId: number;
  userId: number;
  page?: number;
  pageSize?: number;
}

export interface IPatrolWorklistItemDto {
  id: number;
  orderNo: string;
  title: string;
  status: number;
  priority: number;
  campusId: number;
  categoryId: number;
  location1: string;
  location2: string;
  createdAt: string;
  currentHandlerId: number | null;
  tagId: number | null;
  categoryName?: string;
  campusName?: string;
  tagBadge?: {
    name: string;
    color: string;
  } | null;
}
