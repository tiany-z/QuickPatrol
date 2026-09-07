/**
 * M10: 模块测试中枢 (Test Harness Substrate) 强类型接口契约与数据模型定义
 * 
 * 遵照 M10 详细设计规范，为全量后续业务模块单元测试提供统一的类型契约。
 */

/**
 * 虚拟租户上下文契约 (算法 1 派生产物)
 */
export interface IMockTenantContext {
  /** 派生的虚拟高校租户 ID (如 80101) */
  schoolId: number;
  /** 派生的虚拟用户 ID */
  userId: number;
  /** 角色身份数字代码 (0学生, 1教工, 2师傅, 3主管, 4校管, 9超管) */
  role: number;
  /** 微信 openId */
  openId: string;
  /** 真实姓名 */
  realName: string;
  /** 角色名称 */
  roleName: string;
  /** 签名合法的 JWT Token */
  token: string;
  /** 预装填的 HTTP 请求头 (可直接用于 API 模拟调用) */
  authHeaders: {
    token: string;
    "x-school-id": string;
    "content-type": string;
    [key: string]: string;
  };
}

/**
 * AST 租户隔离检测探针错误类型枚举
 */
export type AstProbeErrorType =
  | "MISSING_TENANT_ID"
  | "OR_SHORT_CIRCUIT_RISK"
  | "SYNTAX_ERROR";

/**
 * AST 探针诊断报告契约
 */
export interface IAstProbeReport {
  /** 检测是否完全合格通过 */
  passed: boolean;
  /** 错误类型枚举 */
  errorType?: AstProbeErrorType;
  /** 错误详细描述 */
  message?: string;
  /** 被审查的原始 SQL 文本 */
  sql: string;
}

/**
 * 测试沙箱配置选项契约
 */
export interface ITestHarnessOptions {
  /** 模块编号 (如 1 代表 M01, 10 代表 M10, 23 代表 M23) */
  moduleIndex: number;
  /** 当前用例序号 (用于多用例租户隔离，默认为 1) */
  caseIndex?: number;
  /** 用户角色数字代码 (默认 0 学生) */
  role?: number;
  /** 是否启用内存级 Redis Spy */
  enableRedisSpy?: boolean;
  /** 是否启用 AST 探针自动拦截 */
  enableAstProbe?: boolean;
}

/**
 * Saga 事务撤回断言结果契约
 */
export interface ISagaRollbackAssertResult {
  /** 预期执行补偿的步骤数 */
  expectedCompensations: number;
  /** 实际成功执行补偿的步骤数 */
  actualCompensations: number;
  /** 补偿操作是否严格按照逆序 (LIFO) 执行 */
  isStrictLifo: boolean;
  /** 补偿动作执行日志清单 */
  executionLogs: string[];
}
