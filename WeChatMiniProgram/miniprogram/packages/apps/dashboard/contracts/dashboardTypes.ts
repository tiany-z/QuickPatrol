/**
 * 微信小程序端 M53 宏观决策大盘类型定义
 * 文件路径: packages/apps/dashboard/contracts/dashboardTypes.ts
 */

export enum DashboardTheme {
  CYBER_DARK_BLUE = "CYBER_DARK_BLUE",
  CLEAN_LIGHT = "CLEAN_LIGHT",
  EMERGENCY_ALARM = "EMERGENCY_ALARM"
}

export enum RiskLevel {
  SAFE = "SAFE",
  WARNING = "WARNING",
  CRITICAL = "CRITICAL"
}

export interface IKdeHeatPoint {
  latitude: number;
  longitude: number;
  weight: number;
  buildingName?: string;
  activeFaultCount: number;
}

export interface IPatchOperation {
  op: "REPLACE" | "ADD" | "REMOVE";
  path: string;
  value: any;
}

export interface IDashboardDeltaEventDto {
  eventType: "DELTA_UPDATE";
  schoolId: number;
  timestamp: string;
  patches: IPatchOperation[];
}

export interface IEmergencyAlertBroadcastDto {
  eventType: "EMERGENCY_ALARM";
  schoolId: number;
  orderNo: string;
  title: string;
  location: string;
  dangerLevel: 1 | 2 | 3;
  latitude: number;
  longitude: number;
  reporterPhone: string;
  triggerTime: string;
}

export interface IMacroDashboardResponseDto {
  schoolId: number;
  schoolName: string;
  updateTimestamp: string;
  cfhiScore: number;
  cfhiLevel: RiskLevel;

  patrolOverview: {
    totalCount: number;
    pendingCount: number;
    processingCount: number;
    reviewingCount: number;
    completedCount: number;
    completionRate: number;
    overdueCount: number;
    avgHandleHours: number;
    categoryDistribution: Array<{
      categoryId: number;
      categoryName: string;
      count: number;
      percentage: number;
    }>;
    slaRiskTrend: Array<{
      hourSlot: string;
      safeCount: number;
      warningCount: number;
      criticalCount: number;
    }>;
  };

  attendanceOverview: {
    scheduledTotal: number;
    actualPresent: number;
    attendanceRate: number;
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

  shiftOverview: {
    chiefCommander: {
      userId: number;
      name: string;
      phone: string;
      title: string;
    };
    activeMaintenances: Array<{
      scheduleId: number;
      title: string;
      timeRange: string;
      impactArea: string;
      status: "PLANNING" | "RUNNING" | "DONE";
    }>;
  };

  feedbackOverview: {
    overallSatisfactionScore: number;
    totalFeedbacks: number;
    hotKeywords: Array<{
      text: string;
      weight: number;
    }>;
  };

  heatMapPoints: IKdeHeatPoint[];

  tenantQuota: {
    planLevelText: string;
    quotaUsagePercent: number;
    remainingDays: number;
  };
}
