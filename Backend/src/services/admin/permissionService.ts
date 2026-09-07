/**
 * M18: 四维权限矩阵与校内网格化授权核心领域服务 (Permission Domain Service)
 * 
 * 核心设计：
 * 1. 四维权限张量：schoolId × (userId | tagId) × campusId × categoryId × type
 * 2. 棋盘式微前端全景大盘 (Grid Matrix) 稀疏投影与坐标压缩
 * 3. 批量网格点选授权与幂等防重
 * 4. 最特异优先匹配优选调度 (Specific Campus & Category Priority)
 * 5. 全环境自适应 (MySQL AST 与内存沙箱自愈)
 */

import { executeASTDelete, executeASTInsert, executeASTSelect } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { getRedisClient } from "../../shared/cache/redis.js";
import { SpecificityMatcher } from "./specificityMatcher.js";
import {
  IBatchGrantPermissionRequest,
  IGrantResultDto,
  IPermissionEntity,
  IPermissionGridCellDto,
  IPermissionMatrixResponse
} from "./permissionTypes.js";
import { TagService } from "../org/tagService.js";
import { WeChatAuthService } from "../auth/wechatAuthService.js";
import { TerminalLogger } from "../../shared/index.js";

// 内存级测试沙箱桩点字典 (支持在离线测试沙箱中微秒级执行)
const mockPermissionsMap = new Map<number, IPermissionEntity>();
const mockCampusesMap = new Map<number, { campusId: number; campusName: string }>();
const mockCategoriesMap = new Map<number, { categoryId: number; categoryName: string }>();
let mockPermIdCounter = 1;

export class PermissionService {
  /**
   * 注册虚拟权限桩点 (用于离线单元测试)
   */
  public static mockRegisterPermission(perm: Partial<IPermissionEntity> & { schoolId: number; type: 1 | 2 | 3 }): IPermissionEntity {
    const id = perm.id || mockPermIdCounter++;
    const entity: IPermissionEntity = {
      id,
      schoolId: perm.schoolId,
      userId: perm.userId !== undefined ? perm.userId : 0,
      tagId: perm.tagId !== undefined ? perm.tagId : null,
      campusId: perm.campusId !== undefined ? perm.campusId : 0,
      categoryId: perm.categoryId !== undefined ? perm.categoryId : 0,
      type: perm.type,
      createdAt: perm.createdAt || new Date().toISOString()
    };
    mockPermissionsMap.set(id, entity);
    return entity;
  }

  /**
   * 注册用于测试的校区桩点
   */
  public static mockRegisterCampus(campus: { campusId: number; campusName: string }): void {
    mockCampusesMap.set(campus.campusId, campus);
  }

  /**
   * 注册用于测试的故障分类桩点
   */
  public static mockRegisterCategory(category: { categoryId: number; categoryName: string }): void {
    mockCategoriesMap.set(category.categoryId, category);
  }

  /**
   * 清空测试沙箱权限桩点
   */
  public static clearMockPermissions(): void {
    mockPermissionsMap.clear();
    mockCampusesMap.clear();
    mockCategoriesMap.clear();
    mockPermIdCounter = 1;
  }

  /**
   * 获取测试沙箱权限全量集合
   */
  public static getMockPermissionsMap(): Map<number, IPermissionEntity> {
    return mockPermissionsMap;
  }

  /**
   * 获取全校棋盘式网格授权矩阵大盘
   */
  public static async getPermissionGridMatrix(schoolId: number): Promise<IPermissionMatrixResponse> {
    const redis = getRedisClient();
    const cacheKey = `tenant:${schoolId}:perm:matrix`;

    // 1. 尝试从 Redis 读取缓存
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {
        // 缓存容错降级
      }
    }

    let campusAxes: any[] = [];
    let categoryAxes: any[] = [];
    const gridCells: Record<string, IPermissionGridCellDto> = {};

