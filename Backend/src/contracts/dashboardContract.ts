/**
 * 高校后勤巡查e速办 v4.0 - M53 全校后勤宏观运维决策大盘
 * 文件路径: src/contracts/dashboardContract.ts
 * 核心职责: 定义大盘主题、风险等级、KDE热力点阵、Tree-Diff差分补丁、六大业务域聚合DTO与Excel导出契约
 */

/**
 * 大屏主题视觉模式
 */
export enum DashboardTheme {
  CYBER_DARK_BLUE = "CYBER_DARK_BLUE", // 默认暗黑科技蓝 (巨幕模式)
  CLEAN_LIGHT = "CLEAN_LIGHT",           // 极简浅色明亮 (iPad 汇报模式)
  EMERGENCY_ALARM = "EMERGENCY_ALARM"    // 特大险情全屏荧红警报
}

/**
 * 风险等级枚举
 */
export enum RiskLevel {
  SAFE = "SAFE",         // 绿: 安全卓越
  WARNING = "WARNING",   // 黄: 预警关注
  CRITICAL = "CRITICAL"  // 红: 极度高危
}

/**
 * 空间核密度热力离散网格点契约
 */
export interface IKdeHeatPoint {
  latitude: number;
  longitude: number;
  weight: number;         // 0.0 ~ 1.0 归一化发光强度
  buildingName?: string;  // 对应建筑名称
  activeFaultCount: number; // 当前未修复隐患数
}

/**
 * 状态差分补丁操作单元契约
 */
export interface IPatchOperation {
  op: "REPLACE" | "ADD" | "REMOVE";
  path: string;                  // 属性访问路径 (例如: "patrolOverview.pendingCount")
  value: any;
}

/**
 * WebSocket 3秒增量差分推送事件
 */
export interface IDashboardDeltaEventDto {
  eventType: "DELTA_UPDATE";
  schoolId: number;
  timestamp: string;
  patches: IPatchOperation[];
}

/**
 * 特大险情全屏变色广播契约
 */
export interface IEmergencyAlertBroadcastDto {
  eventType: "EMERGENCY_ALARM";
  schoolId: number;
  orderNo: string;
  title: string;
  location: string;
  dangerLevel: 1 | 2 | 3; // 3 为特大突发危机
  latitude: number;
  longitude: number;
  reporterPhone: string;
  triggerTime: string;
}

/**
 * 宏观决策大盘全量数据报文契约
 */
export interface IMacroDashboardResponseDto {
  schoolId: number;
  schoolName: string;
  updateTimestamp: string;       // "2026-09-06 18:30:00"
  cfhiScore: number;             // 全校后勤设施健康度 (0~100)
  cfhiLevel: RiskLevel;

  // 1. 巡查工单综合态势
  patrolOverview: {
    totalCount: number;
    pendingCount: number;
    processingCount: number;
    reviewingCount: number;
    completedCount: number;
    completionRate: number;      // 完工率百分比 (如 94.5)
    overdueCount: number;        // 超期未结工单数
    avgHandleHours: number;      // 平均修复时长 (小时)
    categoryDistribution: Array<{
      categoryId: number;
      categoryName: string;
      count: number;
      percentage: number;
    }>;
    slaRiskTrend: Array<{
      hourSlot: string;          // "14:00", "15:00"
      safeCount: number;
      warningCount: number;
      criticalCount: number;
    }>;
  };

  // 2. 现场作业与人员在岗大盘 (M52)
  attendanceOverview: {
    scheduledTotal: number;      // 今日排班应出勤人数
    actualPresent: number;       // 实际在岗人数
    attendanceRate: number;      // 实时到岗率 (如 98.2)
    lateCount: number;
    absentCount: number;
    onDutyWorkers: Array<{
      userId: number;
      name: string;
      phone: string;
      departmentName: string;
      lastPunchTime: string;
      currentBuilding: string;
      latitude: number;
      longitude: number;
    }>;
  };

  // 3. 今日总值班长与维保日程 (M51)
  shiftOverview: {
    chiefCommander: {
      userId: number;
      name: string;
      phone: string;
      title: string;             // "后勤保障处总值班长"
    };
    activeMaintenances: Array<{
      scheduleId: number;
      title: string;             // "全校供水总管加压泵清洗"
      timeRange: string;
      impactArea: string;        // "一区宿舍与南苑食堂"
      status: "PLANNING" | "RUNNING" | "DONE";
    }>;
  };

  // 4. 师生诉求与公开舆情 (M31/M33)
  feedbackOverview: {
    overallSatisfactionScore: number; // 五星打分 (如 4.85)
    totalFeedbacks: number;
    hotKeywords: Array<{
      text: string;              // "水压不足", "路灯不亮"
      weight: number;
    }>;
  };

  // 5. 2.5D 校区高斯核密度热力矩阵 (KDE)
  heatMapPoints: IKdeHeatPoint[];

  // 6. SaaS 租户配额与体检 (M11)
  tenantQuota: {
    planLevelText: string;       // "旗舰尊享版"
    quotaUsagePercent: number;   // 82.5%
    remainingDays: number;       // 距离服务到期天数
  };
}

/**
 * 工单 Excel 批量导出请求参数契约
 */
export interface IPatrolExcelExportOptionsDto {
  schoolId: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  campusId?: number;
  categoryId?: number;
  status?: number; // 默认全部，或指定已办结
  includeMapQr: boolean; // 是否在单元格中物理内嵌高德地图导航二维码
}

/**
 * 待导出的工单扁平记录结构
 */
export interface IPatrolExportRecordDto {
  patrolId: number;
  orderNo: string;
  campusName: string;
  categoryName: string;
  locationName: string;
  title: string;
  content: string;
  statusDesc: string;
  handlerName: string;
  reporterName: string;
  createdAt: string;
  completedAt: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * 异步导出任务响应契约
 */
export interface IExportJobResponseDto {
  jobId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  downloadUrl?: string;
  totalRecords?: number;
  fileSizeBytes?: number;
  expireAt?: string;
}
