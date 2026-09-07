/**
 * M15: 部门树形拓扑与微前端组织架构中枢核心领域服务 (Department Domain Service)
 * 
 * 核心功能：
 * 1. 采用物化路径 (Materialized Path) 管理无限级部门树拓扑
 * 2. 毫秒级双向检索 (通过前缀匹配查询子树，通过解析 path 获取祖先链)
 * 3. 组织树全量多级缓存与变更淘汰 (Redis `tenant:{id}:org:tree`)
 * 4. 部门跨层级平移与全子树原子前缀置换 (带防环死锁检测)
 * 5. 自底向上负责人智能继承探针 (Hierarchical Leader Fallback Probe)
 * 6. 支持离线测试沙箱快速 Mock 存储
 */

import { executeASTInsert, executeASTSelect, executeASTUpdate } from "../../shared/sql/index.js";
import { delTenantKV, getRedisClient, getTenantKV, setTenantKV } from "../../shared/cache/redis.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { PathEngine, buildDepartmentTree } from "./pathEngine.js";
import {
  ICreateDepartmentDto,
  IDepartmentEntity,
  IDepartmentFlatItem,
  IDepartmentTreeNodeDto,
  ILeaderProbeResult,
  IRelocateResultDto,
  IUpdateDepartmentDto
} from "./departmentTypes.js";
import { TerminalLogger } from "../../shared/index.js";

// 内存级测试桩点字典 (支持在无 MySQL 离线测试沙箱中运行)
const mockDepartmentsMap = new Map<number, IDepartmentEntity>();
let mockDeptIdCounter = 1;

export class DepartmentService {
  /**
   * 注册用于离线单元测试的虚拟部门桩点
   */
  public static mockRegisterDepartment(dept: IDepartmentEntity): void {
    mockDepartmentsMap.set(dept.id, dept);
  }

  /**
   * 清理虚拟部门桩点 (用于单元测试沙箱重置)
   */
  public static clearMockDepartments(): void {
    mockDepartmentsMap.clear();
    mockDeptIdCounter = 1;
  }

  /**
   * 获取测试沙箱全部虚拟部门列表
   */
  public static getMockDepartmentsMap(): Map<number, IDepartmentEntity> {
    return mockDepartmentsMap;
  }

  /**
   * 获取全校飞书嵌套组织架构树 (优先读 Redis 缓存)
   */
  public static async getSchoolDepartmentTree(schoolId: number): Promise<IDepartmentTreeNodeDto[]> {
    const redis = getRedisClient();
    const cacheKey = `tenant:${schoolId}:org:tree`;

    // 1. 尝试从 Redis 读取缓存
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {
        // Redis 降级容错
      }
    } else {
      const cached = await getTenantKV<IDepartmentTreeNodeDto[]>(schoolId, "org", "tree");
      if (cached.status === 1 && cached.data) {
        return cached.data;
      }
    }

    let flatList: IDepartmentFlatItem[] = [];

    // 2. 回源查询：优先检查 MySQL，若无活跃连接池则从内存桩点读取
    if (getMySQLPool()) {
      const sql = `
        SELECT 
          d.id, d.schoolId, d.parentId, d.path, d.name, d.category, 
          d.contactPhone, d.leaderId, d.sortOrder, u.realName AS leaderName
        FROM departments d
        LEFT JOIN users u ON d.leaderId = u.id
        WHERE d.schoolId = ? AND d.isDeleted = 0
        ORDER BY d.sortOrder ASC, d.id ASC
      `;
      flatList = await executeASTSelect(sql, [schoolId]);
    } else {
      // 内存沙箱检索
      flatList = Array.from(mockDepartmentsMap.values())
        .filter((d) => d.schoolId === schoolId && d.isDeleted === 0)
        .map((d) => ({
          id: d.id,
          schoolId: d.schoolId,
          parentId: d.parentId,
          path: d.path,
          name: d.name,
          category: d.category,
          contactPhone: d.contactPhone,
          leaderId: d.leaderId,
          sortOrder: d.sortOrder
        }));
    }

    // 3. 执行线性 O(N) 嵌套树构建
    const tree = buildDepartmentTree(flatList);

