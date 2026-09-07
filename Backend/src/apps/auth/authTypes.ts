/**
 * M13: 微信静默授权登录与多租户双身份签发 核心类型定义 (Auth & Multi-Tenant JWT Types)
 */

export interface IUserEntity {
  id: number;
  schoolId: number;
  openId: string;
  unionId?: string;
  realName: string;
  nickName: string;
  avatarUrl: string;
  phone: string;
  jobNo: string;
  role: 0 | 1 | 2 | 3 | 4 | 9; // 0学生, 1教工, 2师傅, 3科室主管, 4校管, 9超管
  departmentId?: number;
  isBan: 0 | 1;
  loginTime: number;
  lastLoginTime: string | null;
  createdAt?: string;
  updatedAt?: string;
  isDeleted?: 0 | 1;
}

export interface IMultiTenantJwtPayload {
  /** 所属学校租户 ID (强制租户隔离) */
  schoolId: number;
  /** 系统内用户唯一自增主键 */
  userId: number;
  /** 微信小程序 openId */
  openId: string;
  /** 底层物理角色 (0学生, 1教工, 2师傅, 3科室主管, 4校管, 9超管) */
  role: number;
  /** 当前活动工作视角: 1师生巡查端, 2后勤施工端 */
  activeType: 1 | 2;
  /** 令牌版本号 (用于后台一键下线或密码变更即时废弃) */
  tokenVersion: number;
  /** 签发时间戳 (秒) */
  iat?: number;
  /** 过期时间戳 (秒) */
  exp?: number;
}

export interface IWeChatLoginRequest {
  /** 目标登录学校 ID */
  schoolId: number;
  /** 微信 wx.login 返回的临时授权码 */
  code: string;
  /** 可选的用户微信昵称预填 */
  nickName?: string;
  /** 可选的用户微信头像预填 */
  avatarUrl?: string;
  /** 期望进入的初始工作视角 (可选，默认 1) */
  preferredActiveType?: 1 | 2;
}

export interface IIdentityOptionDto {
  type: 1 | 2;
  typeName: string;
  desc: string;
}

export interface IAuthResultDto {
  /** 30天长效双向验签 JWT Token */
  token: string;
  /** 用户基础信息 */
  userInfo: {
    userId: number;
    schoolId: number;
    realName: string;
    nickName: string;
    avatarUrl: string;
    phone: string;
    jobNo: string;
    role: number;
    roleText: string;
  };
  /** 当前生效的活动工作视角: 1师生端, 2师傅端 */
  activeType: 1 | 2;
  /** 用户有资格切换的全部身份列表 */
  availableIdentities: IIdentityOptionDto[];
  /** 是否需要补充手机号绑定 (无手机号时为 true) */
  requirePhoneBinding: boolean;
}

export interface ISwitchIdentityRequest {
  /** 目标期望切换的身份视角: 1师生端, 2师傅端 */
  targetActiveType: 1 | 2;
}

export interface ISwitchIdentityResponse {
  /** 切换成功后签发的全新 JWT Token */
  token: string;
  /** 当前已生效的工作视角 */
  activeType: 1 | 2;
  /** 用户物理角色 */
  role: number;
}
