<!--
  ============================================================================
  所属模块: M46 - 各校自主配置异构大模型与连通测试
  文件路径: admin-web/src/views/settings/SchoolLLMConfigView.vue
  核心职责: 提供 PC 管理端友好的厂商切换预设、参数输入、密文防偷窥脱敏回显、
            以及点击一键 Ping 测试的流式耗时毫秒徽章展示。
  ============================================================================
-->
<template>
  <div class="llm-settings-container">
    <div class="panel-header">
      <div class="title-wrap">
        <h2>高校专属 AI 大模型基座配置</h2>
        <p class="subtitle">自主接入各校公有云或私有化大语言模型，支持 5 秒轻量流式连通测速与容灾保底</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" :disabled="testing" @click="handlePingTest('primary')">
          <span v-if="testing" class="spinner"></span>
          {{ testing ? '正在探测首字时延...' : '⚡ 测试主通道连通性' }}
        </button>
        <button class="btn btn-primary" :disabled="saving" @click="handleSave">
          {{ saving ? '正在加密保存...' : '保存大模型配置' }}
        </button>
      </div>
    </div>

    <!-- 探测结果状态条展示 -->
    <div v-if="probeResult" class="probe-banner" :class="probeResult.success ? 'banner-success' : 'banner-error'">
      <div class="banner-icon">{{ probeResult.success ? '✅' : '⚠️' }}</div>
      <div class="banner-content">
        <div class="banner-title">
          {{ probeResult.success ? '连通性良好' : '端点连通异常' }}
          <span v-if="probeResult.latencyMs" class="latency-badge">
            首字往返耗时: {{ probeResult.latencyMs }}ms
          </span>
        </div>
        <div class="banner-desc">{{ probeResult.diagnosticMessage }}</div>
      </div>
    </div>

    <!-- 主选通道配置卡片 -->
    <div class="config-card">
      <div class="card-title">
        <span class="badge primary-badge">主选模型通道 (Primary)</span>
        <span class="hint">承担全校日常工单咨询与智能规章推理</span>
      </div>

      <!-- 厂商快捷预设选择 -->
      <div class="preset-selector">
        <label>选择推荐厂商预设：</label>
        <div class="preset-pills">
          <button
            v-for="p in providerPresets"
            :key="p.providerId"
            class="preset-pill"
            :class="{ active: form.primary.providerId === p.providerId }"
            @click="applyPreset(p, 'primary')"
          >
            {{ p.providerName }}
          </button>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-item span-2">
          <label>API BaseURL (端点地址)：</label>
          <input
            v-model="form.primary.baseUrl"
            type="text"
            placeholder="例如: https://api.deepseek.com/v1"
            class="input-control"
          />
        </div>

        <div class="form-item">
          <label>模型名称 (Model)：</label>
          <input
            v-model="form.primary.modelName"
            type="text"
            placeholder="例如: deepseek-chat"
            class="input-control"
          />
        </div>

        <div class="form-item">
          <label>
            API Key (已启用 AES-256 密文保险箱)：
            <span v-if="form.primary.hasConfiguredKey" class="configured-tag">已配置</span>
          </label>
          <input
            v-model="primaryKeyInput"
            type="password"
            :placeholder="form.primary.maskedApiKey || '请输入大模型 API 密钥'"
            class="input-control"
          />
        </div>

        <div class="form-item">
          <label>严谨度 (Temperature: {{ form.primary.temperature }})：</label>
          <input
            v-model.number="form.primary.temperature"
            type="range"
            min="0"
            max="1"
            step="0.1"
            class="range-control"
          />
        </div>

        <div class="form-item">
          <label>最大回复限制 (Max Tokens)：</label>
          <input
            v-model.number="form.primary.maxTokens"
            type="number"
            class="input-control"
          />
        </div>
      </div>
    </div>

    <!-- 容灾备用通道折叠开关 -->
    <div class="config-card fallback-card">
      <div class="card-header-toggle">
        <div class="card-title">
          <span class="badge fallback-badge">备用容灾通道 (Fallback)</span>
          <span class="hint">当主模型突发 503 或超时时自动无感切入</span>
        </div>
        <div class="toggle-switch">
          <input v-model="form.enableFallback" type="checkbox" id="fallbackToggle" />
          <label for="fallbackToggle"></label>
        </div>
      </div>

      <div v-if="form.enableFallback" class="form-grid" style="margin-top: 16px;">
        <div class="form-item span-2">
          <label>备用端点 BaseURL：</label>
          <input
            v-model="form.fallback.baseUrl"
            type="text"
            placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode/v1"
            class="input-control"
          />
        </div>
        <div class="form-item">
          <label>备用模型名称：</label>
          <input
            v-model="form.fallback.modelName"
            type="text"
            placeholder="例如: qwen-turbo"
            class="input-control"
          />
        </div>
        <div class="form-item">
          <label>备用 API Key：</label>
          <input
            v-model="fallbackKeyInput"
            type="password"
            :placeholder="form.fallback.maskedApiKey || '请输入备选 API 密钥'"
            class="input-control"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive } from "vue";