    if (getMySQLPool()) {
      // 真实 MySQL 环境并发查询
      const campusSql = `SELECT id AS campusId, name AS campusName FROM campuses WHERE schoolId = ? AND isDeleted = 0 ORDER BY sortOrder ASC`;
      const categorySql = `SELECT id AS categoryId, name AS categoryName FROM categories WHERE schoolId = ? AND isDeleted = 0 ORDER BY sortOrder ASC`;
      const permSql = `
        SELECT p.id, p.userId, p.tagId, p.campusId, p.categoryId, p.type,
               u.realName, u.nickName, t.name AS tagName, t.color AS tagColor
        FROM permissions p
        LEFT JOIN users u ON p.userId = u.id AND p.schoolId = u.schoolId
        LEFT JOIN tags t ON p.tagId = t.id AND p.schoolId = t.schoolId
        WHERE p.schoolId = ?
      `;

      const [campuses, categories, rawPerms]: any = await Promise.all([
        executeASTSelect(campusSql, [schoolId]),
        executeASTSelect(categorySql, [schoolId]),
        executeASTSelect(permSql, [schoolId])
      ]);

      campusAxes = [{ campusId: 0, campusName: "【全校所有校区通配】", isWildcard: true }, ...campuses];
      categoryAxes = [{ categoryId: 0, categoryName: "【所有分类门类通配】", isWildcard: true }, ...categories];

      for (const r of rawPerms) {
        const key = `${r.campusId}_${r.categoryId}_${r.type}`;
        if (!gridCells[key]) {
          gridCells[key] = {
            cellKey: key,
            campusId: r.campusId,
            categoryId: r.categoryId,
            type: r.type,
            assignments: []
          };
        }

        if (r.tagId) {
          gridCells[key].assignments.push({
            ruleId: r.id,
            assignmentType: "tag",
            targetId: r.tagId,
            targetName: r.tagName || "未命名标签",
            targetColor: r.tagColor || "#D83B01"
          });
        } else if (r.userId) {
          gridCells[key].assignments.push({
            ruleId: r.id,
            assignmentType: "user",
            targetId: r.userId,
            targetName: r.realName || r.nickName || `用户_${r.userId}`
          });
        }
      }
    } else {
      // 内存沙箱计算
      const campusList = mockCampusesMap.size > 0
        ? Array.from(mockCampusesMap.values()).map((c) => ({ campusId: c.campusId, campusName: c.campusName, isWildcard: false }))
        : [
            { campusId: 1, campusName: "西校区", isWildcard: false },
            { campusId: 2, campusName: "东校区", isWildcard: false }
          ];

      const categoryList = mockCategoriesMap.size > 0
        ? Array.from(mockCategoriesMap.values()).map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, isWildcard: false }))
        : [
            { categoryId: 1, categoryName: "综合维保", isWildcard: false },
            { categoryId: 2, categoryName: "高压强电", isWildcard: false }
          ];

      campusAxes = [{ campusId: 0, campusName: "【全校所有校区通配】", isWildcard: true }, ...campusList];
      categoryAxes = [{ categoryId: 0, categoryName: "【所有分类门类通配】", isWildcard: true }, ...categoryList];

      const tagMap = TagService.getMockTagsMap();
      const userMap = WeChatAuthService.getMockUsersMap();

      for (const r of mockPermissionsMap.values()) {
        if (r.schoolId !== schoolId) continue;
        const key = `${r.campusId}_${r.categoryId}_${r.type}`;
        if (!gridCells[key]) {
          gridCells[key] = {
            cellKey: key,
            campusId: r.campusId,
            categoryId: r.categoryId,
            type: r.type,
            assignments: []
          };
        }

        if (r.tagId && tagMap.has(r.tagId)) {
          const tag = tagMap.get(r.tagId)!;
          gridCells[key].assignments.push({
            ruleId: r.id,
            assignmentType: "tag",
            targetId: r.tagId,
            targetName: tag.name,
            targetColor: tag.color
          });
        } else if (r.userId && userMap.has(r.userId)) {
          const user = userMap.get(r.userId)!;
          gridCells[key].assignments.push({
            ruleId: r.id,
            assignmentType: "user",
            targetId: r.userId,
            targetName: user.realName || user.nickName || `用户_${r.userId}`
          });
        } else {
          gridCells[key].assignments.push({
            ruleId: r.id,
            assignmentType: r.tagId ? "tag" : "user",
            targetId: r.tagId || r.userId,
            targetName: r.tagId ? `标签_${r.tagId}` : `用户_${r.userId}`
          });
        }
      }
    }

    const matrixResult: IPermissionMatrixResponse = {
      schoolId,
      campuses: campusAxes,
      categories: categoryAxes,
      gridCells
    };

    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(matrixResult), "EX", 1800);
      } catch {
        // 缓存容错
      }
    }

    return matrixResult;
  }

  /**
   * 批量网格点选授权
   */
  public static async batchGrantPermissions(
    schoolId: number,
    dto: IBatchGrantPermissionRequest
  ): Promise<IGrantResultDto> {
    const isTag = dto.targetType === "tag";
    const tagId = isTag ? dto.targetId : null;
    const userId = isTag ? 0 : dto.targetId;

    let addedCount = 0;
    const createdRuleIds: number[] = [];

    for (const pt of dto.gridPoints) {
      if (getMySQLPool()) {
        // 幂等防重：检查是否已有完全相同的授权
        const checkSql = `
          SELECT id FROM permissions 
          WHERE schoolId = ? AND type = ? AND campusId = ? AND categoryId = ? 
            AND ( (tagId = ? AND ? = true) OR (userId = ? AND ? = false) )
          LIMIT 1
        `;
        const existing: any = await executeASTSelect(checkSql, [
          schoolId, dto.type, pt.campusId, pt.categoryId, tagId, isTag, userId, isTag
        ]);

        if (existing && existing.length > 0) {
          continue;
        }

        const insertSql = `
          INSERT INTO permissions (schoolId, tagId, userId, campusId, categoryId, type, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;
        const res: any = await executeASTInsert(insertSql, [
          schoolId, tagId, userId, pt.campusId, pt.categoryId, dto.type
        ]);

        if (res.status === 1 && res.data) {
          const insertId = res.data.insertId || res.data[0]?.insertId || mockPermIdCounter++;
          createdRuleIds.push(insertId);
          addedCount++;
        }
      } else {
        // 内存沙箱检索幂等
        let alreadyExists = false;
        for (const ex of mockPermissionsMap.values()) {
          if (
            ex.schoolId === schoolId &&
            ex.type === dto.type &&
            ex.campusId === pt.campusId &&
            ex.categoryId === pt.categoryId &&
            (isTag ? ex.tagId === tagId : ex.userId === userId)
          ) {
            alreadyExists = true;
            break;
          }
        }

        if (alreadyExists) {
          continue;
        }

        const id = mockPermIdCounter++;
        const entity: IPermissionEntity = {
          id,
          schoolId,
          tagId,
          userId,
          campusId: pt.campusId,
          categoryId: pt.categoryId,
          type: dto.type,
          createdAt: new Date().toISOString()
        };
        mockPermissionsMap.set(id, entity);
        createdRuleIds.push(id);
        addedCount++;
      }
    }

    // 清空该校权限矩阵缓存
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.del(`tenant:${schoolId}:perm:matrix`);
      } catch {
        // 忽略异常
      }
    }

    TerminalLogger.info(
      `[M18 权限网格] 学校 ${schoolId} 为 ${dto.targetType}:${dto.targetId} 批量授权 ${addedCount} 个网格点`,
      "PermissionGrid"
    );

    return {
      addedCount,
      redundantCount: dto.gridPoints.length - addedCount,
      createdRuleIds
    };
  }

  /**
   * 收回网格单条权限
   */
  public static async revokePermission(schoolId: number, ruleId: number): Promise<boolean> {
    let affected = false;

    if (getMySQLPool()) {
      const delSql = `DELETE FROM permissions WHERE schoolId = ? AND id = ?`;
      const res: any = await executeASTDelete(delSql, [schoolId, ruleId]);
      affected = (res.affectedRows ?? 0) > 0;
    } else {
      const existing = mockPermissionsMap.get(ruleId);
      if (existing && existing.schoolId === schoolId) {
        mockPermissionsMap.delete(ruleId);
        affected = true;
      }
    }

    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.del(`tenant:${schoolId}:perm:matrix`);
      } catch {
        // 忽略异常
      }
    }

    return affected;
  }

  /**
   * 核心匹配探针：根据工单发生的校区与分类，查找最特异胜出的责任人
   */
  public static async resolveOptimalHandler(
    schoolId: number,
    campusId: number,
    categoryId: number,
    type: 1 | 2 | 3
  ): Promise<{ ruleId: number; tagId: number | null; userId: number; matchType: string } | null> {
    let candidates: any[] = [];

    if (getMySQLPool()) {
      const sql = `
        SELECT id, tagId, userId, campusId, categoryId, type
        FROM permissions
        WHERE schoolId = ? AND type = ? 
          AND campusId IN (?, 0) 
          AND categoryId IN (?, 0)
      `;
      candidates = await executeASTSelect(sql, [schoolId, type, campusId, categoryId]);
    } else {
      for (const r of mockPermissionsMap.values()) {
        if (
          r.schoolId === schoolId &&
          r.type === type &&
          (r.campusId === 0 || r.campusId === campusId) &&
          (r.categoryId === 0 || r.categoryId === categoryId)
        ) {
          candidates.push({ ...r });
        }
      }
    }

    const match = SpecificityMatcher.pickBestRule(candidates, campusId, categoryId);
    if (!match) return null;

    return {
      ruleId: match.winnerRule.id,
      tagId: match.winnerRule.tagId,
      userId: match.winnerRule.userId,
      matchType: match.matchType
    };
  }
}
