/**
 * M16: 微信小程序端岗位标签管理 Store
 * 路径: packages/apps/app-org-center/pages/tag-management/tagStore.ts
 */

export interface ITagItem {
  tagId: number;
  tagName: string;
  tagColor: string;
  tagDesc: string;
  activeMembersCount: number;
  members: Array<{
    userId: number;
    realName: string;
    phone: string;
  }>;
}

export class TagStore {
  private tags: ITagItem[] = [];

  public setTags(list: ITagItem[]): void {
    this.tags = list;
  }

  public getTags(): ITagItem[] {
    return [...this.tags];
  }

  /**
   * 前端本地模拟快速交接
   */
  public updateLocalHandover(
    tagId: number,
    fromUserId: number,
    toUser: { userId: number; realName: string; phone: string }
  ): void {
    const target = this.tags.find((t) => t.tagId === tagId);
    if (target) {
      target.members = target.members.filter((m) => m.userId !== fromUserId);
      target.members.push(toUser);
      target.activeMembersCount = target.members.length;
    }
  }
}

export const tagStore = new TagStore();
