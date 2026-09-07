/**
 * M07: 小程序宿主工程架构与 Design Token 样式基座 (Frontend Token Substrate)
 * 后端共享契约与算法映射实现 (与 WeChatMiniProgram/miniprogram/utils/themeHelper.ts 100% 同构对齐)
 */

export interface HslColor {
  h: number; // 0 ~ 360
  s: number; // 0 ~ 100
  l: number; // 0 ~ 100
}

export interface IThemeTokens {
  primaryColors: Record<string, string>;
  aurora: string;
  success: string;
  warning: string;
  purple: string;
  danger: string;
  schoolHsl?: HslColor;
}

export interface ISystemMetrics {
  statusBarHeight: number;
  navBarHeight: number;
  headerTotalHeight: number;
  capsule: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  };
  capsuleRightMargin: number;
  safeBottom: number;
  screenWidth: number;
  screenHeight: number;
}

export type EmptyModeType = "empty" | "offline" | "no_permission" | "search";

/**
 * 算法 1: 基于 HSL 模型的色阶动态派生算法 (HSL Color Tier Deriver)
 * 非线性饱和度修正矩阵：低亮度适当提艳，浅色底适度淡化
 */
export function deriveHslTiers(base: HslColor): Record<string, string> {
  const steps: Record<string, number> = {
    "50": 96,
    "100": 90,
    "200": 80,
    "300": 65,
    "500": 50,
    "600": 42,
    "700": 32,
    "800": 20,
  };

  const result: Record<string, string> = {};
  for (const [tier, targetL] of Object.entries(steps)) {
    const saturationCorrection = 1 - 0.25 * ((targetL - 50) / 50);
    const correctedS = Math.min(
      100,
      Math.max(10, Math.round(base.s * saturationCorrection))
    );
    result[`--qp-primary-${tier}`] = `hsl(${base.h}, ${correctedS}%, ${targetL}%)`;
  }

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
  const capsuleRight =
    capsule?.right ||
    (windowInfo?.windowWidth ? windowInfo.windowWidth - 7 : 368);

  const navBarHeight = (capsuleTop - statusBarHeight) * 2 + capsuleHeight;
  const headerTotalHeight = statusBarHeight + navBarHeight;

  const windowHeight =
    windowInfo?.screenHeight || windowInfo?.windowHeight || 812;
  const safeBottomRaw = windowInfo?.safeArea
    ? windowHeight - windowInfo.safeArea.bottom
    : 20;
  const safeBottom = Math.max(safeBottomRaw, 16);

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
 * 算法 4: 缺省空状态三维降级判定决策树 (Empty State Fallback Determinism)
 */
export function determineEmptyMode(
  networkType: string,
  isForbidden: boolean,
  isEmpty: boolean
): EmptyModeType | "ready" {
  if (networkType === "none") {
    return "offline";
  }
  if (isForbidden) {
    return "no_permission";
  }
  if (isEmpty) {
    return "empty";
  }
  return "ready";
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
