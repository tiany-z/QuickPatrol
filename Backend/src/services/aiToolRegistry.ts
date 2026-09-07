/**
 * 高校后勤巡查e速办 v4.0 - M48: 7 大受控后勤事实数据工具箱
 * 文件路径: src/services/aiToolRegistry.ts
 * 核心职责: 管理 7 大工具的注册表声明，导出 OpenAI 兼容的 Function 定义，
 *           提供受控沙箱的拦截调度路由，强制注入租户上下文并记录审计存根。
 */

import {
  IToolDeclaration,
  IToolExecutionContext,
  IToolExecutionResult
} from "../contracts/aiToolContract.js";
import { patrolTools } from "./tools/patrolTools.js";
import { campusTools } from "./tools/campusTools.js";
import { ToolSecuritySandbox } from "../shared/sandbox/toolSecuritySandbox.js";

export type ToolExecutionHandler = (args: any, context: IToolExecutionContext) => Promise<any>;

export class AIToolRegistry {
  private static instance: AIToolRegistry;
  private toolHandlers: Map<string, ToolExecutionHandler> = new Map();
  private toolDeclarations: IToolDeclaration[] = [];

  private constructor() {
    this.registerAllBuiltinTools();
  }

  public static getInstance(): AIToolRegistry {
    if (!AIToolRegistry.instance) {
      AIToolRegistry.instance = new AIToolRegistry();
    }
    return AIToolRegistry.instance;
  }

