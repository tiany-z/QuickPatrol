/**
 * 高校后勤巡查e速办 v4.0 - M41 算法 3: 群聊九宫格头像动态合成拓扑算法
 * (Nine-Grid Group Avatar Compositor)
 * 
 * 核心设计：
 * 1. 自动截取前 1~9 位群成员的头像地址进行矩阵拓扑计算;
 * 2. 依据头像数量自动推导布局坐标 (1张全幅, 2张双拼, 3张居中三角, 4张四宫格, 5~9张经典矩阵);
 * 3. 产生高兼容性的极简 SVG DataURL，免去客户端与服务端重度位图拼接的 CPU 开销;
 * 4. 暴露纯数学坐标计算接口 `calculateGridLayout`，支持前端自定义 Canvas 或 CSS 定位渲染。
 */

export interface IGridCellCoordinate {
  index: number;
  x: number;
  y: number;
  size: number;
}

export class NineGridAvatarCompositor {
  public static readonly CANVAS_SIZE = 120;
  public static readonly PADDING = 4;
  public static readonly SPACING = 3;

  /**
   * 计算九宫格每个头像在 120x120 画布中的坐标与尺寸
   */
  public static calculateGridLayout(count: number): IGridCellCoordinate[] {
    const total = Math.min(9, Math.max(1, Math.floor(count || 1)));
    const W = this.CANVAS_SIZE;
    const P = this.PADDING;
    const S = this.SPACING;

    // 1 个头像：独占居中全景
    if (total === 1) {
      const s = W - P * 2;
      return [{ index: 0, x: P, y: P, size: s }];
    }

    // 2 个头像：左右双拼对半 (宽: (W - 2P - S) / 2)
    if (total === 2) {
      const s = (W - P * 2 - S) / 2;
      const y = (W - s) / 2;
      return [
        { index: 0, x: P, y, size: s },
        { index: 1, x: P + s + S, y, size: s }
      ];
    }

    // 3 个头像：上 1 居中，下 2 对齐
    if (total === 3) {
      const s = (W - P * 2 - S) / 2;
      const xTop = (W - s) / 2;
      const yTop = P;
      const yBottom = P + s + S;
      return [
        { index: 0, x: xTop, y: yTop, size: s },
        { index: 1, x: P, y: yBottom, size: s },
        { index: 2, x: P + s + S, y: yBottom, size: s }
      ];
    }

    // 4 个头像：2x2 标准四宫格
    if (total === 4) {
      const s = (W - P * 2 - S) / 2;
      return [
        { index: 0, x: P, y: P, size: s },
        { index: 1, x: P + s + S, y: P, size: s },
        { index: 2, x: P, y: P + s + S, size: s },
        { index: 3, x: P + s + S, y: P + s + S, size: s }
      ];
    }

    // 5~9 个头像：以 3x3 为基础矩阵
    const s = (W - P * 2 - S * 2) / 3;

    if (total === 5) {
      // 上 2 居中，下 3
      const xTopOffset = (W - (s * 2 + S)) / 2;
      const yTop = (W - (s * 2 + S)) / 2;
      const yBottom = yTop + s + S;
      return [
        { index: 0, x: xTopOffset, y: yTop, size: s },
        { index: 1, x: xTopOffset + s + S, y: yTop, size: s },
        { index: 2, x: P, y: yBottom, size: s },
        { index: 3, x: P + s + S, y: yBottom, size: s },
        { index: 4, x: P + (s + S) * 2, y: yBottom, size: s }
      ];
    }

    if (total === 6) {
      // 2 行 3 列垂直居中
      const yOffset = (W - (s * 2 + S)) / 2;
      return [
        { index: 0, x: P, y: yOffset, size: s },
        { index: 1, x: P + s + S, y: yOffset, size: s },
        { index: 2, x: P + (s + S) * 2, y: yOffset, size: s },
        { index: 3, x: P, y: yOffset + s + S, size: s },
        { index: 4, x: P + s + S, y: yOffset + s + S, size: s },
        { index: 5, x: P + (s + S) * 2, y: yOffset + s + S, size: s }
      ];
    }

    // 7~9 个头像：从上到下按 3x3 填满
    const result: IGridCellCoordinate[] = [];
    if (total === 7) {
      // 第一行 1 个居中
      result.push({ index: 0, x: (W - s) / 2, y: P, size: s });
      // 第二行 3 个
      for (let c = 0; c < 3; c++) {
        result.push({ index: 1 + c, x: P + (s + S) * c, y: P + s + S, size: s });
      }
      // 第三行 3 个
      for (let c = 0; c < 3; c++) {
        result.push({ index: 4 + c, x: P + (s + S) * c, y: P + (s + S) * 2, size: s });
      }
      return result;
    }

    if (total === 8) {
      // 第一行 2 个居中
      const xOffset = (W - (s * 2 + S)) / 2;
      result.push({ index: 0, x: xOffset, y: P, size: s });
      result.push({ index: 1, x: xOffset + s + S, y: P, size: s });
      // 第二行 3 个
      for (let c = 0; c < 3; c++) {
        result.push({ index: 2 + c, x: P + (s + S) * c, y: P + s + S, size: s });
      }
      // 第三行 3 个
      for (let c = 0; c < 3; c++) {
        result.push({ index: 5 + c, x: P + (s + S) * c, y: P + (s + S) * 2, size: s });
      }
      return result;
    }

    // 9 个：标准 3x3 满格
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        result.push({
          index: r * 3 + c,
          x: P + (s + S) * c,
          y: P + (s + S) * r,
          size: s
        });
      }
    }
    return result;
  }

  /**
   * 生成极简内联 SVG DataURL
   */
  public static generateNineGridSvg(avatarUrls: string[] = []): string {
    const list = avatarUrls.slice(0, 9);
    const count = Math.max(1, list.length);
    const layout = this.calculateGridLayout(count);
    const size = this.CANVAS_SIZE;

    const bgRect = `<rect width="${size}" height="${size}" rx="12" fill="#E4E7ED"/>`;
    const imageNodes = layout.map((coord, idx) => {
      const url = list[idx] || 'https://res.quickpatrol.edu.cn/static/avatar/default_student.png';
      // 转义 XML 关键字符
      const escapedUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<image href="${escapedUrl}" x="${coord.x.toFixed(1)}" y="${coord.y.toFixed(1)}" width="${coord.size.toFixed(1)}" height="${coord.size.toFixed(1)}" preserveAspectRatio="xMidYMid slice" clip-path="inset(0% round 4px)"/>`;
    });

    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bgRect}${imageNodes.join('')}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgXml)}`;
  }
}
