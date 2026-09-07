/**
 * 高校后勤巡查e速办 v4.0 - M43: 用户在线状态感知防骚扰穿透引擎 强类型契约
 * (Presence Engine & Fallback Channel Types)
 */

/**
 * 用户实时在线状态枚举
 */
export enum UserPresenceStatus {
  ONLINE_ACTIVE = 'online_active', // 正在使用小程序 (前台活跃)
  ONLINE_IDLE = 'online_idle',     // 小程序处于后台但长连接未断 (挂起)
  OFFLINE = 'offline'              // 物理离线
}

/**
 * 用户在线状态元数据
 */
export interface IUserPresenceState {
  schoolId: number;
  userId: number;
  status: UserPresenceStatus;
  lastHeartbeatAt: string;
  clientIp?: string;
  deviceModel?: string;
}

/**
 * 延迟时间轮中序列化的任务载荷
 */
export interface IFallbackDelayTaskPayload {
  taskId: string;
  schoolId: number;
  receiverId: number;
  messageId: number;
  priority: 'low' | 'normal' | 'urgent';
  createdAt: string;
  scheduledTriggerAt: string;
}

/**
 * 外部离线穿透状态枚举 (对齐物理表 14 messages)
 */
export enum ExternalPushStatus {
  NONE = 'none',
  WX_SENT = 'wx_sent',
  SMS_SENT = 'sms_sent',
  FAILED = 'failed'
}

/**
 * 外部穿透执行结算 DTO
 */
export interface IPenetrationResultDto {
  messageId: number;
  receiverId: number;
  finalStatus: ExternalPushStatus;
  channelUsed: 'NONE' | 'WX_SUBSCRIBE' | 'SMS_CARRIER';
  costTimeMs: number;
  suppressReason?: string;
}

/**
 * 微信小程序/服务号订阅消息发信请求体
 */
export interface IWxSubscribeMsgPayload {
  touser: string;         // 用户 openId
  template_id: string;    // 微信审批模板 ID
  page: string;           // 点击跳转的小程序页面
  data: Record<string, { value: string }>;
  miniprogram_state?: 'developer' | 'trial' | 'formal';
}

/**
 * 运营商短信发信载荷
 */
export interface ISmsSendPayload {
  phoneNumber: string;      // 接收人手机号 (国内 11 位)
  templateId: string;       // 短信平台模板 ID
  templateParams: string[]; // 模板占位符参数 (如: ["配电房漏电", "30分钟"])
}

/**
 * 在线感知控制器 HTTP 上下文
 */
export interface IPresenceHttpCtx {
  schoolId: number;
  userId: number;
  userRole?: number;
  body?: any;
  query?: any;
  params?: any;
}
