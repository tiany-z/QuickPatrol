/**
 * M17: 小程序端业务连续性防错熔断弹窗与引导控制器
 * (Flow Lock Dialog Controller for WeChat MiniProgram)
 */

declare const wx: any;

export interface IFlowLockDialogProps {
  title?: string;
  activeCount: number;
  blockedOrders: Array<{ orderNo: string; title: string }>;
  suggestedAction: string;
  redirectRoute?: string;
}

export class FlowLockDialogController {
  /**
   * 优雅展现业务熔断弹窗并提供一键交接引导
   */
  public static showDialog(props: IFlowLockDialogProps): void {
    const content =
      `名下尚有 ${props.activeCount} 张在办工单：\n` +
      props.blockedOrders.map((o) => `• [${o.orderNo}] ${o.title}`).join("\n") +
      `\n\n💡 建议：${props.suggestedAction}`;

    if (typeof wx !== "undefined" && wx.showModal) {
      wx.showModal({
        title: props.title || "⚠️ 业务连续性防错阻断",
        content,
        confirmText: "前往交接",
        cancelText: "暂不处理",
        confirmColor: "#D83B01",
        success: (res: any) => {
          if (res.confirm && props.redirectRoute && wx.navigateTo) {
            wx.navigateTo({
              url: props.redirectRoute
            });
          }
        }
      });
    }
  }
}
