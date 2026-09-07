/**
 * 高校后勤巡查e速办 v4.0 - M38: 类 QQ 2分钟消息撤回与审计存根
 * (Withdrawal Time Window Evaluator - 算法 1)
 */

export class WithdrawalTimeWindowEvaluator {
  public static readonly MAX_WITHDRAW_WINDOW_MS = 120 * 1000; // 120 秒黄金容错窗口
  public static readonly NETWORK_LATENCY_ALLOWANCE_MS = 3000;  // 3 秒分布式网络补偿因子

  /**
   * 计算并判定是否允许撤回
   * @param createdAt 消息落盘时间
   * @param serverNow 当前权威服务器时间
   * @param isPrivilegedAdmin 是否具备校级管理员特权
   */
  public static evaluate(
    createdAt: Date | string,
    serverNow: Date = new Date(),
    isPrivilegedAdmin: boolean = false
  ): { allowed: boolean; deltaSeconds: number; reason?: string } {
    // 1. 校级管理员特权通道无视 120 秒时限约束
    if (isPrivilegedAdmin) {
      return { allowed: true, deltaSeconds: 0 };
    }

    const createdTime = new Date(createdAt).getTime();
    const nowTime = serverNow.getTime();

    if (isNaN(createdTime)) {
      return { allowed: false, deltaSeconds: 0, reason: '消息创建时间格式非法' };
    }

    const deltaMs = nowTime - createdTime;

    // 2. 防未来时间穿越（时钟漂移容错）
    if (deltaMs < -5000) {
      return { allowed: false, deltaSeconds: 0, reason: '服务器时间校验异常，时间戳超前' };
    }

    const maxAllowedMs = this.MAX_WITHDRAW_WINDOW_MS + this.NETWORK_LATENCY_ALLOWANCE_MS;
    const deltaSeconds = Math.max(0, Math.floor(deltaMs / 1000));

    if (deltaMs > maxAllowedMs) {
      return {
        allowed: false,
        deltaSeconds,
        reason: `该消息发送已超过 ${deltaSeconds} 秒（允许上限 120 秒），无法撤回`
      };
    }

    return { allowed: true, deltaSeconds };
  }
}