  /**
   * 注册全量 7 大受控后勤事实工具
   */
  private registerAllBuiltinTools(): void {
    // 1. query_patrol_stats
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_patrol_stats",
          description: "统计指定时间范围与校区内的后勤工单宏观运行数据，如报修总数、办结率、SLA履约率等",
          parameters: {
            type: "object",
            properties: {
              timeRange: {
                type: "string",
                enum: ["TODAY", "THIS_WEEK", "THIS_MONTH"],
                description: "统计时间跨度，默认为 TODAY"
              },
              campusId: {
                type: "number",
                description: "可选的目标校区物理 ID"
              }
            },
            required: []
          }
        }
      },
      (args, ctx) => patrolTools.queryPatrolStats(args, ctx)
    );

    // 2. query_patrol_list
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_patrol_list",
          description: "多条件复合搜索本校后勤工单列表，支持隐患关键字、处理状态及加急度筛选",
          parameters: {
            type: "object",
            properties: {
              keyword: { type: "string", description: "搜索关键词，如配电箱、水龙头、空调漏水" },
              status: {
                type: "string",
                enum: ["PENDING", "IN_PROGRESS", "COMPLETED"],
                description: "工单流转状态筛选"
              },
              urgency: { type: "number", description: "加急等级：1常规，2加急，3特级加急" },
              limit: { type: "number", description: "返回记录上限，默认3条，最大5条" }
            },
            required: []
          }
        }
      },
      (args, ctx) => patrolTools.queryPatrolList(args, ctx)
    );

    // 3. query_patrol_detail
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_patrol_detail",
          description: "根据具体工单编号 (如 #LCU-2026-0091) 调取单笔工单全流程时间线与维修师傅施工存根",
          parameters: {
            type: "object",
            properties: {
              patrolSnOrId: { type: "string", description: "工单编号字符串或工单主键ID" }
            },
            required: ["patrolSnOrId"]
          }
        }
      },
      (args, ctx) => patrolTools.queryPatrolDetail(args, ctx)
    );

    // 4. query_my_patrols
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_my_patrols",
          description: "查询当前登录师生自己提交的报修工单，或维修师傅名下领取的抢修工单最新状态",
          parameters: {
            type: "object",
            properties: {
              statusFilter: {
                type: "string",
                enum: ["ALL", "UNRESOLVED", "RESOLVED"],
                description: "状态过滤，UNRESOLVED 为处理中工单"
              }
            },
            required: []
          }
        }
      },
      (args, ctx) => patrolTools.queryMyPatrols(args, ctx)
    );

    // 5. query_campus_and_departments
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_campus_and_departments",
          description: "查询本校各校区基本分布、负责后勤各细分科室（水电、保洁、木工等）的官方服务电话与办公地址",
          parameters: {
            type: "object",
            properties: {
              campusKeyword: { type: "string", description: "校区名称或简称，如西校区、东校区" },
              serviceCategory: { type: "string", description: "后勤服务分类，如水电、电梯、空调、土建" }
            },
            required: []
          }
        }
      },
      (args, ctx) => campusTools.queryCampusAndDepartments(args, ctx)
    );

    // 6. query_post_feeds
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_post_feeds",
          description: "调取校园公共广场中官方发布的最新停水、停电检修预警通报及后勤公告",
          parameters: {
            type: "object",
            properties: {
              topic: { type: "string", enum: ["NOTICE", "EMERGENCY", "ALL"], description: "通报类别" },
              keyword: { type: "string", description: "检索词，如停电、停水、高压检修" }
            },
            required: []
          }
        }
      },
      (args, ctx) => campusTools.queryPostFeeds(args, ctx)
    );

    // 7. query_service_regulations
    this.registerTool(
      {
        type: "function",
        function: {
          name: "query_service_regulations",
          description: "查询本校后勤官方服务规范字典，包括响应时限标准、自费与免费公费维修责任划分界定",
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["SLA_LIMITS", "FREE_OR_CHARGE", "FLOW_GUIDE"],
                description: "规章类别"
              },
              query: { type: "string", description: "用户关注的具体问题关键词" }
            },
            required: []
          }
        }
      },
      (args, ctx) => campusTools.queryServiceRegulations(args, ctx)
    );
  }

  /**
   * 注册单个受控工具
   */
  public registerTool(declaration: IToolDeclaration, handler: ToolExecutionHandler): void {
    const name = declaration.function.name;
    // 覆盖式注册防重
    this.toolDeclarations = this.toolDeclarations.filter((d) => d.function.name !== name);
    this.toolDeclarations.push(declaration);
    this.toolHandlers.set(name, handler);
  }

  /**
   * 获取全量下发给 OpenAI 兼容大模型的工具声明列表
   */
  public getDeclarations(): IToolDeclaration[] {
    return this.toolDeclarations;
  }

  /**
   * 执行安全沙箱工具调用 (全入口统管)
   */
  public async executeTool(
    toolName: string,
    rawArgs: Record<string, unknown> | string,
    context: IToolExecutionContext
  ): Promise<IToolExecutionResult> {
    const tStart = Date.now();
    const handler = this.toolHandlers.get(toolName);

    if (!handler) {
      return {
        success: false,
        toolName,
        durationMs: Date.now() - tStart,
        summaryTitle: `未知工具: ${toolName}`,
        errorMessage: `系统未注册名称为 [${toolName}] 的事实查询工具`
      };
    }

    try {
      // 1. 通过安全沙箱包装器执行入参白名单洗炼与租户硬锁 (算法 1)
      const sanitizedArgs = ToolSecuritySandbox.sanitizeArguments(toolName, rawArgs);

      // 2. 执行真实的物理只读查询 (强制限制 3000ms 超时)
      const rawData = await ToolSecuritySandbox.executeWithTimeout(
        handler(sanitizedArgs, context),
        3000
      );

      // 3. 执行多级隐私脱敏与 Token 压缩 (算法 3)
      const cleanData = ToolSecuritySandbox.redactSensitiveData(rawData, context);

      return {
        success: true,
        toolName,
        durationMs: Date.now() - tStart,
        summaryTitle: this.generateSummaryTitle(toolName, cleanData),
        data: cleanData
      };
    } catch (err: any) {
      return {
        success: false,
        toolName,
        durationMs: Date.now() - tStart,
        summaryTitle: `执行异常: ${toolName}`,
        errorMessage: err.message || "受控数据沙箱执行异常"
      };
    }
  }

  /**
   * 生成给前端 Thinking Pill 呈现的人性化胶囊短标题
   */
  public generateSummaryTitle(toolName: string, data: any): string {
    switch (toolName) {
      case "query_patrol_stats":
        return "已调取本校后勤大盘运行统计数据";
      case "query_patrol_list":
        return `已检索到 ${Array.isArray(data) ? data.length : 0} 笔相关工单事实`;
      case "query_patrol_detail":
        return `已调取工单 [${data?.patrolSn || "详情"}] 全流程施工档案`;
      case "query_my_patrols":
        return "已同步名下最新报修与工单动态";
      case "query_campus_and_departments":
        return "已查明相关后勤科室与值班热线";
      case "query_post_feeds":
        return "已核验校园公共广场官方检修通告";
      case "query_service_regulations":
        return "已调阅后勤官方服务承诺与维保标准";
      default:
        return "已完成事实数据核验";
    }
  }
}

export const aiToolRegistry = AIToolRegistry.getInstance();
