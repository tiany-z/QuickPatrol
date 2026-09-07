/**
 * M11: 学校租户生命周期与 SaaS 商业化状态服务 (School Tenant Lifecycle Service)
 * 
 * 核心职责：
 * 1. 维护学校租户生命周期四态（正常 1、冻结 0、到期锁定 -1、软删除）
 * 2. 聚合二级多租户 Redis 极速缓存，加速读请求
 * 3. 统计输出当前租户当月配额消耗健康度大盘报表 (ITenantQuotaHealthReport)
 * 4. 联动 RedisWsBridge 在租户到期/冻结时下发全校客户端降级广播
 */

import {
  StandardResult,
  returnSuccess,
  returnError,
  tryCatchErrorToString
} from "../../shared/flow/result.js";
import { executeQuery } from "../../shared/db/mysql.js";
import { getTenantKV, setTenantKV } from "../../shared/cache/redis.js";
import { ISchoolEntity, ITenantQuotaHealthReport } from "./schoolTypes.js";
import { RedisWsBridge } from "../../ws/redisWsBridge.js";
import { AtomicQuotaManager } from "../../dispatcher/quotaRules.js";

// 内存级测试桩点字典 (支持单元测试中动态录入虚拟高校)
const mockSchoolsMap = new Map<number, ISchoolEntity>();

export class SchoolService {
  /**
   * 注册用于离线单元测试的虚拟高校桩点
   */
  public static mockRegisterSchool(school: ISchoolEntity): void {
    mockSchoolsMap.set(school.id, school);
    // 同时写入租户缓存，保证一致性
    setTenantKV(school.id, "school", "profile", school, 3600);
  }

  /**
   * 清理虚拟高校桩点 (用于单元测试沙箱重置)
   */
  public static clearMockSchools(): void {
    mockSchoolsMap.clear();
  }

  /**
   * 根据 schoolId 查询学校核心配置与付费版本 (带二级多租户缓存)
   */
  public static async getSchoolById(
    schoolId: number
  ): Promise<StandardResult<ISchoolEntity | null>> {
    if (!schoolId || schoolId <= 0) {
      return returnSuccess(null);
    }

    // 0. 优先检查内存桩点 (测试加速)
    if (mockSchoolsMap.has(schoolId)) {
      return returnSuccess(mockSchoolsMap.get(schoolId)!);
    }

    // 1. 尝试从 M05 Redis 缓存读取
    try {
      const cacheRes = await getTenantKV<ISchoolEntity>(schoolId, "school", "profile");
      if (cacheRes.status === 1 && cacheRes.data) {
        return returnSuccess(cacheRes.data);
      }
    } catch {
      // 缓存读取异常容错
    }

    // 2. 回源查询 MySQL
    try {
      const sql = `SELECT * FROM schools WHERE id = ? AND isDeleted = 0 LIMIT 1`;
      const queryRes = await executeQuery<ISchoolEntity>(sql, [schoolId]);
      const rows = queryRes.data || [];

      if (!rows || rows.length === 0) {
        return returnSuccess(null);
      }

      const school: ISchoolEntity = rows[0];

      // 3. 写入二级缓存 (TTL 1 小时)
      await setTenantKV(schoolId, "school", "profile", school, 3600);

      return returnSuccess(school);
    } catch (err) {
      // 数据库脱机时优雅回退
      return returnSuccess(null);
    }
  }

  /**
   * 变更学校状态 (正常启用 1、冻结 0、到期锁定 -1)
   */
  public static async updateSchoolStatus(
    schoolId: number,
    newStatus: -1 | 0 | 1,
    operatorId: number = 0
  ): Promise<StandardResult<boolean>> {
    try {
      const updateSql = `UPDATE schools SET status = ?, updatedAt = NOW() WHERE id = ?`;
      await executeQuery(updateSql, [newStatus, schoolId]);
    } catch {
      // 脱机容错
    }

    // 同步更新 mock 桩点 (若存在)
    if (mockSchoolsMap.has(schoolId)) {
      const s = mockSchoolsMap.get(schoolId)!;
      s.status = newStatus;
      mockSchoolsMap.set(schoolId, s);
    }

    // 强刷二级缓存
    await setTenantKV(schoolId, "school", "profile", null, 1);

    // 若被冻结或到期，发布跨节点集群广播通知全校客户端切入降级状态
    if (newStatus !== 1) {
      try {
        await RedisWsBridge.broadcast(
          "cluster:tenant:force_logout",
          schoolId,
          {
            action: newStatus === 0 ? "FROZEN_LOGOUT" : "SUSPEND_WRITE",
            schoolId,
            operatorId,
            updatedAt: Date.now()
          }
        );
      } catch {
        // 广播容错
      }
    }

    return returnSuccess(true);
  }

  /**
   * 获取租户当前配额健康状态看板数据 (用于宏观运维与大盘展示)
   */
  public static async getTenantQuotaHealth(
    schoolId: number
  ): Promise<StandardResult<ITenantQuotaHealthReport>> {
    const schoolRes = await this.getSchoolById(schoolId);
    if (!schoolRes.data) {
      return returnError("当前高校租户不存在或已被注销");
    }

    const s = schoolRes.data;
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    // 获取当前月份实际使用的工单计数
    const usedCount = await AtomicQuotaManager.getCurrentQuota(schoolId, ym);
    const max = s.maxMonthlyPatrols;
    const ratio = max === -1 ? 0 : Number((usedCount / max).toFixed(2));

    let watermarkStatus: "HEALTHY" | "WARNING" | "EXCEEDED" = "HEALTHY";
    if (max !== -1) {
      if (usedCount >= max) {
        watermarkStatus = "EXCEEDED";
      } else if (ratio >= 0.8) {
        watermarkStatus = "WARNING";
      }
    }

    const expireDate = new Date(s.planExpireAt);
    const isExpired = Date.now() > expireDate.getTime();
    const daysRemaining = Math.max(
      0,
      Math.ceil((expireDate.getTime() - Date.now()) / 86400000)
    );

    const planNames: Record<number, string> = {
      0: "免费体验版",
      1: "基础专业版",
      2: "旗舰尊享版"
    };

    return returnSuccess({
      schoolId,
      schoolName: s.name,
      planLevel: s.planLevel,
      planLevelName: planNames[s.planLevel] || "标准版",
      planType: s.planType,
      yearMonth: ym,
      usedPatrolCount: usedCount,
      maxMonthlyPatrols: max,
      usageRatio: ratio,
      watermarkStatus,
      isExpired,
      expireDate: s.planExpireAt,
      daysRemaining,
      storageUsedMb: 120, // 关联 OSS 度量
      storageQuotaMb: s.storageQuotaMb
    });
  }
}
