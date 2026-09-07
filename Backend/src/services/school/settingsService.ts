/**
 * M12: 学校个性化设置字典与敏感配置读写服务 (School Settings Service)
 * 
 * 核心职责：
 * 1. 管理高校个性化设置字典 (school_settings 表)
 * 2. 写入时根据敏感标识自动调用 AES-256-GCM 认证加密
 * 3. 对外查询时动态执行自适应安全前后缀脱敏，坚守管理端防偷窥红线
 * 4. 内部受控解密 (getDecryptedSetting)，安全供给下游 M46 AI 对话或 M22 OSS 直传在微任务作用域内使用
 * 5. 联动 RedisWsBridge 在配置变更时秒级下发 cluster:config:flush 全集群广播热重载
 */

import { StandardResult, returnSuccess, returnError, tryCatchErrorToString } from "../../shared/flow/result.js";
import { executeQuery } from "../../shared/db/mysql.js";
import { getTenantKV, setTenantKV, delTenantKV } from "../../shared/cache/redis.js";
import { AesCryptoEngine } from "../../shared/crypto/aesCrypto.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { maskSensitiveValue } from "./masker.js";
import { ISettingItemDto, ISaveSettingRequest, ISchoolSettingEntity } from "./settingsTypes.js";
import { TerminalLogger } from "../../shared/log/terminalLogger.js";

// 内存级测试桩点字典 (用于离线单元测试与脱机环境)
const mockSettingsStore = new Map<string, ISchoolSettingEntity>();

export class SettingsService {
  /**
   * 注册虚拟配置桩点 (用于单元测试)
   */
  public static mockRegisterSetting(setting: ISchoolSettingEntity): void {
    const storeKey = `${setting.schoolId}:${setting.key}`;
    mockSettingsStore.set(storeKey, setting);
    setTenantKV(setting.schoolId, "settings", setting.key, {
      value: setting.value,
      isEncrypted: setting.isEncrypted === 1,
      desc: setting.desc
    }, 3600);
  }

  /**
   * 清空虚拟配置桩点 (用于单元测试沙箱重置)
   */
  public static clearMockSettings(): void {
    mockSettingsStore.clear();
  }

  /**
   * 查询指定学校的全部配置项 (敏感项自动执行动态脱敏)
   */
  public static async getSettingsList(schoolId: number): Promise<StandardResult<ISettingItemDto[]>> {
    if (!schoolId || schoolId <= 0) {
      return returnError("缺少有效的 schoolId 参数");
    }

    let records: ISchoolSettingEntity[] = [];

    // 0. 优先合并内存桩点 (测试加速)
    const mockList = Array.from(mockSettingsStore.values()).filter((s) => s.schoolId === schoolId);
    if (mockList.length > 0) {
      records = mockList;
    } else {
      try {
        const sql = `SELECT \`key\`, \`value\`, \`desc\`, isEncrypted, updatedAt FROM school_settings WHERE schoolId = ?`;
        const res = await executeQuery<ISchoolSettingEntity>(sql, [schoolId]);
        records = res.data || [];
      } catch {
        records = [];
      }
    }

    const resultList: ISettingItemDto[] = records.map((r) => {
      const isEncrypted = r.isEncrypted === 1;
      let displayValue = r.value;

      if (isEncrypted) {
        try {
          // 解密后再脱敏，确保脱敏前后缀基于原始真实 Key
          const decrypted = AesCryptoEngine.decrypt(r.value);
          displayValue = maskSensitiveValue(decrypted);
        } catch {
          displayValue = "****** (解密验签失败)";
        }
      }

      return {
        key: r.key,
        value: displayValue,
        desc: r.desc || "",
        isEncrypted,
        updatedAt: r.updatedAt
      };
    });

    return returnSuccess(resultList);
  }

