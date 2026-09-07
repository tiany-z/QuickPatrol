/**
 * 小程序端 校园公开空间 类型契约
 */

export interface ISpaceFeedCardDto {
  postId: number;
  trackType: "REPAIR" | "OFFICIAL_REPLY" | "NOTICE";
  title: string;
  content: string;
  displayLocation?: string;
  creatorName: string;
  creatorAvatar: string;
  isTop: boolean;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createdAt: string;
  repairCompare?: {
    patrolId: number;
    beforeImageUrl: string;
    afterImageUrl: string;
    durationHours: number;
    handlerTag: string;
  };
  officialDecree?: {
    replyDeptName: string;
    responderTitle: string;
    sealUrl: string;
    promiseDays: number;
    remainingDaysText: string;
    hasThanksCard: boolean;
    thanksCardType?: string;
  };
  albumImages: string[];
  gravityScore?: number;
}

export interface IStreamPageData {
  schoolCode: string;
  schoolName: string;
  page: number;
  pageSize: number;
  activeTrack: "all" | "repair" | "reply";
  activeSort: "latest" | "hot";
  leftColumnCards: ISpaceFeedCardDto[];
  rightColumnCards: ISpaceFeedCardDto[];
  leftHeight: number;
  rightHeight: number;
  isLoading: boolean;
  hasMore: boolean;
  selectedPostIdForComment: number;
  showCommentSheet: boolean;
}
