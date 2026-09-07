/**
 * 高校后勤巡查e速办 v4.0 - M39: 聊天消息长按引用回复与源消息联动
 * (Viewport Scroll Target Calculator - 算法 2)
 */

export class ViewportScrollTargetCalculator {
  /**
   * 将消息主键 ID 映射为微信小程序标准 WXML 视口节点选择器 ID
   * 确保以英文字符 msg_ 开头，防止纯数字 ID 导致微信 scroll-into-view 解析失效
   */
  public static toElementId(messageId: number | string): string {
    return `msg_${messageId}`;
  }

  /**
   * 检测目标被引用的源消息是否存在于当前本地视口数组中
   * @param list 本地消息渲染数组
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
