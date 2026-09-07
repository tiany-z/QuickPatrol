/**
 * 高校后勤巡查e速办 v4.0 - M40: 视口停留有效性与防误刷时间窗口判定状态机
 * (Dwell Time Threshold Evaluator - 算法 1)
 *
 * 核心设计：
 * 设进入页面的时间为 T_enter，触发离开的时间为 T_leave，有效停留时间为 ΔT = T_leave - T_enter。
 * 设定有效阈值 τ = 300ms。
 * R(ΔT) = 1 (有效停留 >= 300ms, 触发 READ_ACK 消除红点)
 * R(ΔT) = 0 (误触或瞬间划过 < 300ms, 保留未读红点)
 */

export class DwellTimeEvaluator {
  public static readonly DWELL_THRESHOLD_MS = 300; // 300毫秒有效停留阈值
  private timer: any = null;
  private isAckTriggered = false;

  /**
   * 进入视口，开启有效停留计时
   * @param onValidDwell 满足 300ms 有效停留时的回调函数
   */
  public startDwellTimer(onValidDwell: () => void): void {
    this.clear();
    this.isAckTriggered = false;
    this.timer = setTimeout(() => {
      this.isAckTriggered = true;
      this.timer = null;
      onValidDwell();
    }, DwellTimeEvaluator.DWELL_THRESHOLD_MS);
  }

  /**
   * 离开视口，若未满 300ms 则销毁定时器并返回状态
   */
  public handleLeave(): { wasValidRead: boolean } {
    const valid = this.isAckTriggered;
    this.clear();
    return { wasValidRead: valid };
  }

  /**
   * 立即重置/销毁定时器
   */
  public clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 是否已触发过 ACK
   */
  public hasTriggered(): boolean {
    return this.isAckTriggered;
  }
}
