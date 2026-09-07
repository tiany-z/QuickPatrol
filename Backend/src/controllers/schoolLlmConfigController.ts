/**
 * 高校后勤巡查e速办 v4.0 - M46: 学校大模型配置控制器
 * (School LLM Configuration & Ping Probe Controller)
 */

import { LLMConfigService } from "../services/llm/llmConfigService.js";
import { LLMProbeService } from "../services/llm/llmProbeService.js";

export interface ISchoolLlmHttpCtx {
  schoolId: number;
  userId: number;
  userRole?: number;
  query?: any;
  body?: any;
}

export class SchoolLLMConfigController {
  constructor(
    private readonly configService: LLMConfigService = new LLMConfigService(),
    private readonly probeService: LLMProbeService = new LLMProbeService()
  ) {}

  /**
   * GET /api/school/settings/llm 或 /api/v1/school/settings/llm
   * 查询当前学校的大模型脱敏配置
   */
  public async getConfig(ctx: ISchoolLlmHttpCtx): Promise<any> {
    try {
      const { schoolId } = ctx;
      if (!schoolId || schoolId <= 0) {
        return { code: 401, message: "未授权：缺少有效的学校租户上下文" };
      }

      const viewConfig = await this.configService.getSchoolLLMConfigView(schoolId);
      return {
        code: 200,
        data: viewConfig,
        message: "大模型配置查询成功"
      };
    } catch (err: any) {
      return { code: 500, message: `查询大模型配置失败: ${err.message}` };
    }
  }

  /**
   * POST /api/school/settings/llm 或 PUT /api/v1/school/settings/llm
   * 保存或更新当前学校的大模型加密配置
   */
  public async saveConfig(ctx: ISchoolLlmHttpCtx): Promise<any> {
    try {
      const { schoolId, userId, body } = ctx;
      if (!schoolId || schoolId <= 0) {
        return { code: 401, message: "未授权：缺少有效的学校租户上下文" };
      }

      const { primary, primaryApiKeyCandidate, enableFallback, fallback, fallbackApiKeyCandidate } = body || {};

      if (!primary || !primary.baseUrl || !primary.modelName) {
        return { code: 400, message: "主选大模型 BaseURL 与模型名称为必填项" };
      }

      await this.configService.saveSchoolLLMConfig(schoolId, userId || 1, {
        primary,
        primaryApiKeyCandidate,
        enableFallback: Boolean(enableFallback),
        fallback,
        fallbackApiKeyCandidate
      });

      return {
        code: 200,
        message: "大模型配置已安全加密持久化并完成集群广播热重载"
      };
    } catch (err: any) {
      return { code: 500, message: `保存配置失败: ${err.message}` };
    }
  }

  /**
   * POST /api/school/settings/test-llm 或 /api/v1/school/settings/test-llm
   * 执行大模型 5 秒轻量流式连通性握手探针 (Ping & TTFT)
   */
  public async testConnectivity(ctx: ISchoolLlmHttpCtx): Promise<any> {
    try {
      const { schoolId, body } = ctx;
      if (!schoolId || schoolId <= 0) {
        return { code: 401, message: "未授权：缺少有效的学校租户上下文" };
      }

      const { baseUrl, modelName, apiKeyCandidate, channelType } = body || {};

      if (!baseUrl || !modelName) {
        return { code: 400, message: "待测端点 BaseURL 与模型名称不能为空" };
      }

      let testKey = apiKeyCandidate;

      // 若用户未传待测试的新 Key，则尝试解密已保存在数据库中的 Key 进行测试
      if (!testKey || testKey.trim() === "" || testKey === "__USE_PERSISTED_KEY__") {
        try {
          const decryptedRuntime = await this.configService.getRuntimeDecryptedConfig(
            schoolId,
            channelType === "fallback" ? "fallback" : "primary"
          );
          testKey = decryptedRuntime.apiKeyPlain;
        } catch {
          // 降级拦截
        }
      }

      if (!testKey || testKey.trim() === "") {
        return { code: 400, message: "请先填写或保存待测通道的 API Key" };
      }

      const probeResult = await this.probeService.pingModelEndpoint(baseUrl, testKey, modelName);

      return {
        code: 200,
        data: probeResult,
        message: probeResult.success ? "连通性测试通过" : "连通性测试未通过"
      };
    } catch (err: any) {
      return { code: 500, message: `执行连通性测试异常: ${err.message}` };
    }
  }
}

export const schoolLLMConfigController = new SchoolLLMConfigController();
