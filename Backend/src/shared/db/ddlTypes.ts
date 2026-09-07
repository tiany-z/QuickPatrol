import { StandardResult } from "../flow/result.js";

/**
 * DDL 执行器配置选项
 */
export interface DDLRunnerConfig {
  /** SQL 资源文件绝对或相对路径 */
  sqlFilePath: string;
  /** 是否强制重新创建/刷新 (默认 false) */
  forceRecreate?: boolean;
  /** 是否跳过原生 CHECK 约束探针校验 (默认 false) */
  skipProbe?: boolean;
  /** 单语句执行超时时间 (毫秒, 默认 30000) */
  timeoutMs?: number;
}

/**
 * 单个 DDL 步骤执行结果
 */
export interface DDLStepResult {
  name: string;
  type: "TABLE" | "VIEW" | "INDEX" | "OTHER";
  sql: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * 约束探针定义
 */
export interface CheckProbeDefinition {
  probeId: string;
  tableName: string;
  testColumn: string;
  invalidPayload: Record<string, any>;
  expectedConstraintName: string;
}

/**
 * 约束探针测试报告
 */
export interface ProbeVerificationReport {
  totalProbes: number;
  passedProbes: number;
  failedProbes: number;
  details: Array<{
    probeId: string;
    targetConstraint: string;
    passed: boolean;
    actualError?: string;
  }>;
}

/**
 * M01 模块最终汇总执行报告
 */
export interface DDLSummaryReport {
  version: string;
  checksum: string;
  tablesCreated: number;
  viewsCreated: number;
  probesVerified: number;
  totalDurationMs: number;
  steps: DDLStepResult[];
  probeReport: ProbeVerificationReport;
}
