/**
 * 高校后勤巡查e速办 v4.0 - M27: 师傅现场完工交卷移动端契约
 */

export interface IHandleSubmitFormData {
  patrolId: number;
  title: string;
  orderNo: string;
  location: string;
  content: string;
  images: string[];
  durationHours: number;
  quickHours: number[];
  submitting: boolean;
  hasDraft: boolean;
}

export interface IWatermarkPhotoEvent {
  ossUrl: string;
}
