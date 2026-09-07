/**
 * M15: 物化路径 (Materialized Path) 核心数学引擎与线性建树算法
 * 
 * 核心规范：
 * 1. 严格采用双闭合斜杠物化路径标准 `/1/3/7/`
 * 2. 支持前缀索引匹配与 O(N) 线性哈希建树
 */

import { IDepartmentFlatItem, IDepartmentTreeNodeDto } from "./departmentTypes.js";

export const PATH_REGEX = /^\/([0-9]+\/)+$/;

export class PathEngine {
  /**
   * 校验路径字符串是否绝对符合斜杠首尾闭合的规范格式 (例如: "/1/3/7/")
   */
  public static isValidPath(path: string): boolean {
    if (!path || typeof path !== "string") return false;
    return PATH_REGEX.test(path);
  }

  /**
   * 根据父部门路径与当前自增主键生成新物化路径
   */
  public static generateChildPath(parentPath: string | null | undefined, currentId: number): string {
    if (!currentId || currentId <= 0) {
      throw new Error("[PathEngine] 生成物化路径失败: currentId 必须为正整数");
    }

    // 若父路径为空或顶级斜杠，则当前为一级根部门
    if (!parentPath || parentPath === "/") {
      return `/${currentId}/`;
    }

    if (!this.isValidPath(parentPath)) {
      throw new Error(`[PathEngine] 非法的父部门路径格式: ${parentPath}`);
    }

    return `${parentPath}${currentId}/`;
  }

  /**
   * 切分物化路径，解析出按层级排序的祖先节点 ID 列表
   * 例如: "/1/3/7/15/" => [1, 3, 7, 15]
   */
  public static parsePathToIds(path: string): number[] {
    if (!this.isValidPath(path)) {
      return [];
    }
    return path
      .split("/")
      .filter((segment) => segment.trim() !== "")
      .map((idStr) => parseInt(idStr, 10));
  }

  /**
   * 计算当前节点的行政层级深度
   * 例如: "/1/" 深度为 1; "/1/3/7/" 深度为 3
   */
  public static calculateDepth(path: string): number {
    return this.parsePathToIds(path).length;
  }
}

/**
 * 算法 3: 平面列表至飞书树状嵌套拓扑快速构建算法 (Flat-to-Tree Fast Builder)
 * 时间复杂度 O(N)，空间复杂度 O(N)
 */
export function buildDepartmentTree(flatList: IDepartmentFlatItem[]): IDepartmentTreeNodeDto[] {
  if (!flatList || flatList.length === 0) return [];

  const nodeMap = new Map<number, IDepartmentTreeNodeDto>();
  const rootNodes: IDepartmentTreeNodeDto[] = [];

  // 1. 建立哈希指针映射，预先挂载空 children 数组与计算 depth
  for (const item of flatList) {
    nodeMap.set(item.id, {
      id: item.id,
      schoolId: item.schoolId,
      parentId: item.parentId,
      path: item.path,
      name: item.name,
      category: item.category,
      contactPhone: item.contactPhone,
      leaderId: item.leaderId,
      leaderName: item.leaderName,
      sortOrder: item.sortOrder,
      depth: PathEngine.calculateDepth(item.path),
      children: []
    });
  }

  // 2. 遍历关联父子节点引用
  for (const item of flatList) {
    const currentNode = nodeMap.get(item.id)!;
    const parentId = item.parentId;

    if (parentId && nodeMap.has(parentId)) {
      const parentNode = nodeMap.get(parentId)!;
      parentNode.children.push(currentNode);
    } else {
      // 无 parentId 或在集合内无对应父节点，提升为当前组织树根节点
      rootNodes.push(currentNode);
    }
  }

  // 3. 对同级子节点递归执行 sortOrder 升序排列 (次序相同按 id 升序)
  const sortRecursive = (nodes: IDepartmentTreeNodeDto[]) => {
    nodes.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.id - b.id;
    });
    for (const n of nodes) {
      if (n.children.length > 0) {
        sortRecursive(n.children);
      }
    }
  };

  sortRecursive(rootNodes);
  return rootNodes;
}
