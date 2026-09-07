/**
 * M07: 小程序宿主架构与 Design Token 强类型契约定义
 */

export interface HslColor {
  h: number; // 0 ~ 360
  s: number; // 0 ~ 100
  l: number; // 0 ~ 100
}

/** 全局主题与 Design Token 契约 */
export interface IThemeTokens {
  /** 品牌主色阶梯 (从 50 到 800) */
  primaryColors: {
    50: string;
    100: string;
    200: string;
    300: string;
    500: string;
    600: string;
    700: string;
    800: string;
    glow: string;
  };
  /** 极光次级色 */
  aurora: string;
  /** 状态色 */
  success: string;
  /** 警示色 */
  warning: string;
  /** 危险色 */
  danger: string;
  /** 当前租户学校自定义 HSL 基础坐标 */
  schoolHsl?: HslColor;
}

/** 视口安全区度量契约 */
export interface ISystemMetrics {
  /** 顶部状态栏高度 (单位 px) */
  statusBarHeight: number;
  /** 顶部导航栏内容高度 (单位 px) */
  navBarHeight: number;
  /** 顶部总高度 = statusBarHeight + navBarHeight */
  headerTotalHeight: number;
  /** 胶囊按钮尺寸与坐标 */
  capsule: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  };
  /** 右侧胶囊内缩边距 (用于标题文字居中对齐) */
  capsuleRightMargin: number;
  /** 底部物理安全区高度 (用于 iPhone 下巴横条避让) */
  safeBottom: number;
  /** 屏幕整体宽高 */
  screenWidth: number;
  screenHeight: number;
}

/** 骨架屏布局类型 */
export type SkeletonLayoutType = "card" | "detail" | "list";

/** 骨架屏布局配置契约 */
export interface ISkeletonProps {
  /** 骨架屏预设布局类型 */
  layout: SkeletonLayoutType;
  /** 骨架卡片渲染重复次数 (默认 3) */
  count?: number;
  /** 是否开启微光呼吸扫光动画 (默认 true) */
  animated?: boolean;
  /** 自定义骨架圆角 (rpx) */
  radius?: number;
}

/** 缺省空状态模式类型 */
export type EmptyModeType = "empty" | "offline" | "no_permission" | "search";

/** 空状态与重试回调契约 */
export interface IEmptyProps {
  /** 空状态模式 */
  mode: EmptyModeType;
  /** 标题文字 (缺省提供标准预设) */
  title?: string;
  /** 补充说明副文案 */
  description?: string;
  /** 是否展示重试操作按钮 */
  showAction?: boolean;
  /** 按钮文案 (如 "重新加载", "去提报") */
  actionText?: string;
  /** 自定义插画图标路径 */
  customIcon?: string;
}

/** 状态徽章语义变体 */
export type BadgeVariant =
  | "primary"
  | "aurora"
  | "success"
  | "warning"
  | "danger"
  | "purple"
  | "neutral";

/** 状态徽章胶囊契约 */
export interface IBadgeProps {
  /** 徽章语义变体 */
  variant: BadgeVariant;
  /** 胶囊内文字内容 (如 "待接单", "处理中") */
  text?: string;
  /** 数值计数 (用于未读数字角标，若提供则根据算法自动折叠为 99+) */
  count?: number;
  /** 是否为纯小圆点模式 (无文字) */
  isDot?: boolean;
  /** 是否开启外发光微光晕效果 */
  glow?: boolean;
}
