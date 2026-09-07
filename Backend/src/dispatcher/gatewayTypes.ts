import http from "http";
import { StandardResult } from "../shared/flow/result.js";
import { ISagaWithdrawStack, LockedRowStub } from "../shared/sql/sagaTypes.js";

export { LockedRowStub, ISagaWithdrawStack } from "../shared/sql/sagaTypes.js";

/**
 * 注入业务 Handler 的请求数据封装
 */
export interface HttpRequestData<TBody = any, TQuery = Record<string, string>> {
  req: http.IncomingMessage;
  res?: http.ServerResponse;
  body: TBody;
  query: TQuery;
  run?: ((params: any, ctx?: any) => Promise<StandardResult<any>>) | null;
}

/**
 * 贯穿微应用业务调用的统一调度上下文
 */
export interface RequestContext {
  /** 本次 HTTP 请求的全局唯一链路追踪 ID (UUID) */
  requestId: string;
  /** 本次请求绑定的 Saga 逆序补偿撤销栈容器 */
  withdrawStack: ISagaWithdrawStack;
  /** 本次请求持有的分布式行级排他锁清单 */
  lockedRows: LockedRowStub[];
  /** JWT 验签成功后提取的师生多租户身份载荷 */
  userPayload?: {
    schoolId?: number;
    userId?: number | string;
    openId?: string;
    unionId?: string;
    role?: number;
    activeType?: number;
    username?: string;
    [key: string]: any;
  } | null;
}

/**
 * 微应用 API 契约导出规范 (Convention Over Configuration)
 */
export interface ApiEndpointModule<TReq = any, TRes = any> {
  routePath?: string;
  /** 是否需要强制鉴权 (默认 true；若显式设为 false 则对全网免密放行) */
  authRequired?: boolean;
  /** 可选的 SQL AST 配置 (启动期自动预编译) */
  astConfig?: any;
  /** 预编译生成的 AST 执行函数 */
  run?: ((params: any, ctx?: RequestContext) => Promise<StandardResult<any>>) | null;
  /** 核心业务处理控制器 */
  handler: (
    data: HttpRequestData<TReq>,
    ctx: RequestContext
  ) => Promise<StandardResult<TRes>>;
}
