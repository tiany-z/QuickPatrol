/**
 * M26: 师傅端延期申请小程序页面类型契约
 * (Patrol Delay Apply MiniProgram Types)
 */

export interface IDelayHourOption {
  label: string;
  value: number;
}

export interface IDelayApplyPageData {
  patrolId: number;
  orderNo: string;
  currentDeadline: string;
  delayHours: number;
  hoursOptions: IDelayHourOption[];
  customHours: string;
  reason: string;
  evidenceImages: string[];
  predictedDeadline: string;
  submitting: boolean;
}
