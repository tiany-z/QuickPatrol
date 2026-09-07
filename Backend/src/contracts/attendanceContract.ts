/**
 * 高校后勤巡查e速办 v4.0 - M52 师傅现场考勤打卡与人脸识别真实性核验
 * 文件路径: src/contracts/attendanceContract.ts
 * 核心职责: 定义考勤状态枚举、打卡流水实体、补卡申诉实体与交互 DTO
 */

/**
 * 考勤状态枚举 (严格对照数据库 chk_attend_status 原生约束)
 */
export enum AttendanceStatus {
  NORMAL = 1,       // 正常到岗 / 准点下班
  LATE = 2,         // 迟到
  EARLY = 3,        // 早退
  ABSENT = 4,       // 严重迟到 / 旷工
  FIELD = 5,        // 外勤在岗打卡
  APPEALED = 6      // 异常已申诉补卡修正
}

/**
 * 打卡类型枚举
 */
export enum PunchType {
  PUNCH_IN = 1,     // 上班卡
  PUNCH_OUT = 2,    // 下班卡
  FIELD_PUNCH = 3   // 现场/巡更卡
}

/**
 * 身份核验模式
 */
export enum VerifyMode {
  FACE_AND_GPS = 1,       // 人脸活体 + GPS围栏
  FACE_AND_QR_POINT = 2,  // 人脸活体 + M20固定资产点位码
  ADMIN_REPRESENT = 3,    // 管理员后台代打卡
  APPEAL_OVERWRITE = 4    // 申诉审批冲正
}

/**
 * 申诉类型枚举
 */
export enum AppealType {
  MISSING_IN = 1,       // 上班漏打卡补签
  MISSING_OUT = 2,      // 下班漏打卡补签
  EMERGENCY_REPAIR = 3, // 突发险情抢修延误
  DEVICE_FAULT = 4,     // 设备硬件或暗光识别故障
  FIELD_ASSIGNMENT = 5  // 因公外勤施工出差
}

/**
 * 审批状态枚举
 */
export enum AppealApprovalStatus {
  PENDING = 0,          // 待审批
  FIRST_APPROVED = 1,   // 初审通过
  PASSED = 2,           // 终审通过已生效
  REJECTED = 3          // 已驳回
}

/**
 * 考勤流水事实实体契约 (对应 attendances 物理表)
 */
export interface IAttendanceEntity {
  id: number;
  schoolId: number;
  userId: number;
  scheduleId: number | null;
  workDate: string; // YYYY-MM-DD
  punchType: PunchType;
  punchTime: string; // YYYY-MM-DD HH:mm:ss
  verifyMode: VerifyMode;
  status: AttendanceStatus;
  faceSimilarity: number | null;
  facePhotoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  distanceMeters: number;
  pointCode: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
  isSuspicious: boolean;
  suspiciousReason: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 考勤补卡申诉实体契约 (对应 attendance_appeals 物理表)
 */
export interface IAttendanceAppealEntity {
  id: number;
  schoolId: number;
  userId: number;
  attendanceId: number | null;
  appealType: AppealType;
  targetDate: string; // YYYY-MM-DD
  targetPunchType: PunchType;
  targetTime: string; // YYYY-MM-DD HH:mm:ss
  reason: string;
  evidencePhotos: string[] | null;
  relatedPatrolId: number | null;
  approvalStatus: AppealApprovalStatus;
  firstApproverId: number | null;
  firstAuditTime: string | null;
  firstAuditRemark: string | null;
  finalApproverId: number | null;
  finalAuditTime: string | null;
  finalAuditRemark: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 师傅现场打卡请求传输对象
 */
export interface IPunchInRequestDto {
  scheduleId?: number;                // 关联排班ID (可选)
  punchType: PunchType;               // 打卡类型: 1=上班, 2=下班, 3=现场
  faceImageBase64: string;            // 现场抓拍的人脸图片帧 Base64
  livenessNonce: string;              // 活体动作随机下发的凭证 Nonce
  latitude: number;                   // 客户端现场纬度
  longitude: number;                  // 客户端现场经度
  locationName?: string;              // 逆地理位置文本
  pointCode?: string;                 // 若降级使用 M20 资产二维码打卡，传入二维码编号
  deviceInfo?: {
    brand?: string;
    model?: string;
    system?: string;
    wechatVersion?: string;
  };
  remark?: string;
}

/**
 * 师傅现场打卡响应传输对象
 */
export interface IPunchInResponseDto {
  attendanceId: number;
  punchTime: string;                  // 记录打卡时间 "08:32:15"
  punchType: PunchType;
  status: AttendanceStatus;
  statusText: string;                 // "正常出勤", "迟到打卡", "早退打卡"
  isSuspicious: boolean;
  message: string;                    // 提示文案
  scheduleSummary?: {
    shiftName: string;
    plannedStartTime: string;
    plannedEndTime: string;
  };
}

/**
 * 今日打卡状态与活体指令概览 DTO
 */
export interface ITodayAttendanceStatusDto {
  workDate: string;                   // "2026-09-06"
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

/**
 * 发起考勤补卡申诉 DTO
 */
export interface ICreateAppealDto {
  attendanceId?: number;              // 关联的异常考勤ID (若全天缺卡可为空)
  appealType: AppealType;
  targetDate: string;                 // 补卡目标日期 "YYYY-MM-DD"
  targetPunchType: PunchType;         // 1=上班卡, 2=下班卡
  targetTime: string;                 // 申请认定的时间 "YYYY-MM-DD HH:mm:ss"
  reason: string;                     // 详细申诉事由
  evidencePhotos?: string[];          // 佐证照片 URL 数组
  relatedPatrolId?: number;           // 关联紧急抢修工单流水号
}

/**
 * 主管审批申诉 DTO
 */
export interface IApproveAppealDto {
  appealId: number;
  action: "PASS" | "REJECT";          // 审批动作
  remark: string;                     // 审核意见
}

/**
 * 日历单元格打卡概览
 */
export interface IDayAttendanceCell {
  date: string;                       // "2026-09-05"
  dayOfWeek: number;                  // 1~7
  hasSchedule: boolean;               // 当日是否有排班
  punchInTime?: string;               // 上班时间 "08:28"
  punchInStatus?: AttendanceStatus;
  punchOutTime?: string;              // 下班时间 "17:35"
  punchOutStatus?: AttendanceStatus;
  isAbnormal: boolean;                // 是否存在旷工/迟到/早退未补卡
  hasAppeal: boolean;                 // 是否有申诉单据
}

/**
 * 月度综合考勤报表 DTO
 */
export interface IMonthlyAttendanceReportDto {
  schoolId: number;
  userId: number;
  userName: string;
  departmentName: string;
  month: string;                      // "2026-09"
  summary: {
    scheduledDays: number;            // 应出勤天数
    actualDays: number;               // 实际出勤天数
    normalCount: number;              // 正常次数
    lateCount: number;                // 迟到次数
    earlyCount: number;               // 早退次数
    absentCount: number;              // 旷工次数
    appealedCount: number;            // 申诉补卡次数
    totalWorkingHours: number;        // 累计出勤工时 (小时)
    attendanceRate: number;           // 出勤率百分比 (如: 98.5)
    creditScore: number;              // 考勤信用分 (如: 96.0)
  };
  days: IDayAttendanceCell[];
}
