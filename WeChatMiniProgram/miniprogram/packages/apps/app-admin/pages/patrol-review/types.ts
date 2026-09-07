/**
 * 高校后勤巡查e速办 v4.0 - M28: 质检复核到场核验移动端数据契约
 */

export interface IPatrolReviewFormData {
  patrolId: number;
  title: string;
  orderNo: string;
  location: string;
  handlerName: string;
  beforeImages: string[]; // 报修现场原状照片
  afterImages: string[];  // 师傅整改实拍照片
  handleContent: string;  // 师傅施工说明
  isPassed: number;       // 1: 合格通过, 0: 不合格驳回
  remark: string;         // 质检专家核验意见
  reviewImages: string[]; // 质检现场核验拍摄实证 (0~9张)
  submitting: boolean;
  historyRounds: number;
}

export interface IReviewSubmitPayload {
  patrolId: number;
  isPassed: number;
  remark: string;
  images: string[];
}
