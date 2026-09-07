/**
 * M16: 算法 1：“权限随岗不随人”动态待办池三层联查聚合算法
 * (Tag-Decoupled Dynamic Worklist Aggregation)
 * 
 * 核心设计哲学：
 * 师傅在拉取待办列表时，系统绝不局限于 patrols.currentHandlerId = userId，
 * 而是自动展开其持有的全量岗位标签，动态聚合：
 * 1. 明确派发给当前师傅个人的工单 (currentHandlerId = userId)
 * 2. 明确指派给当前师傅持有的职能标签的工单 (tagId IN userTagIds)
 * 3. 落在当前师傅所持有标签的四维网格授权范围内的工单 (permissions 网格规则匹配)
 */

import { executeASTSelect } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { IDynamicWorklistQuery, IPatrolWorklistItemDto } from "./tagTypes.js";

// 内存级测试沙箱桩点字典
const mockPatrolsMap = new Map<number, any>();
const mockPermissionsMap = new Map<number, any>();
let mockPatrolIdCounter = 1;

export class WorklistAggregator {
  /**
   * 注册用于离线单元测试的虚拟工单
   */
  public static mockRegisterPatrol(patrol: any): any {
    const id = patrol.id || mockPatrolIdCounter++;
    const entity = {
      id,
      schoolId: Number(patrol.schoolId),
      campusId: Number(patrol.campusId || 0),
      categoryId: Number(patrol.categoryId || 0),
      departmentId: Number(patrol.departmentId || 0),
      orderNo: String(patrol.orderNo || `ORDER-${id}`),
      creatorId: Number(patrol.creatorId || 1),
      title: String(patrol.title || ""),
      desc: String(patrol.desc || ""),
      status: Number(patrol.status !== undefined ? patrol.status : 1),
      priority: Number(patrol.priority !== undefined ? patrol.priority : 0),
      location1: String(patrol.location1 || ""),
      location2: String(patrol.location2 || ""),
      currentHandlerId: patrol.currentHandlerId ? Number(patrol.currentHandlerId) : null,
      currentReviewerId: patrol.currentReviewerId ? Number(patrol.currentReviewerId) : null,
      tagId: patrol.tagId ? Number(patrol.tagId) : null,
      createdAt: patrol.createdAt || new Date().toISOString(),
      isDeleted: Number(patrol.isDeleted || 0)
    };
    mockPatrolsMap.set(id, entity);
    return entity;
  }

  /**
   * 获取测试沙箱全部虚拟工单列表
   */
  public static getMockPatrolsMap(): Map<number, any> {
    return mockPatrolsMap;
  }

  /**
   * 注册用于离线单元测试的网格授权规则
   */
  public static mockRegisterPermission(perm: any): void {
    const id = perm.id || mockPermissionsMap.size + 1;
    mockPermissionsMap.set(id, {
      id,
      schoolId: Number(perm.schoolId),
      tagId: Number(perm.tagId),
      campusId: Number(perm.campusId || 0),
      categoryId: Number(perm.categoryId || 0),
      type: Number(perm.type !== undefined ? perm.type : 1)
    });
  }

  /**
   * 清空测试沙箱工单与授权桩点
   */
  public static clearMockWorklistData(): void {
    mockPatrolsMap.clear();
    mockPermissionsMap.clear();
    mockPatrolIdCounter = 1;
  }
}

/**
 * 动态待办池三层联查聚合入口
 */
