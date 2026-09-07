/**
 * 高校后勤巡查e速办 v4.0 - M32: 诉求建言与官方答复公函详情页面模型
 */

export interface IOfficialReplyView {
  replyId: number;
  decreeTitle: string;
  responderTitle: string;
  departmentName: string;
  promiseDays: number;
  deadlineAt: string;
  digitalFingerprint: string;
  body: string;
  images: string[];
  createdAt: string;
}

export interface IThanksCardItemView {
  cardId: number;
  cardType: string;
  cardTypeName: string;
  studentComment: string;
  pointsAwarded: number;
  createdAt: string;
}

export interface IAppealDetailView {
  id: number;
  schoolId: number;
  title: string;
  content: string;
  creatorId: number;
  status: number;
  isTop: number;
  targetDeptId?: number;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  officialReply: IOfficialReplyView | null;
  thanksCards: IThanksCardItemView[];
  commentsCount: number;
}
