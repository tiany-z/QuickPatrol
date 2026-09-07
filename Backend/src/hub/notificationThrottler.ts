/**
 * 高校后勤巡查e速办 v4.0 - M42: 算法 3 - 优先级动态加权与防风暴削峰算法
 * (Priority-Weighted Throttling Bucket)
 */

import { NotificationPriority } from "./notificationTypes.js";

export class NotificationThrottler {
  // 普通/低优先级令牌桶: 容量 1000, 每秒生成 200 个令牌
  private static normalCapacity = 1000;
  private static normalRate = 200; // tokens/sec
  private static normalTokens = 1000;
  private static normalLastRefill = Date.now();

  // 特急抢险通知令牌桶: 容量 5000, 每秒生成 1000 个令牌 (5倍优先权)
  private static urgentCapacity = 5000;
  private static urgentRate = 1000; // tokens/sec
  private static urgentTokens = 5000;
  private static urgentLastRefill = Date.now();

  /**
   * 刷新令牌桶
   */
  private static refillTokens(): void {
    const now = Date.now();

    // 刷新普通桶
    const normalDeltaSec = (now - this.normalLastRefill) / 1000;
    if (normalDeltaSec > 0) {
      this.normalTokens = Math.min(
        this.normalCapacity,
        this.normalTokens + normalDeltaSec * this.normalRate
      );
      this.normalLastRefill = now;
    }

    // 刷新特急桶
    const urgentDeltaSec = (now - this.urgentLastRefill) / 1000;
    if (urgentDeltaSec > 0) {
      this.urgentTokens = Math.min(
        this.urgentCapacity,
        this.urgentTokens + urgentDeltaSec * this.urgentRate
      );
      this.urgentLastRefill = now;
    }
  }

  /**
   * 尝试消耗令牌
   * @param priority 优先级: low, normal, urgent
   * @param cost 消耗令牌数，默认 1
   * @returns boolean 是否允许通过
   */
  public static tryAcquire(priority: NotificationPriority | string = NotificationPriority.NORMAL, cost: number = 1): boolean {
    this.refillTokens();

    const isUrgent = priority === NotificationPriority.URGENT || priority === "urgent";

    if (isUrgent) {
      if (this.urgentTokens >= cost) {
        this.urgentTokens -= cost;
        return true;
      }
      return false;
    } else {
      if (this.normalTokens >= cost) {
        this.normalTokens -= cost;
        return true;
      }
      return false;
    }
  }

  /**
   * 重置令牌桶 (供单元测试恢复初始状态)
   */
  public static resetBuckets(): void {
    this.normalTokens = this.normalCapacity;
    this.normalLastRefill = Date.now();
    this.urgentTokens = this.urgentCapacity;
    this.urgentLastRefill = Date.now();
  }

  /**
   * 获取当前桶状态 (用于诊断与指标上报)
   */
  public static getMetrics(): { normalTokens: number; urgentTokens: number } {
    this.refillTokens();
    return {
      normalTokens: Math.floor(this.normalTokens),
      urgentTokens: Math.floor(this.urgentTokens)
    };
  }
}
