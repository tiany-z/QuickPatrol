/**
 * 高校后勤巡查e速办 v4.0 - M30: 工单全景大宽表详情视图前端类型契约
 */

export interface IPatrolActionPermissions {
  canTake: boolean;
  canHandle: boolean;
  canDelay: boolean;
  canTransfer: boolean;
  canChat: boolean;
  canReview: boolean;
  canFeedback: boolean;
  canAbort: boolean;
  canUrge: boolean;
}

export interface IBeforeAfterPair {
  hasPair: boolean;
  beforeImageUrl: string;
  afterImageUrl: string;
}

export interface ITimelineNode {
  stageKey: string;
  title: string;
  timestamp: string;
  operatorName: string;
  summaryText: string;
}

export interface IPatrolDetailData {
  patrolId: number;
  orderNo: string;
  schoolId: number;
  schoolName: string;
  campusName: string;
  categoryName: string;
  title: string;
  desc: string;
  location: string;
  status: number;
  statusText: string;
  priorityLevel: number;
  priorityText: string;
  deadline: string;
  createdAt: string;
  creator: {
    id: number;
    name: string;
    phone: string;
  };
  handler: {
    id: number;
    name: string;
    phone: string;
  } | null;
  permissions: IPatrolActionPermissions;
  visualPair: IBeforeAfterPair;
  images: string[];
  timeline: ITimelineNode[];
  delayRecordsCount: number;
  handleRoundsCount: number;
  reviewRoundsCount: number;
  hasFeedback: boolean;
}
