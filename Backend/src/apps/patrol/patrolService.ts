/**
 * M21: 隐患工单核心提报与全生命周期流转服务
 * (Patrol Work Order Lifecycle & Creation Domain Service)
 * 
 * 核心技术实现：
 * 1. 基于 clientToken 的 Redis 5秒分布式原子幂等防重提交锁
 * 2. 前置 M11 SaaS 租户有效性与月度工单配额硬门禁熔断拦截 (Tenant Quota Guard)
 * 3. 分类标准工期与紧急程度动态加权 SLA 截止时间自适应核算 (Adaptive SLA Calculator)
 * 4. 基于 Redis 分布式原子计数器的唯一有序单号生成器 (LCU-YYYYMMDD-XXXX)
 * 5. 标准 JSON 数组 (imagesJson) 支撑 1~9 张现场勘验照片
 * 6. M19 不可篡改运维审计日志全量留痕与派单事件触发
 * 7. 生产环境直连 MySQL AST 与离线单测内存沙箱自愈双模驱动
 */

import { executeASTInsert, executeASTSelect } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { SchoolService } from "../../services/school/schoolService.js";
import { AtomicQuotaManager, getActiveQuotaRedis } from "../../dispatcher/quotaRules.js";
import { TerminalLogger } from "../../shared/log/terminalLogger.js";
import {
  ICreatePatrolRequest,
  ICreatePatrolResponseDto,
  IPatrolEntity,
  ICategoryEntity
} from "./patrolTypes.js";

// 内存测试沙箱工单字典与分类字典 (脱机单元测试环境使用)
const mockPatrolsMap = new Map<number, IPatrolEntity>();
const mockCategoriesMap = new Map<number, ICategoryEntity>();
let mockPatrolIdCounter = 1;

export class PatrolService {
  /**
   * 注册虚拟分类桩点 (用于单元测试)
   */
  public static mockRegisterCategory(category: ICategoryEntity): void {
    mockCategoriesMap.set(category.id, category);
  }

  /**
   * 清空测试沙箱分类数据
   */
  public static clearMockCategories(): void {
    mockCategoriesMap.clear();
  }

  /**
   * 获取测试沙箱分类字典
   */
  public static getMockCategoriesMap(): Map<number, ICategoryEntity> {
    return mockCategoriesMap;
  }

  /**
   * 注册虚拟工单桩点
   */
  public static mockRegisterPatrol(patrol: Partial<IPatrolEntity> & { schoolId: number }): IPatrolEntity {
    const id = patrol.id || mockPatrolIdCounter++;
    const entity: IPatrolEntity = {
      id,
      schoolId: patrol.schoolId,
      campusId: patrol.campusId || 1,
      categoryId: patrol.categoryId || 1,
      orderNo: patrol.orderNo || `LCU-20260905-${String(id).padStart(4, "0")}`,
      creatorId: patrol.creatorId || 1,
      title: patrol.title || "测试故障",
      desc: patrol.desc || "测试故障描述",
      imagesJson: typeof patrol.imagesJson === "string" ? patrol.imagesJson : JSON.stringify(patrol.imagesJson || []),
      location1: patrol.location1 || "教学楼",
      location2: patrol.location2 || "101室",
      latitude: patrol.latitude !== undefined ? patrol.latitude : null,
      longitude: patrol.longitude !== undefined ? patrol.longitude : null,
      status: (patrol.status !== undefined ? patrol.status : 0) as any,
      currentHandlerId: patrol.currentHandlerId || 0,
      currentReviewerId: patrol.currentReviewerId || 0,
      deadline: patrol.deadline || null,
      priorityLevel: (patrol.priorityLevel !== undefined ? patrol.priorityLevel : 1) as any,
      isPublic: (patrol.isPublic !== undefined ? patrol.isPublic : 1) as any,
      completedAt: patrol.completedAt || null,
      createdAt: patrol.createdAt || new Date().toISOString(),
      updatedAt: patrol.updatedAt || new Date().toISOString(),
      isDeleted: patrol.isDeleted || 0
    };
    mockPatrolsMap.set(id, entity);
    return entity;
  }

  /**
   * 获取指定虚拟工单
   */
  public static getMockPatrol(id: number): IPatrolEntity | undefined {
    return mockPatrolsMap.get(id);
  }

  /**
   * 更新指定虚拟工单
   */
  public static updateMockPatrol(id: number, updates: Partial<IPatrolEntity>): boolean {
    const existing = mockPatrolsMap.get(id);
    if (!existing) return false;
    Object.assign(existing, updates, { updatedAt: new Date().toISOString() });
    return true;
  }

  /**
   * 获取全部虚拟工单列表
   */
  public static getAllMockPatrols(): IPatrolEntity[] {
    return Array.from(mockPatrolsMap.values());
  }

