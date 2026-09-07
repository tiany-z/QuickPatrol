/**
 * 高校后勤巡查e速办 v4.0 - M40: 视口停留有效性与防误刷时间窗口判定状态机
 * (Dwell Time Threshold Evaluator - 算法 1)
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

  public hasTriggered(): boolean {
    return this.isAckTriggered;
  }
}