    // 4. 写入多租户缓存 (30 分钟 TTL)
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(tree), "EX", 1800);
      } catch {
        // 缓存写入容错
      }
    }
    await setTenantKV(schoolId, "org", "tree", tree, 1800);

    return tree;
  }

  /**
   * 创建新部门并计算原子物化路径
   */
  public static async createDepartment(
    schoolId: number,
    dto: ICreateDepartmentDto
  ): Promise<IDepartmentEntity> {
    if (!dto.name || dto.name.trim() === "") {
      throw new Error("部门名称不能为空");
    }

    const trimmedName = dto.name.trim();

    // 1. 同级重名校验 (Same-Parent Sibling Conflict)
    const siblingConflict = await this.checkSiblingConflict(
      schoolId,
      dto.parentId || null,
      trimmedName
    );
    if (siblingConflict) {
      throw new Error(`同级部门下已存在名为“${trimmedName}”的部门`);
    }

    let parentPath = "/";
    if (dto.parentId && dto.parentId > 0) {
      const parent = await this.getDepartmentById(schoolId, dto.parentId);
      if (!parent) {
        throw new Error("指定的父部门不存在或已被删除");
      }
      parentPath = parent.path;

      // 深度校验 (平台最高限制深度为 8 级)
      if (PathEngine.calculateDepth(parentPath) >= 8) {
        throw new Error("组织架构层级过深: 平台最高限制深度为 8 级");
      }
    }

    let newEntity: IDepartmentEntity;

    if (getMySQLPool()) {
      // 2. 真实 MySQL 写入：先插入占位行获取自增主键
      const insertSql = `
        INSERT INTO departments (
          schoolId, parentId, path, name, category, contactPhone, leaderId, sortOrder, isDeleted
        ) VALUES (
          ?, ?, '/', ?, ?, ?, ?, ?, 0
        )
      `;
      const insertRes: any = await executeASTInsert(insertSql, [
        schoolId,
        dto.parentId || null,
        trimmedName,
        dto.category || "",
        dto.contactPhone || "",
        dto.leaderId || null,
        dto.sortOrder || 0
      ]);

      const newId = insertRes.insertId || insertRes.data?.[0]?.insertId || insertRes.data?.[0]?.id;
      if (!newId) {
        throw new Error("创建部门失败: 无法获取数据库自增主键");
      }

      // 3. 计算物化路径并回写固化
      const finalPath = PathEngine.generateChildPath(parentPath, newId);
      const updatePathSql = `UPDATE departments SET path = ? WHERE schoolId = ? AND id = ?`;
      await executeASTUpdate(updatePathSql, [finalPath, schoolId, newId]);

      newEntity = {
        id: newId,
        schoolId,
        parentId: dto.parentId || null,
        path: finalPath,
        name: trimmedName,
        category: dto.category || "",
        contactPhone: dto.contactPhone || "",
        leaderId: dto.leaderId || null,
        sortOrder: dto.sortOrder || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: 0
      };
    } else {
      // 内存测试沙箱生成自增 ID 与实体
      const newId = mockDeptIdCounter++;
      const finalPath = PathEngine.generateChildPath(parentPath, newId);

      newEntity = {
        id: newId,
        schoolId,
        parentId: dto.parentId || null,
        path: finalPath,
        name: trimmedName,
        category: dto.category || "",
        contactPhone: dto.contactPhone || "",
        leaderId: dto.leaderId || null,
        sortOrder: dto.sortOrder || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: 0
      };
      mockDepartmentsMap.set(newId, newEntity);
    }

    // 4. 清除整校组织树缓存
    await this.evictTreeCache(schoolId);

    TerminalLogger.info(
      `[M15 组织树] 学校 ${schoolId} 创建部门 ${trimmedName} (id: ${newEntity.id}, path: ${newEntity.path})`,
      "OrgCenter"
    );

    return newEntity;
  }

  /**
   * 部门平移与父级变更 (全子树原子重写)
   */
  public static async relocateDepartment(
    schoolId: number,
    departmentId: number,
    newParentId: number | null
  ): Promise<IRelocateResultDto> {
    // 1. 读取当前部门
    const currentDept = await this.getDepartmentById(schoolId, departmentId);
    if (!currentDept) {
      throw new Error("待平移的部门不存在");
    }

    const oldPath = currentDept.path;

    // 2. 计算目标新路径
    let newPath = "";
    if (!newParentId || newParentId === 0) {
      // 提升为一级顶级部门
      newPath = `/${departmentId}/`;
    } else {
      if (newParentId === departmentId) {
        throw new Error("部门无法将其自身指定为父部门");
      }

      const parentDept = await this.getDepartmentById(schoolId, newParentId);
      if (!parentDept) {
        throw new Error("指定的目标父部门不存在");
      }

      // 防死环核心校验: 目标父部门路径绝不能以当前待移动部门路径开头！
      if (parentDept.path.startsWith(oldPath)) {
        throw new Error("非法操作: 不能将部门移动到自身的下属子孙节点名下!");
      }

      // 深度校验：检查平移后全子树最大深度是否超过 8 级
      const currentDepth = PathEngine.calculateDepth(oldPath);
      const targetParentDepth = PathEngine.calculateDepth(parentDept.path);
      const maxSubtreeRelativeDepth = await this.calculateMaxSubtreeDepth(schoolId, oldPath);
      if (targetParentDepth + maxSubtreeRelativeDepth > 8) {
        throw new Error("非法平移: 平移后部分子部门深度将超过 8 级硬上限");
      }

      newPath = `${parentDept.path}${departmentId}/`;
    }

    let affectedCount = 1;

    if (getMySQLPool()) {
      // 3. 执行单条事务级原子前缀置换 (CONCAT + SUBSTRING)
      const sliceIndex = oldPath.length + 1;
      const matchPrefix = `${oldPath}%`;

      const updateSql = `
        UPDATE departments
        SET 
          path = CONCAT(?, SUBSTRING(path, ?)),
          parentId = CASE WHEN id = ? THEN ? ELSE parentId END,
          updatedAt = NOW()
        WHERE schoolId = ? 
          AND (id = ? OR path LIKE ?)
          AND isDeleted = 0
      `;

      const result: any = await executeASTUpdate(updateSql, [
        newPath,
        sliceIndex,
        departmentId,
        newParentId || null,
        schoolId,
        departmentId,
        matchPrefix
      ]);

      affectedCount = result.affectedRows || result.data?.[0]?.affectedRows || 1;
    } else {
      // 内存测试沙箱原子置换
      let count = 0;
      for (const [id, dept] of mockDepartmentsMap.entries()) {
        if (dept.schoolId === schoolId && dept.isDeleted === 0) {
          if (dept.id === departmentId) {
            dept.parentId = newParentId || null;
            dept.path = newPath;
            dept.updatedAt = new Date().toISOString();
            count++;
          } else if (dept.path.startsWith(oldPath)) {
            // 子孙节点置换前缀
            const suffix = dept.path.slice(oldPath.length);
            dept.path = `${newPath}${suffix}`;
            dept.updatedAt = new Date().toISOString();
            count++;
          }
        }
      }
      affectedCount = Math.max(count, 1);
    }

    // 4. 清理全校缓存
    await this.evictTreeCache(schoolId);

    TerminalLogger.info(
      `[M15 组织树] 学校 ${schoolId} 平移部门 ${departmentId} (${oldPath} -> ${newPath}), 影响节点数: ${affectedCount}`,
      "OrgCenter"
    );

    return {
      departmentId,
      oldPath,
      newPath,
      affectedCount
    };
  }

  /**
   * 软删除部门 (前置校验: 不能包含活跃子部门)
   */
  public static async deleteDepartment(schoolId: number, departmentId: number): Promise<boolean> {
    const hasChildren = await this.hasActiveChildren(schoolId, departmentId);
    if (hasChildren) {
      throw new Error("无法删除: 该部门下仍包含子科室或班组，请先平移或删除子部门");
    }

    if (getMySQLPool()) {
      const delSql = `UPDATE departments SET isDeleted = 1, updatedAt = NOW() WHERE schoolId = ? AND id = ?`;
      await executeASTUpdate(delSql, [schoolId, departmentId]);
    } else {
      const dept = mockDepartmentsMap.get(departmentId);
      if (dept && dept.schoolId === schoolId) {
        dept.isDeleted = 1;
        dept.updatedAt = new Date().toISOString();
      }
    }

    await this.evictTreeCache(schoolId);
    return true;
  }

  /**
   * 更新部门基础元数据 (名称、分类、电话、负责人、排序)
   */
  public static async updateDepartment(
    schoolId: number,
    departmentId: number,
    dto: IUpdateDepartmentDto
  ): Promise<IDepartmentEntity> {
    const dept = await this.getDepartmentById(schoolId, departmentId);
    if (!dept) {
      throw new Error("待更新的部门不存在");
    }

    if (dto.name && dto.name.trim() !== dept.name) {
      const conflict = await this.checkSiblingConflict(
        schoolId,
        dept.parentId,
        dto.name.trim(),
        departmentId
      );
      if (conflict) {
        throw new Error(`同级部门下已存在名为“${dto.name.trim()}”的部门`);
      }
      dept.name = dto.name.trim();
    }

    if (dto.category !== undefined) dept.category = dto.category;
    if (dto.contactPhone !== undefined) dept.contactPhone = dto.contactPhone;
    if (dto.leaderId !== undefined) dept.leaderId = dto.leaderId;
    if (dto.sortOrder !== undefined) dept.sortOrder = dto.sortOrder;
    dept.updatedAt = new Date().toISOString();

    if (getMySQLPool()) {
      const sql = `
        UPDATE departments 
        SET name = ?, category = ?, contactPhone = ?, leaderId = ?, sortOrder = ?, updatedAt = NOW()
        WHERE schoolId = ? AND id = ? AND isDeleted = 0
      `;
      await executeASTUpdate(sql, [
        dept.name,
        dept.category,
        dept.contactPhone,
        dept.leaderId,
        dept.sortOrder,
        schoolId,
        departmentId
      ]);
    } else {
      mockDepartmentsMap.set(departmentId, dept);
    }

    await this.evictTreeCache(schoolId);
    return dept;
  }

  /**
   * 算法 4: 部门负责人自底向上继承探针算法 (Hierarchical Leader Fallback Probe)
   * 当基层一线班组未设置 leaderId 时，沿物化路径回溯至科室或处室法定主管
   */
  public static async probeDepartmentLeader(
    schoolId: number,
    departmentId: number
  ): Promise<ILeaderProbeResult> {
    const currentDept = await this.getDepartmentById(schoolId, departmentId);
    if (!currentDept) {
      return { leaderId: null, inheritedFromDeptId: null };
    }

    // 1. 若当前部门已显式指派主管，直接命中返回
    if (currentDept.leaderId && currentDept.leaderId > 0) {
      return {
        leaderId: currentDept.leaderId,
        inheritedFromDeptId: currentDept.id,
        deptName: currentDept.name
      };
    }

    // 2. 解析祖先路径 ID 数组，移除自身并逆序向上溯源
    const ancestorIds = PathEngine.parsePathToIds(currentDept.path);
    ancestorIds.pop(); // 弹出当前节点自身 ID
    ancestorIds.reverse(); // 从直属父级向上一路回溯到根处室

    if (ancestorIds.length === 0) {
      return { leaderId: null, inheritedFromDeptId: null };
    }

    // 3. 批量查询祖先部门的 leaderId 与 name
    const leaderMap = new Map<number, { leaderId: number; name: string }>();

    if (getMySQLPool()) {
      const sql = `
        SELECT id, leaderId, name 
        FROM departments 
        WHERE schoolId = ? AND id IN (${ancestorIds.join(",")}) AND isDeleted = 0
      `;
      const rows: any[] = await executeASTSelect(sql, [schoolId]);
      for (const r of rows) {
        if (r.leaderId && r.leaderId > 0) {
          leaderMap.set(r.id, { leaderId: r.leaderId, name: r.name });
        }
      }
    } else {
      for (const id of ancestorIds) {
        const d = mockDepartmentsMap.get(id);
        if (d && d.schoolId === schoolId && d.isDeleted === 0 && d.leaderId && d.leaderId > 0) {
          leaderMap.set(d.id, { leaderId: d.leaderId, name: d.name });
        }
      }
    }

    // 4. 按最近祖先优先顺序命中第一个有效负责人
    for (const ancestorId of ancestorIds) {
      if (leaderMap.has(ancestorId)) {
        const item = leaderMap.get(ancestorId)!;
        return {
          leaderId: item.leaderId,
          inheritedFromDeptId: ancestorId,
          deptName: item.name
        };
      }
    }

    return { leaderId: null, inheritedFromDeptId: null };
  }

  /**
   * 根据 ID 检索部门实体
   */
  public static async getDepartmentById(
    schoolId: number,
    departmentId: number
  ): Promise<IDepartmentEntity | null> {
    if (getMySQLPool()) {
      const sql = `
        SELECT * 
        FROM departments 
        WHERE schoolId = ? AND id = ? AND isDeleted = 0 
        LIMIT 1
      `;
      const rows: any[] = await executeASTSelect(sql, [schoolId, departmentId]);
      return rows && rows.length > 0 ? rows[0] : null;
    }

    const dept = mockDepartmentsMap.get(departmentId);
    if (dept && dept.schoolId === schoolId && dept.isDeleted === 0) {
      return { ...dept };
    }
    return null;
  }

  /**
   * 检查同级同名冲突
   */
  private static async checkSiblingConflict(
    schoolId: number,
    parentId: number | null,
    name: string,
    excludeDeptId?: number
  ): Promise<boolean> {
    if (getMySQLPool()) {
      const parentCondition = parentId === null ? "parentId IS NULL" : "parentId = ?";
      const params = parentId === null ? [schoolId, name] : [schoolId, parentId, name];
      let sql = `SELECT id FROM departments WHERE schoolId = ? AND ${parentCondition} AND name = ? AND isDeleted = 0`;
      if (excludeDeptId) {
        sql += ` AND id != ?`;
        params.push(excludeDeptId);
      }
      sql += " LIMIT 1";
      const rows: any[] = await executeASTSelect(sql, params);
      return rows.length > 0;
    }

    for (const dept of mockDepartmentsMap.values()) {
      if (
        dept.schoolId === schoolId &&
        dept.isDeleted === 0 &&
        dept.parentId === parentId &&
        dept.name === name &&
        dept.id !== excludeDeptId
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查是否有活跃子节点
   */
  private static async hasActiveChildren(schoolId: number, departmentId: number): Promise<boolean> {
    if (getMySQLPool()) {
      const sql = `SELECT COUNT(1) AS cnt FROM departments WHERE schoolId = ? AND parentId = ? AND isDeleted = 0`;
      const rows: any[] = await executeASTSelect(sql, [schoolId, departmentId]);
      return rows && rows[0]?.cnt > 0;
    }

    for (const dept of mockDepartmentsMap.values()) {
      if (dept.schoolId === schoolId && dept.parentId === departmentId && dept.isDeleted === 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * 计算指定部门名下所有子孙相对于该部门的最大相对深度
   */
  private static async calculateMaxSubtreeDepth(schoolId: number, rootPath: string): Promise<number> {
    const rootDepth = PathEngine.calculateDepth(rootPath);
    let maxDepth = rootDepth;

    if (getMySQLPool()) {
      const sql = `SELECT path FROM departments WHERE schoolId = ? AND path LIKE ? AND isDeleted = 0`;
      const rows: any[] = await executeASTSelect(sql, [schoolId, `${rootPath}%`]);
      for (const r of rows) {
        const d = PathEngine.calculateDepth(r.path);
        if (d > maxDepth) maxDepth = d;
      }
    } else {
      for (const dept of mockDepartmentsMap.values()) {
        if (dept.schoolId === schoolId && dept.isDeleted === 0 && dept.path.startsWith(rootPath)) {
          const d = PathEngine.calculateDepth(dept.path);
          if (d > maxDepth) maxDepth = d;
        }
      }
    }

    return maxDepth - rootDepth + 1;
  }

  /**
   * 淘汰整校组织树缓存
   */
  private static async evictTreeCache(schoolId: number): Promise<void> {
    const redis = getRedisClient();
    const cacheKey = `tenant:${schoolId}:org:tree`;

    if (redis) {
      try {
        await redis.del(cacheKey);
      } catch {
        // 缓存淘汰容错
      }
    }
    await delTenantKV(schoolId, "org", "tree");
  }
}