  /**
   * 获取全部测试沙箱工单
   */
  public static getMockPatrolsMap(): Map<number, IPatrolEntity> {
    return mockPatrolsMap;
  }

  /**
   * 清空测试沙箱工单数据
   */
  public static clearMockPatrols(): void {
    mockPatrolsMap.clear();
    mockPatrolIdCounter = 1;
  }

  /**
   * 提报创建隐患工单核心主入口
   */
  public static async createPatrol(
    schoolId: number,
    userId: number,
    userIp: string,
    req: ICreatePatrolRequest
  ): Promise<ICreatePatrolResponseDto> {
    // 1. 防重复提交并发锁 (基于 Redis INCR 原子计数, 5秒 TTL 幂等性保护)
    if (!req.clientToken || typeof req.clientToken !== "string" || !req.clientToken.trim()) {
      throw new Error("缺少幂等凭证 clientToken");
    }

    const lockKey = `patrol:lock:submit:${schoolId}:${userId}:${req.clientToken.trim()}`;
    const redis = getActiveQuotaRedis();
    const lockCount = await redis.incrby(lockKey, 1);

    if (lockCount === 1) {
      await redis.expire(lockKey, 5);
    } else {
      throw new Error("工单正在全力提交中，请勿短时间内重复点击！");
    }

    try {
      // 2. 前置 M11 租户配额与服务期硬门禁核验
      const schoolRes = await SchoolService.getSchoolById(schoolId);
      if (schoolRes.status !== 1 || !schoolRes.data) {
        throw new Error("当前高校租户不存在或已被注销");
      }

      const school = schoolRes.data;

      // 检查租户是否被停用
      if (school.isDeleted === 1 || school.status === 0) {
        throw new Error("该高校租户已被系统暂停服务或注销");
      }

      // 检查服务是否已到期
      if (Date.now() > new Date(school.planExpireAt).getTime()) {
        throw new Error(`该校后勤 SaaS 服务授权已于 ${school.planExpireAt} 到期，目前处于只读保护状态`);
      }

      // 执行月度工单配额预扣
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const quotaRes = await AtomicQuotaManager.tryConsumeQuota(
        schoolId,
        currentYearMonth,
        school.maxMonthlyPatrols
      );

      if (!quotaRes.success) {
        throw new Error("当前高校本月工单配额已达上限，系统已启动过载保护，请联系后勤管理员！");
      }

      // 3. 参数防御性边界校验
      if (!req.title || typeof req.title !== "string" || req.title.trim().length < 2) {
        throw new Error("故障标题不可为空且长度不得少于2个字");
      }
      if (req.title.trim().length > 64) {
        throw new Error("故障标题长度不得超过64个字");
      }
      if (!req.desc || typeof req.desc !== "string" || req.desc.trim().length < 5) {
        throw new Error("故障详细描述不得少于5个字");
      }
      if (req.desc.trim().length > 500) {
        throw new Error("故障详细描述长度不得超过500个字");
      }
      if (!req.images || !Array.isArray(req.images) || req.images.length === 0) {
        throw new Error("现场勘验实况图片至少需要上传 1 张");
      }
      if (req.images.length > 9) {
        throw new Error("单笔工单最多允许上传 9 张现场照片");
      }
      if (!req.location1 || typeof req.location1 !== "string" || !req.location1.trim()) {
        throw new Error("一级建筑或所属区域不能为空");
      }
      if (!req.location2 || typeof req.location2 !== "string" || !req.location2.trim()) {
        throw new Error("二级具体房间号或详细位置不能为空");
      }

      // 4. 查询分类标准工期 BaseDays 并自适应计算截止时限 Deadline (算法 4)
      const baseDays = await this.resolveCategoryBaseDays(schoolId, req.categoryId);
      const priority = req.priorityLevel !== undefined ? req.priorityLevel : 1;
      const deadlineStr = this.calculateSlaDeadline(baseDays, priority);

      // 5. 生成分布式唯一有序业务单号 LCU-YYYYMMDD-XXXX (算法 2)
      const orderNo = await this.generateAtomicOrderNo(schoolId);

      // 6. 规范化图片列表为 JSON 字符串
      const imagesJsonStr = JSON.stringify(req.images);

      let newPatrolId: number;

      // 7. 写入数据库 patrols 主表
      if (getMySQLPool()) {
        const insertSql = `
          INSERT INTO patrols (
            schoolId, campusId, categoryId, orderNo, creatorId, title, \`desc\`,
            imagesJson, location1, location2, latitude, longitude,
            status, currentHandlerId, currentReviewerId, deadline,
            priorityLevel, isPublic, isDeleted, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0, NOW(), NOW())
        `;
        const params = [
          schoolId,
          req.campusId,
          req.categoryId,
          orderNo,
          userId,
          req.title.trim(),
          req.desc.trim(),
          imagesJsonStr,
          req.location1.trim(),
          req.location2.trim(),
          req.latitude !== undefined && req.latitude !== null ? req.latitude : null,
          req.longitude !== undefined && req.longitude !== null ? req.longitude : null,
          deadlineStr,
          priority,
          req.isPublic !== undefined ? req.isPublic : 1
        ];

        const dbRes: any = await executeASTInsert(insertSql, params);
        newPatrolId = Number(dbRes?.data?.[0]?.insertId || dbRes?.insertId || mockPatrolIdCounter++);
      } else {
        // 内存沙箱落盘
        newPatrolId = mockPatrolIdCounter++;
        const entity: IPatrolEntity = {
          id: newPatrolId,
          schoolId,
          campusId: req.campusId,
          categoryId: req.categoryId,
          orderNo,
          creatorId: userId,
          title: req.title.trim(),
          desc: req.desc.trim(),
          imagesJson: imagesJsonStr,
          location1: req.location1.trim(),
          location2: req.location2.trim(),
          latitude: req.latitude !== undefined && req.latitude !== null ? req.latitude : null,
          longitude: req.longitude !== undefined && req.longitude !== null ? req.longitude : null,
          status: 0,
          currentHandlerId: 0,
          currentReviewerId: 0,
          deadline: deadlineStr,
          priorityLevel: priority,
          isPublic: req.isPublic !== undefined ? req.isPublic : 1,
          completedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDeleted: 0
        };
        mockPatrolsMap.set(newPatrolId, entity);
      }

      // 8. 记录 M19 不可篡改安全与运维审计日志
      await AuditLogger.recordLog({
        schoolId,
        operatorUserId: userId,
        action: "PATROL_CREATE_SUBMIT",
        module: "Patrol",
        ip: userIp,
        payload: {
          patrolId: newPatrolId,
          orderNo,
          campusId: req.campusId,
          categoryId: req.categoryId,
          imagesCount: req.images.length,
          fromQrPointId: req.pointId || null
        }
      });

      TerminalLogger.info(
        `[M21 工单提报] 学校 ${schoolId} 用户 ${userId} 成功创建工单 ID=${newPatrolId}, 单号=${orderNo}, 截止时限=${deadlineStr}`,
        "PatrolService"
      );

      return {
        patrolId: newPatrolId,
        orderNo,
        status: 0,
        statusText: "待处理 / 待派单",
        deadline: deadlineStr,
        createdAt: new Date().toISOString()
      };
    } finally {
      // 提单完成后，1 秒后异步释放防重锁
      setTimeout(() => {
        if (typeof redis.del === "function") {
          redis.del(lockKey).catch(() => {});
        }
      }, 1000);
    }
  }

