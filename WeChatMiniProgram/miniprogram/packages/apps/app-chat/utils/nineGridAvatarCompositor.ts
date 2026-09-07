/**
 * 高校后勤巡查e速办 v4.0 - 小程序端: 九宫格群头像合成与网格计算工具
 * (Nine-Grid Group Avatar Compositor for WeChat MiniProgram)
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

  public static calculateGridLayout(count: number): IGridCellCoordinate[] {
    const total = Math.min(9, Math.max(1, Math.floor(count || 1)));
    const W = this.CANVAS_SIZE;
    const P = this.PADDING;
    const S = this.SPACING;

    if (total === 1) {
      const s = W - P * 2;
      return [{ index: 0, x: P, y: P, size: s }];
    }

    if (total === 2) {
      const s = (W - P * 2 - S) / 2;
      const y = (W - s) / 2;
      return [
        { index: 0, x: P, y, size: s },
        { index: 1, x: P + s + S, y, size: s }
      ];
    }

    if (total === 3) {
      const s = (W - P * 2 - S) / 2;
      return [
        { index: 0, x: (W - s) / 2, y: P, size: s },
        { index: 1, x: P, y: P + s + S, size: s },
        { index: 2, x: P + s + S, y: P + s + S, size: s }
      ];
    }

    if (total === 4) {
      const s = (W - P * 2 - S) / 2;
      return [
        { index: 0, x: P, y: P, size: s },
        { index: 1, x: P + s + S, y: P, size: s },
        { index: 2, x: P, y: P + s + S, size: s },
        { index: 3, x: P + s + S, y: P + s + S, size: s }
      ];
    }

    const s = (W - P * 2 - S * 2) / 3;

    if (total === 5) {
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

    const result: IGridCellCoordinate[] = [];
    if (total === 7) {
      result.push({ index: 0, x: (W - s) / 2, y: P, size: s });
      for (let c = 0; c < 3; c++) {
        result.push({ index: 1 + c, x: P + (s + S) * c, y: P + s + S, size: s });
      }
      for (let c = 0; c < 3; c++) {
        result.push({ index: 4 + c, x: P + (s + S) * c, y: P + (s + S) * 2, size: s });
      }
      return result;
    }

    if (total === 8) {
      const xOffset = (W - (s * 2 + S)) / 2;
      result.push({ index: 0, x: xOffset, y: P, size: s });
      result.push({ index: 1, x: xOffset + s + S, y: P, size: s });
      for (let c = 0; c < 3; c++) {
        result.push({ index: 2 + c, x: P + (s + S) * c, y: P + s + S, size: s });
      }
      for (let c = 0; c < 3; c++) {
        result.push({ index: 5 + c, x: P + (s + S) * c, y: P + (s + S) * 2, size: s });
      }
      return result;
    }

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

  public static generateNineGridSvg(avatarUrls: string[] = []): string {
    const list = avatarUrls.slice(0, 9);
    const count = Math.max(1, list.length);
    const layout = this.calculateGridLayout(count);
    const size = this.CANVAS_SIZE;

    const bgRect = `<rect width="${size}" height="${size}" rx="12" fill="#E4E7ED"/>`;
    const imageNodes = layout.map((coord, idx) => {
      const url = list[idx] || "https://res.quickpatrol.edu.cn/static/avatar/default_student.png";
      const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `<image href="${escapedUrl}" x="${coord.x.toFixed(1)}" y="${coord.y.toFixed(1)}" width="${coord.size.toFixed(1)}" height="${coord.size.toFixed(1)}" preserveAspectRatio="xMidYMid slice" clip-path="inset(0% round 4px)"/>`;
    });

    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bgRect}${imageNodes.join("")}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgXml)}`;
  }
}