export default defineComponent({
  name: "SchoolLLMConfigView",
  setup() {
    const testing = ref(false);
    const saving = ref(false);
    const primaryKeyInput = ref("");
    const fallbackKeyInput = ref("");
    const probeResult = ref<any>(null);

    const providerPresets = [
      {
        providerId: "deepseek",
        providerName: "DeepSeek (深度求索)",
        defaultBaseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-chat"
      },
      {
        providerId: "qwen",
        providerName: "阿里百炼 (通义千问)",
        defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        defaultModel: "qwen-plus"
      },
      {
        providerId: "zhipu",
        providerName: "智谱 AI (GLM-4)",
        defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
        defaultModel: "glm-4-flash"
      },
      {
        providerId: "ollama",
        providerName: "校内私有化 (Ollama)",
        defaultBaseUrl: "http://10.0.0.100:11434/v1",
        defaultModel: "deepseek-r1:32b"
      }
    ];

    const form = reactive({
      primary: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000,
        maskedApiKey: "",
        hasConfiguredKey: false
      },
      enableFallback: false,
      fallback: {
        providerId: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        modelName: "qwen-turbo",
        temperature: 0.3,
        maxTokens: 2048,
        stream: true,
        timeoutMs: 15000,
        maskedApiKey: "",
        hasConfiguredKey: false
      }
    });

    const applyPreset = (preset: any, channel: "primary" | "fallback") => {
      form[channel].providerId = preset.providerId;
      form[channel].baseUrl = preset.defaultBaseUrl;
      form[channel].modelName = preset.defaultModel;
    };

    const handlePingTest = async (channel: "primary" | "fallback") => {
      testing.value = true;
      probeResult.value = null;
      try {
        const payload = {
          baseUrl: form[channel].baseUrl,
          modelName: form[channel].modelName,
          apiKeyCandidate: channel === "primary" ? primaryKeyInput.value : fallbackKeyInput.value,
          channelType: channel
        };
        const res = await fetch("/api/school/settings/test-llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        probeResult.value = json.data;
      } catch (err: any) {
        probeResult.value = {
          success: false,
          diagnosticMessage: `测试网络失败: ${err.message}`
        };
      } finally {
        testing.value = false;
      }
    };

    const handleSave = async () => {
      saving.value = true;
      try {
        const payload = {
          primary: form.primary,
          primaryApiKeyCandidate: primaryKeyInput.value || undefined,
          enableFallback: form.enableFallback,
          fallback: form.enableFallback ? form.fallback : undefined,
          fallbackApiKeyCandidate: fallbackKeyInput.value || undefined
        };
        const res = await fetch("/api/school/settings/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.code === 200) {
          alert("大模型参数已安全加密保存，并在全集群热重载生效！");
          primaryKeyInput.value = "";
          fallbackKeyInput.value = "";
        } else {
          alert(`保存失败: ${json.message}`);
        }
      } catch (err: any) {
        alert(`保存网络异常: ${err.message}`);
      } finally {
        saving.value = false;
      }
    };

    return {
      testing,
      saving,
      primaryKeyInput,
      fallbackKeyInput,
      probeResult,
      providerPresets,
      form,
      applyPreset,
      handlePingTest,
      handleSave
    };
  }
});
</script>

<style scoped>
.llm-settings-container {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.title-wrap h2 {
  font-size: 22px;
  margin: 0 0 6px 0;
  color: #1f2329;
}
.subtitle {
  margin: 0;
  font-size: 13px;
  color: #8f959e;
}
.header-actions {
  display: flex;
  gap: 12px;
}
.btn {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  font-weight: 500;
  transition: all 0.2s;
}
.btn-primary {
  background: #3370ff;
  color: #fff;
}
.btn-primary:hover {
  background: #2860e1;
}
.btn-secondary {
  background: #f0f4ff;
  color: #3370ff;
  border: 1px solid #c9d8ff;
}
.btn-secondary:hover {
  background: #e1ebff;
}
.probe-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-radius: 8px;
  margin-bottom: 20px;
}
.banner-success {
  background: #eafaf1;
  border: 1px solid #b7eb8f;
  color: #135200;
}
.banner-error {
  background: #fff2f0;
  border: 1px solid #ffccc7;
  color: #a8071a;
}
.latency-badge {
  display: inline-block;
  margin-left: 8px;
  font-size: 12px;
  background: #52c41a;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
}
.config-card {
  background: #fff;
  border: 1px solid #dee0e3;
  border-radius: 10px;
  padding: 24px;
  margin-bottom: 20px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.badge {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
}
.primary-badge {
  background: #e8f3ff;
  color: #1664ff;
}
.fallback-badge {
  background: #fff7e8;
  color: #ff7d00;
}
.hint {
  font-size: 12px;
  color: #8f959e;
}
.preset-pills {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.preset-pill {
  background: #f2f3f5;
  border: 1px solid #e5e6eb;
  padding: 6px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
}
.preset-pill.active {
  background: #3370ff;
  color: #fff;
  border-color: #3370ff;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 18px;
}
.span-2 {
  grid-column: span 2;
}
.form-item label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: #1f2329;
}
.input-control {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #bbbfc4;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}
.input-control:focus {
  border-color: #3370ff;
  outline: none;
}
.configured-tag {
  color: #52c41a;
  font-size: 12px;
  margin-left: 6px;
}
</style>
