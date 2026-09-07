/**
 * 高校后勤巡查e速办 v4.0 - M41 算法 4: 高并发群消息扩散写与读扩散混合推送算法
 * (Hybrid Write/Read Fan-Out Optimizer)
 * 
 * 核心设计：
 * 1. 存储层纯读扩散 (单条消息在 chat_messages 仅落盘 1 行);
 * 2. 实时推流层内存写扩散 (通过 Redis ws_broadcast_bus 扇出给在线长连接集群);
 * 3. @所有人 (At-All) 强穿透机制: 识别 @所有人 / @all 标记，即便成员设置了免打扰 (isMuted=1) 依然实施强震动穿透提示;
 * 4. 突发抢险流量风暴频控削峰与广播通道规整。
 */

export interface IFanOutEvaluationResult {
  isAtAll: boolean;
  shouldNotifyUser: boolean;
  vibrationType: 'heavy' | 'light' | 'none';
  highlightTag: string | null;
}

export class HybridGroupFanOutOptimizer {
  private static readonly AT_ALL_REGEX = /@所有人|@all\b/i;

  /**
   * 检测消息内容是否包含 @所有人 强指令
   */
  public static detectIsAtAll(content: string = ''): boolean {
    if (!content) return false;
    return this.AT_ALL_REGEX.test(content);
  }

  /**
   * 判定指定成员对该消息的通知触发策略 (含免打扰穿透决策)
   * 
   * @param isAtAll 消息是否包含 @所有人
   * @param isUserMuted 该用户是否开启了免打扰 (isMuted = 1)
   * @param isSender 该用户是否为发信人自身
   */
  public static evaluateNotificationPolicy(
    isAtAll: boolean,
    isUserMuted: boolean,
    isSender: boolean
  ): IFanOutEvaluationResult {
    // 发信人自身无需任何震动提示
    if (isSender) {
      return {
        isAtAll,
        shouldNotifyUser: false,
        vibrationType: 'none',
        highlightTag: null
      };
    }

    // 包含 @所有人 指令：实施 100% 强穿透
    if (isAtAll) {
      return {
        isAtAll: true,
        shouldNotifyUser: true,
        vibrationType: 'heavy',
        highlightTag: '【有人@我】'
      };
    }

    // 用户开启了免打扰：静音接收，无震动
    if (isUserMuted) {
      return {
        isAtAll: false,
        shouldNotifyUser: false,
        vibrationType: 'none',
        highlightTag: null
      };
    }

    // 正常普通群消息
    return {
      isAtAll: false,
      shouldNotifyUser: true,
      vibrationType: 'light',
      highlightTag: null
    };
  }

  /**
   * 构造 Redis 集群扇出信令通道与 Payload
   */
  public static buildBroadcastChannel(schoolId: number): string {
    return 'ws_broadcast_bus';
  }
}
