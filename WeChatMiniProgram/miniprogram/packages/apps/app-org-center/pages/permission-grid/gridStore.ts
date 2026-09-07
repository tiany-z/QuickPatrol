/**
 * M18: 微信小程序端四维权限棋盘网格交互状态机 (Permission Grid Store)
 */

export interface IGridCoordinate {
  campusId: number;
  categoryId: number;
  type: 1 | 2 | 3;
}

export class PermissionGridStore {
  private selectedPoints: Set<string> = new Set();

  public togglePoint(campusId: number, categoryId: number, type: 1 | 2 | 3): void {
    const key = `${campusId}_${categoryId}_${type}`;
    if (this.selectedPoints.has(key)) {
      this.selectedPoints.delete(key);
    } else {
      this.selectedPoints.add(key);
    }
  }

  public isPointSelected(campusId: number, categoryId: number, type: 1 | 2 | 3): boolean {
    return this.selectedPoints.has(`${campusId}_${categoryId}_${type}`);
  }

  public getSelectedPoints(): IGridCoordinate[] {
    const list: IGridCoordinate[] = [];
    for (const key of this.selectedPoints) {
      const [campusId, categoryId, type] = key.split("_").map((v) => parseInt(v, 10));
      list.push({ campusId, categoryId, type: type as 1 | 2 | 3 });
    }
    return list;
  }

  public clearSelection(): void {
    this.selectedPoints.clear();
  }
}

export const permissionGridStore = new PermissionGridStore();
