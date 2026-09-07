/**
 * M08: 顶部沉浸式导航与左侧多单位切换抽屉 (Navbar & Tenant Drawer)
 * 强类型接口契约与数据模型定义
 */

export type TenantSessionStatus = "active" | "valid" | "expired";

/**
 * 本机设备多租户高校账号存根物理数据模型
 */
export interface DeviceAccountRecord {
  /** 高校唯一主键 ID */
  schoolId: number;
  /** 高校全称 (如 "聊城大学") */
  schoolName: string;
  /** 高校英文标识代号 (如 "lcu") */
  schoolCode: string;
  /** 校徽 Logo 高清图片 URL */
  logoUrl: string;
  /** 校区名称 (如 "东校区", "海滨校区") */
  campusName: string;
  /** 绑定的微信主手机号 (用于严格同手机号门禁过滤) */
  boundPhone: string;
  /** 该校下的用户主键 ID */
  userId: number;
  /** 真实姓名 */
  realName: string;
  /** 用户学工号 */
  workNo?: string;
  /** 用户角色 (0学生, 1教职工, 2师傅, 3主管, 4校管, 9超管) */
  role: number;
  /** 角色岗位描述标签 (如 "水电暖抢修组长") */
  roleName: string;
  /** 该校专属租户 JWT Token */
  token: string;
  /** Token 绝对过期时间 ISO 字符串 */
  tokenExpireAt: string;
  /** 是否已被标记为过期 */
  isExpired: boolean;
  /** 会话状态枚举 */
  sessionStatus: TenantSessionStatus;
  /** 该校名下的待办未读红点计数 */
  unreadCount?: number;
  /** 在本台设备上的最后活跃时间戳 */
  lastLoginAt: string;
}

/**
 * 云端学校状态同步响应明细契约
 */
export interface TenantStatusItem {
  schoolId: number;
  schoolName: string;
  campusName: string;
  isExpired: boolean;
  unreadCount: number;
  isActiveTenant: boolean;
  themeColorHsl?: { h: number; s: number; l: number };
}

/**
 * 云端学校状态同步响应契约
 */
export interface DeviceTenantsSyncResponse {
  tenants: TenantStatusItem[];
  serverTime: number;
}

/**
 * 顶部导航组件属性契约
 */
export interface IQpNavbarProps {
  /** 页面标题文字 (居中呈现) */
  title: string;
  /** 是否展示左侧用户头像 (默认 true) */
  showAvatar: boolean;
  /** 自定义头像 URL (若为空则取当前登录用户头像) */
  avatarUrl?: string;
  /** 背景模式: "translucent" 毛玻璃 (默认) | "solid" 纯色 | "transparent" 全透 */
  bgMode: "translucent" | "solid" | "transparent";
  /** 标题文字色彩 (默认跟随当前主题) */
  textColor?: string;
  /** 是否展示返回箭头 (二级页面使用) */
  showBack?: boolean;
}

/**
 * 抽屉组件状态机契约
 */
export interface IQpTenantDrawerState {
  /** 抽屉是否处于展开可见状态 */
  visible: boolean;
  /** 当前主手机号 (脱敏展示) */
  maskedPhone: string;
  /** 当前正在使用的大学记录 */
  activeAccount: DeviceAccountRecord | null;
  /** 本机曾登录的历史大学列表 (已排序) */
  historyAccounts: DeviceAccountRecord[];
  /** 是否正在执行切校加载 */
  isSwitching: boolean;
  /** 是否展示半屏快捷续期弹窗 */
  renewModalVisible: boolean;
  /** 待续期的目标大学存根 */
  targetRenewAccount: DeviceAccountRecord | null;
}