export async function fetchTagDecoupledWorklist(
  query: IDynamicWorklistQuery
): Promise<{ total: number; list: IPatrolWorklistItemDto[] }> {
  const { schoolId, userId, page = 1, pageSize = 20 } = query;
  const offset = (page - 1) * pageSize;

  if (getMySQLPool()) {
    // 1. 查询该师傅持有的所有职能标签 ID 与色标
    const tagSql = `
      SELECT tm.tagId, t.name AS tagName, t.color AS tagColor
      FROM tag_members tm
      JOIN tags t ON tm.tagId = t.id
      WHERE tm.schoolId = ? AND tm.userId = ? AND t.isDeleted = 0
    `;
    const tagRows: any = await executeASTSelect(tagSql, [schoolId, userId]);
    const userTagIds: number[] = tagRows.map((r: any) => r.tagId);

    // 2. 构造动态聚合 SQL
    let tagCondition = "1 = 0";
    const params: any[] = [schoolId, userId];

    if (userTagIds.length > 0) {
      tagCondition = `
        p.tagId IN (${userTagIds.join(",")}) OR
        EXISTS (
          SELECT 1 FROM permissions perm
          WHERE perm.schoolId = p.schoolId
            AND perm.tagId IN (${userTagIds.join(",")})
            AND (perm.campusId = 0 OR perm.campusId = p.campusId)
            AND (perm.categoryId = 0 OR perm.categoryId = p.categoryId)
            AND perm.type = 1
        )
      `;
    }

    const baseWhere = `
      WHERE p.schoolId = ? 
        AND p.isDeleted = 0 
        AND p.status IN (1, 2) 
        AND (p.currentHandlerId = ? OR (${tagCondition}))
    `;

    // 3. 执行单条高性能聚合查询
    const countSql = `SELECT COUNT(1) AS total FROM patrols p ${baseWhere}`;
    const totalRows: any = await executeASTSelect(countSql, params);
    const total = totalRows[0]?.total || 0;

    const dataSql = `
      SELECT 
        p.id, p.orderNo, p.title, p.status, p.priority, p.campusId, p.categoryId,
        p.location1, p.location2, p.createdAt, p.currentHandlerId, p.tagId,
        c.name AS categoryName, cp.name AS campusName
      FROM patrols p
      LEFT JOIN categories c ON p.categoryId = c.id
      LEFT JOIN campuses cp ON p.campusId = cp.id
      ${baseWhere}
      ORDER BY p.priority DESC, p.id ASC
      LIMIT ? OFFSET ?
    `;

    const listRows: any = await executeASTSelect(dataSql, [...params, pageSize, offset]);

    // 补充标签视觉徽标
    const tagColorMap = new Map<number, { name: string; color: string }>();
    for (const t of tagRows) {
      tagColorMap.set(t.tagId, { name: t.tagName, color: t.tagColor });
    }

    const list: IPatrolWorklistItemDto[] = listRows.map((row: any) => ({
      ...row,
      tagBadge: row.tagId && tagColorMap.has(row.tagId) ? tagColorMap.get(row.tagId) : null
    }));

    return { total, list };
  } else {
    // 内存测试沙箱动态计算
    const { TagService } = await import("./tagService.js");
    const userTagIds = TagService.getMockUserTagIds(schoolId, userId);
    const tagMap = TagService.getMockTagsMap();

    const matchedPatrols: any[] = [];
    for (const p of mockPatrolsMap.values()) {
      if (p.schoolId !== schoolId || p.isDeleted !== 0) continue;
      if (p.status !== 1 && p.status !== 2) continue;

      let isMatch = false;
      // 条件 A: 明确派发给当前师傅个人
      if (p.currentHandlerId === userId) {
        isMatch = true;
      }
      // 条件 B: 派发给当前师傅持有的岗位标签
      else if (p.tagId && userTagIds.includes(p.tagId)) {
        isMatch = true;
      }
      // 条件 C: 网格授权四维权限匹配
      else if (userTagIds.length > 0) {
        for (const perm of mockPermissionsMap.values()) {
          if (
            perm.schoolId === schoolId &&
            userTagIds.includes(perm.tagId) &&
            perm.type === 1 &&
            (perm.campusId === 0 || perm.campusId === p.campusId) &&
            (perm.categoryId === 0 || perm.categoryId === p.categoryId)
          ) {
            isMatch = true;
            break;
          }
        }
      }

      if (isMatch) {
        matchedPatrols.push(p);
      }
    }

    matchedPatrols.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id - b.id;
    });

    const total = matchedPatrols.length;
    const pageRows = matchedPatrols.slice(offset, offset + pageSize);

    const list: IPatrolWorklistItemDto[] = pageRows.map((p) => {
      const tag = p.tagId && tagMap.has(p.tagId) ? tagMap.get(p.tagId) : null;
      return {
        id: p.id,
        orderNo: p.orderNo,
        title: p.title,
        status: p.status,
        priority: p.priority,
        campusId: p.campusId,
        categoryId: p.categoryId,
        location1: p.location1,
        location2: p.location2,
        createdAt: p.createdAt,
        currentHandlerId: p.currentHandlerId,
        tagId: p.tagId,
        categoryName: "综合维保",
        campusName: "主校区",
        tagBadge: tag ? { name: tag.name, color: tag.color } : null
      };
    });

    return { total, list };
  }
}
