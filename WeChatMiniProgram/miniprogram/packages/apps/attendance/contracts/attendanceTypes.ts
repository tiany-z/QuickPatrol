/**
 * 微信小程序端 M52 考勤与核验类型定义
 * 文件路径: packages/apps/attendance/contracts/attendanceTypes.ts
 */

export enum AttendanceStatus {
  NORMAL = 1,       // 正常到岗 / 准点下班
  LATE = 2,         // 迟到
  EARLY = 3,        // 早退
  ABSENT = 4,       // 严重迟到 / 旷工
  FIELD = 5,        // 外勤在岗打卡
  APPEALED = 6      // 异常已申诉补卡修正
}

export enum PunchType {
  PUNCH_IN = 1,     // 上班卡
  PUNCH_OUT = 2,    // 下班卡
  FIELD_PUNCH = 3   // 现场/巡更卡
}

export enum VerifyMode {
  FACE_AND_GPS = 1,
  FACE_AND_QR_POINT = 2,
  ADMIN_REPRESENT = 3,
  APPEAL_OVERWRITE = 4
}

export enum AppealType {
  MISSING_IN = 1,
  MISSING_OUT = 2,
  EMERGENCY_REPAIR = 3,
  DEVICE_FAULT = 4,
  FIELD_ASSIGNMENT = 5
}

export enum AppealApprovalStatus {
  PENDING = 0,
  FIRST_APPROVED = 1,
  PASSED = 2,
  REJECTED = 3
}

export interface IPunchInRequestDto {
  scheduleId?: number;
  punchType: PunchType;
  faceImageBase64: string;
  livenessNonce: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  pointCode?: string;
  deviceInfo?: {
    brand?: string;
    model?: string;
    system?: string;
    wechatVersion?: string;
  };
  remark?: string;
}

export interface IPunchInResponseDto {
  attendanceId: number;
  punchTime: string;
  punchType: PunchType;
  status: AttendanceStatus;
  statusText: string;
  isSuspicious: boolean;
  message: string;
  scheduleSummary?: {
    shiftName: string;
    plannedStartTime: string;
    plannedEndTime: string;
  };
}

export interface ITodayAttendanceStatusDto {
  workDate: string;
  hasSchedule: boolean;
  scheduleSummary?: {
    shiftName: string;
    plannedStartTime: string;
    plannedEndTime: string;
  };
  punchIn?: {
    attendanceId: number;
    punchTime: string;
    status: AttendanceStatus;
    statusText: string;
  };
  punchOut?: {
    attendanceId: number;
    punchTime: string;
    status: AttendanceStatus;
    statusText: string;
  };
  livenessNonce: string;
  livenessInstruction: string;
  geoCenter: {
    latitude: number;
    longitude: number;
    maxRadiusMeters: number;
  };
}

export interface ICreateAppealDto {
  attendanceId?: number;
  appealType: AppealType;
  targetDate: string;
  targetPunchType: PunchType;
  targetTime: string;
  reason: string;
  evidencePhotos?: string[];
  relatedPatrolId?: number;
}

export interface IApproveAppealDto {
  appealId: number;
  action: "PASS" | "REJECT";
  remark: string;
}

export interface IDayAttendanceCell {
  date: string;
  dayOfWeek: number;
  hasSchedule: boolean;
  punchInTime?: string;
  punchInStatus?: AttendanceStatus;
  punchOutTime?: string;
  punchOutStatus?: AttendanceStatus;
  isAbnormal: boolean;
  hasAppeal: boolean;
}

export interface IMonthlyAttendanceReportDto {
  schoolId: number;
  userId: number;
  userName: string;
  departmentName: string;
  month: string;
  summary: {
    scheduledDays: number;
    actualDays: number;
    normalCount: number;
    lateCount: number;
    earlyCount: number;
    absentCount: number;
    appealedCount: number;
    totalWorkingHours: number;
    attendanceRate: number;
    creditScore: number;
  };
  days: IDayAttendanceCell[];
}
