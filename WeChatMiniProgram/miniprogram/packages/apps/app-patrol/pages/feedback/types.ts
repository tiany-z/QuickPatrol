/**
 * 高校后勤巡查e速办 v4.0 - M29: 师生满意度五星评价移动端数据契约
 */

export interface IFeedbackFormData {
  patrolId: number;
  orderNo: string;
  title: string;
  location: string;
  handlerName: string;
  score: number;
  speedScore: number;
  qualityScore: number;
  attitudeScore: number;
  presetTags: Array<{ text: string; selected: boolean }>;
  comment: string;
  submitting: boolean;
}
