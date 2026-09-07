/**
 * M24: 师傅现场抢修看板类型契约
 * (Master Desk Task Pool MiniProgram Types)
 */

export type MasterDeskTab = "pool" | "assigned" | "inProgress" | "review";

export interface IMasterWorkbenchSummary {
  poolCount: number;
  assignedCount: number;
  inProgressCount: number;
  reviewCount: number;
}

export interface IMasterTaskCard {
  id: number;
  orderNo: string;
  title: string;
  desc: string;
  categoryId: number;
  categoryName: string;
  campusId: number;
  campusName: string;
  location: string;
  priorityLevel: 0 | 1 | 2;
  status: number;
  statusText: string;
  createdAt: string;
  deadline: string;
  remainingHours: number;
  isUrgentNotice: boolean;
  slaScore: number;
  images: string[];
  creatorName: string;
}

export interface ITaskPoolPageData {
  activeTab: MasterDeskTab;
  summary: IMasterWorkbenchSummary;
  taskList: IMasterTaskCard[];
  isLoading: boolean;
  page: number;
  hasMore: boolean;
  isClaiming: boolean;
  // 改派弹窗状态
  isTransferModalVisible: boolean;
  transferPatrolId: number;
  transferOrderNo: string;
  transferType: "CATEGORY_MISMATCH" | "PEER_HANDOVER";
  newCategoryId: number;
  transferReason: string;
  categoriesList: Array<{ id: number; name: string }>;
  categoryIndex: number;
}
