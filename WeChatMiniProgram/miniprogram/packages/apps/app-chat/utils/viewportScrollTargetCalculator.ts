/**
 * 高校后勤巡查e速办 v4.0 - M39: 微信小程序视口滚动目标计算器
 * (Viewport Scroll Target Calculator - 算法 2)
 */

export class ViewportScrollTargetCalculator {
  /**
   * 将消息 ID 映射为微信小程序合法的 WXML 元素 ID (msg_${messageId})
   * 必须以英文字符开头，防止纯数字 ID 引发 scroll-into-view 解析失效
   */
  public static toElementId(messageId: number | string): string {
    return `msg_${messageId}`;
  }

  /**
   * 检查目标源消息是否在本地当前消息列表中
   * @param list 本地已渲染消息列表
   * @param targetMessageId 目标源消息 ID
   */
  public static isTargetInCurrentList(
    list: Array<{ id: number | string }>,
    targetMessageId: number | string
  ): boolean {
    if (!list || !Array.isArray(list) || !targetMessageId) {
      return false;
    }
    const targetStr = String(targetMessageId);
    return list.some((item) => String(item.id) === targetStr);
  }

  /**
   * 综合计算目标消息在当前渲染视口中的滚动定位参数
   */
  public static calculate(
    targetMessageId: number | string,
    list: Array<{ id: number | string }>
  ): { inViewport: boolean; elementId: string } {
    const inViewport = this.isTargetInCurrentList(list, targetMessageId);
    const elementId = this.toElementId(targetMessageId);
    return { inViewport, elementId };
  }

  public static getTargetElementId(messageId: number | string): string {
    return this.toElementId(messageId);
  }
}