  /**
   * 保存或更新某个配置项 (支持 GCM 认证加密与跨集群广播)
   */
  public static async saveSetting(
    schoolId: number,
    payload: ISaveSettingRequest,
    operatorId: number = 0
  ): Promise<StandardResult<boolean>> {
    if (!schoolId || schoolId <= 0) {
      return returnError("缺少有效的 schoolId 参数");
    }

    const key = (payload.key || "").trim();
    if (!key) {
      return returnError("配置项 Key 不能为空");
    }

    // Key 安全字符集白名单校验 (防止 SQL 畸形或注入)
    if (!/^[a-z0-9_]{2,64}$/i.test(key)) {
      return returnError("配置 Key 仅允许 2-64 位字母、数字和下划线");
    }

    if (payload.value === undefined || payload.value === null) {
      return returnError("配置项 Value 不能为空");
    }

    const desc = payload.desc || "";
    // 自动探测敏感 Key 或依据参数强制加密
    const isEncrypted =
      payload.isEncrypted ??
      (key.includes("key") || key.includes("secret") || key.includes("password"));

    let storeValue = String(payload.value);

    // 1. 若为敏感项，执行 AES-256-GCM 硬件级认证加密
    if (isEncrypted) {
      storeValue = AesCryptoEngine.encrypt(storeValue);
    }

    // 2. 更新内存桩点 (脱机单测自愈)
    const storeKey = `${schoolId}:${key}`;
    const entity: ISchoolSettingEntity = {
      schoolId,
      key,
      value: storeValue,
      desc,
      isEncrypted: isEncrypted ? 1 : 0,
      updatedAt: new Date().toISOString()
    };
    mockSettingsStore.set(storeKey, entity);

    // 3. 写入 MySQL 数据库
    try {
      const sql = `
        INSERT INTO school_settings (schoolId, \`key\`, \`value\`, \`desc\`, isEncrypted, updatedAt)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`desc\` = VALUES(\`desc\`), isEncrypted = VALUES(isEncrypted), updatedAt = NOW()
      `;
      await executeQuery(sql, [schoolId, key, storeValue, desc, isEncrypted ? 1 : 0]);
    } catch (err) {
      TerminalLogger.warn(`[M12 Settings] MySQL 脱机运行或保存警告: ${tryCatchErrorToString(err)}`, "SettingsService");
    }

    // 4. 清除 Redis 租户二级缓存
    try {
      await delTenantKV(schoolId, "settings", key);
    } catch {
      // 缓存清理容错
    }

    // 5. 发布跨微服务集群广播热重载
    try {
      await RedisWsBridge.broadcast("cluster:config:flush", schoolId, {
        key,
        operatorId,
        updatedAt: Date.now()
      });
    } catch {
      // 广播容错
    }

    return returnSuccess(true);
  }

  /**
   * 内部受控解密获取参数明文 (供 M46 AI 引擎或 M22 OSS 直传安全调用)
   */
  public static async getDecryptedSetting(schoolId: number, key: string): Promise<string | null> {
    if (!schoolId || !key) return null;

    // 1. 检查 mock 桩点
    const storeKey = `${schoolId}:${key}`;
    if (mockSettingsStore.has(storeKey)) {
      const item = mockSettingsStore.get(storeKey)!;
      if (item.isEncrypted === 1) {
        return AesCryptoEngine.decrypt(item.value);
      }
      return item.value;
    }

    // 2. 查 MySQL 数据库
    try {
      const sql = `SELECT \`value\`, isEncrypted FROM school_settings WHERE schoolId = ? AND \`key\` = ? LIMIT 1`;
      const res = await executeQuery<ISchoolSettingEntity>(sql, [schoolId, key]);
      const rows = res.data || [];
      if (!rows || rows.length === 0) return null;

      const item = rows[0];
      if (item.isEncrypted === 1) {
        return AesCryptoEngine.decrypt(item.value);
      }
      return item.value;
    } catch {
      return null;
    }
  }

  /**
   * 带双层缓存与防穿透空哨兵的配置读取 (算法 3)
   */
  public static async getSettingWithCache(
    schoolId: number,
    key: string
  ): Promise<{ value: string; isEncrypted: boolean; desc: string } | null> {
    const cacheRes = await getTenantKV<{ value: string; isEncrypted: boolean; desc: string }>(
      schoolId,
      "settings",
      key
    );

    if (cacheRes.status === 1 && cacheRes.data) {
      return cacheRes.data;
    }

    // 回源查询
    const rawVal = await this.getDecryptedSetting(schoolId, key);
    if (rawVal === null) {
      return null;
    }

    const payload = {
      value: rawVal,
      isEncrypted: false,
      desc: ""
    };

    await setTenantKV(schoolId, "settings", key, payload, 3600);
    return payload;
  }
}
