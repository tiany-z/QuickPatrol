/**
 * M15: 微信小程序微前端组织架构树状态机 Store
 * 路径: packages/apps/app-org-center/pages/org-tree/orgTreeStore.ts
 */

export interface IOrgTreeNode {
  id: number;
  name: string;
  path: string;
  category: string;
  leaderName?: string;
  children: IOrgTreeNode[];
  depth: number;
  isExpanded?: boolean; // 前端 UI 展开状态
}

export class OrgTreeStore {
  private treeData: IOrgTreeNode[] = [];
  private expandedNodeIds = new Set<number>();

  public setTreeData(tree: IOrgTreeNode[]): void {
    this.treeData = tree;
    // 默认展开一级与二级节点
    this.initDefaultExpand(this.treeData);
  }

  private initDefaultExpand(nodes: IOrgTreeNode[]): void {
    for (const node of nodes) {
      if (node.depth <= 2) {
        this.expandedNodeIds.add(node.id);
      }
      if (node.children && node.children.length > 0) {
        this.initDefaultExpand(node.children);
      }
    }
  }

  public toggleExpand(nodeId: number): void {
    if (this.expandedNodeIds.has(nodeId)) {
      this.expandedNodeIds.delete(nodeId);
    } else {
      this.expandedNodeIds.add(nodeId);
    }
  }

  public isNodeExpanded(nodeId: number): boolean {
    return this.expandedNodeIds.has(nodeId);
  }

  public getTree(): IOrgTreeNode[] {
    return this.treeData;
  }
}
