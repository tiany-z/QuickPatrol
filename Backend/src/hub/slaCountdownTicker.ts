/**
 * 高校后勤巡查e速办 v4.0 - M44: SLA 履约倒计时动态毫秒级推演算法
 * (SLA Countdown Ticker Evaluator - Algorithm 1)
 */

export interface ISlaCountdownResult {
  text: string;
  isUrgent: boolean;
  isOverdue: boolean;
  diffMinutes: number;
}

export class SlaCountdownTicker {
  /**
   * 毫秒级推演工单 SLA 履约倒计时状态与提示文案
   * @param deadlineAtIso 截止时间 ISO 字符串
   * @param serverNow 基准时钟时间 (默认为当前系统时间)
   */
  public static evaluate(
    deadlineAtIso: string,
    serverNow: Date = new Date()
  ): ISlaCountdownResult {
    const deadlineMs = new Date(deadlineAtIso).getTime();
    const nowMs = serverNow.getTime();
    const diffMs = deadlineMs - nowMs;
    const diffMinutes = Math.floor(diffMs / 60000);

    // 1. 已逾期 (违约状态)
    if (diffMs <= 0) {
      const overdueMins = Math.abs(diffMinutes);
      return {
        text: overdueMins === 0 ? "刚刚逾期 (SLA督查中)" : `已逾期 ${overdueMins} 分钟 (SLA督查中)`,
        isUrgent: true,
        isOverdue: true,
        diffMinutes
      };
    }

    // 2. 临期 30 分钟内 (即将违约红光警示)
    if (diffMs <= 30 * 60 * 1000) {
      return {
        text: `剩余 ${diffMinutes} 分钟 (即将违约!)`,
        isUrgent: true,
        isOverdue: false,
        diffMinutes
      };
    }

    // 3. 正常充裕时效 (> 30 分钟)
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    const text = hours > 0
      ? (mins > 0 ? `剩余 ${hours} 小时 ${mins} 分钟` : `剩余 ${hours} 小时`)
      : `剩余 ${mins} 分钟`;

    return {
      text,
      isUrgent: false,
      isOverdue: false,
      diffMinutes
    };
  }
}
