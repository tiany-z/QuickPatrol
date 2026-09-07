import { HslColor, ISystemMetrics } from "../typings/theme.js";

/**
 * 算法 1: 基于 HSL 模型的色阶动态派生算法 (HSL Color Tier Deriver)
 * 支持多校根据专属校徽色派生 50 ~ 800 全阶调色板与外发光变量
 */
export function deriveHslTiers(base: HslColor): Record<string, string> {
  const steps: Record<string, number> = {
    "50": 96,
    "100": 90,
    "200": 80,
    "300": 65,
    "500": 50, // 品牌基色锚点
    "600": 42,
    "700": 32,
    "800": 20,
  };

  const result: Record<string, string> = {};
  for (const [tier, targetL] of Object.entries(steps)) {
    // 动态非线性饱和度修正：低亮度适当增艳，浅色底适度淡化
    const saturationCorrection = 1 - 0.25 * ((targetL - 50) / 50);
    const correctedS = Math.min(
      100,
      Math.max(10, Math.round(base.s * saturationCorrection))
    );
    result[`--qp-primary-${tier}`] = `hsl(${base.h}, ${correctedS}%, ${targetL}%)`;
  }

  // 衍生品牌主色锚点与外发光变量 (用于卡片光晕)
  result["--qp-primary"] = `hsl(${base.h}, ${base.s}%, ${base.l}%)`;
  result["--qp-primary-glow"] = `hsla(${base.h}, ${base.s}%, 50%, 0.28)`;

  return result;
}

/**
 * 算法 3: 视口几何与胶囊避让归一化计算算法 (SafeArea & Capsule Metric Normalizer)
 */
export function calculateSystemMetrics(
  windowInfo: any,
  capsule: any
): ISystemMetrics {
  const statusBarHeight = windowInfo?.statusBarHeight || 44;
  const capsuleTop = capsule?.top || 48;
  const capsuleHeight = capsule?.height || 32;
  const capsuleRight = capsule?.right || (windowInfo?.windowWidth ? windowInfo.windowWidth - 7 : 368);

  // 导航内容高度 = (胶囊上边距 - 状态栏高度) * 2 + 胶囊高度 (严格上下对称)
  const navBarHeight = (capsuleTop - statusBarHeight) * 2 + capsuleHeight;
  const headerTotalHeight = statusBarHeight + navBarHeight;

  const windowHeight = windowInfo?.screenHeight || windowInfo?.windowHeight || 812;
  const safeBottomRaw = windowInfo?.safeArea
    ? windowHeight - windowInfo.safeArea.bottom
    : 20;
  const safeBottom = Math.max(safeBottomRaw, 16); // 保证至少 16px 下巴留白

  const windowWidth = windowInfo?.windowWidth || 375;
  const capsuleRightMargin = windowWidth - capsuleRight;

  return {
    statusBarHeight,
    navBarHeight,
    headerTotalHeight,
    capsule: {
      top: capsuleTop,
      bottom: capsule?.bottom || 80,
      left: capsule?.left || 281,
      right: capsuleRight,
      width: capsule?.width || 87,
      height: capsuleHeight,
    },
    capsuleRightMargin,
    safeBottom,
    screenWidth: windowWidth,
    screenHeight: windowHeight,
  };
}

/**
 * 算法 5: 红点角标折叠与溢出收敛算法 (Badge Count Folding & Overflow)
 */
export function foldBadgeCount(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  if (count > 99) {
    return "99+";
  }
  return String(count);
}
