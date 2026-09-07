/**
 * M16: Windows Metro UI 经典高饱和度色彩自适应分配器
 */

export const METRO_PALETTE = [
  "#0078D7", // Cobalt Blue (经典钴蓝)
  "#107C41", // Forest Green (丛林绿)
  "#D83B01", // Emergency Orange (抢修橙)
  "#FFB900", // Safety Amber (安全琥珀黄)
  "#E74856", // Crimson Red (深绯红)
  "#008272", // Teal Lake (湖水青)
  "#881798", // Violet Purple (罗兰紫)
  "#0099BC", // Cyan (青色)
  "#B146C2", // Orchid (兰紫)
  "#E3008C"  // Magenta (品红)
];

export class MetroColorAssigner {
  /**
   * 根据岗位标签语义关键字或哈希值自适应推荐 Windows Metro UI 经典色标
   */
  public static assignColor(tagName: string): string {
    if (!tagName) return METRO_PALETTE[0];
    const name = tagName.toLowerCase();

    if (name.includes("急") || name.includes("汛") || name.includes("火") || name.includes("重")) {
      return "#E74856"; // 紧急/防汛/消防分配深绯红
    }
    if (name.includes("电") || name.includes("水") || name.includes("抢修") || name.includes("暖")) {
      return "#D83B01"; // 抢修动力分配抢修橙
    }
    if (name.includes("绿化") || name.includes("环卫") || name.includes("保洁")) {
      return "#107C41"; // 绿化环境分配丛林绿
    }
    if (name.includes("审") || name.includes("质检") || name.includes("复核") || name.includes("监理")) {
      return "#881798"; // 质检复核分配罗兰紫
    }
    if (name.includes("安") || name.includes("巡") || name.includes("防")) {
      return "#FFB900"; // 安防巡更分配琥珀黄
    }

    // 其他情况基于字符串字符散列从调色板轮询分配
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % METRO_PALETTE.length;
    return METRO_PALETTE[index];
  }
}