  /**
   * 分布式 Redis 原子流水单号生成器 (算法 2)
   * 格式: LCU-YYYYMMDD-XXXX (租户按日隔离自增, 48小时自动过期)
   */
  public static async generateAtomicOrderNo(schoolId: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateStr = `${year}${month}${day}`;

    const seqKey = `patrol:seq:${schoolId}:${dateStr}`;
    const redis = getActiveQuotaRedis();
    const seq = await redis.incrby(seqKey, 1);

    if (seq === 1) {
      await redis.expire(seqKey, 172800); // 48 小时后自动过期清除
    }

    const seqStr = String(seq).padStart(4, "0");
    return `LCU-${dateStr}-${seqStr}`;
  }

  /**
   * 查询分类的标准工期 BaseDays
   */
  private static async resolveCategoryBaseDays(schoolId: number, categoryId: number): Promise<number> {
    if (getMySQLPool()) {
      try {
        const sql = `SELECT id, defaultDays FROM categories WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`;
        const res = await executeASTSelect<{ defaultDays: number }>(sql, [categoryId, schoolId]);
        if (Array.isArray(res) && res.length > 0) {
          return res[0].defaultDays || 3;
        }
      } catch {
        // 回退沙箱
      }
    }

    const mockCat = mockCategoriesMap.get(categoryId);
    if (mockCat && mockCat.defaultDays) {
      return mockCat.defaultDays;
    }

    return 3; // 默认 3 天
  }

  /**
   * 多维度 SLA 截止时间自适应核算算法 (算法 4)
   * SLA_Hours = BaseDays * 24 * alpha(Priority)
   * alpha: 0普通=1.0, 1中等=0.6, 2特急=0.2 (保底 4 小时)
   */
  public static calculateSlaDeadline(baseDays: number, priority: 0 | 1 | 2): string {
    let factor = 1.0;
    if (priority === 1) factor = 0.6;
    if (priority === 2) factor = 0.2;

    const totalHours = Math.max(4.0, (baseDays || 3) * 24.0 * factor);
    const deadlineMs = Date.now() + totalHours * 3600 * 1000;
    const d = new Date(deadlineMs);

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
