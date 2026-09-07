/**
 * 高校后勤巡查e速办 v4.0 - M26: 延期截止时限顺延与审批权限阶梯升格算法
 * (Patrol Delay Extension Dynamics & Escalation Algorithms)
 */

/**
 * 算法 1：截止时限顺延累加动力学模型 (Deadline Extension Dynamics)
 * 选取较晚者作为基准时间点：未超时单据在原有剩余时间上无缝累加，已超时单据以权威服务器时刻作为新起跑线
 * 
 * @param oldDeadlineMs 原处理截止时间戳 (毫秒)
 * @param delayHours 申请顺延小时数 (必须在 1 ~ 168 之间)
 * @param serverNowMs 当前服务器时间戳 (毫秒)
 */
export function calculateNewDeadline(
  oldDeadlineMs: number,
  delayHours: number,
  serverNowMs: number = Date.now()
): Date {
  if (delayHours <= 0 || delayHours > 168) {
    throw new Error("INVALID_DELAY_HOURS: 单次延期时长必须在 1 至 168 小时之间");
  }

  // 动力学起跑线校准
  const baselineMs = Math.max(oldDeadlineMs, serverNowMs);
  const targetMs = baselineMs + delayHours * 3600 * 1000;
  return new Date(targetMs);
}

/**
 * 算法 3：累计延期时长阶梯阈值与自动升格审批人判定算法 (Threshold Escalation Evaluator)
 * 
 * @param approvedCount 历史已批准延期次数
 * @param cumulativeHours 历史已批准时长 + 本次拟批准时长 (小时)
 * @returns 审批人所需最低角色等级: 3 (科室主管), 4 (分管处长), Infinity (熔断禁止)
 */
export function evaluateRequiredRole(approvedCount: number, cumulativeHours: number): number {
  // 单工单累计延期达到 5 次或累计时长超过 360 小时 (15天)，触发硬熔断
  if (approvedCount >= 5 || cumulativeHours > 360) {
    return Infinity;
  }

  // 历史延期次数 >= 1 次，或者累计总时长超过 48 小时，必须分管处长 (role >= 4) 审批
  if (approvedCount >= 1 || cumulativeHours > 48) {
    return 4;
  }

  // 首次且工期 <= 48 小时，普通科室主管 (role = 3) 即可审批
  return 3;
}
