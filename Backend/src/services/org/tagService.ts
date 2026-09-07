/**
 * M16: 岗位职能标签中台与“权限随岗不随人”核心领域服务 (Tag Domain Service)
 * 
 * 核心功能：
 * 1. 岗位职能标签生命周期纳管 (名称唯一性校验、Metro UI 调色板自适应分配)
 * 2. 标签成员多对多关联与人员持岗上限保护 (Max Limit = 10)
 * 3. 零写放大原子交接 (单行更新 tag_members，关联在办工单零修改瞬间重定向)
 * 4. 全校标签全景大盘视图 (v_tag_assignments) 与二级 Redis 缓存同步
 * 5. 下游网格派单支持 (解析指定标签当前持证在岗人员列表)
 */

import { executeASTInsert, executeASTSelect, executeASTUpdate } from "../../shared/sql/index.js";
import { delTenantKV, getRedisClient, getTenantKV, setTenantKV } from "../../shared/cache/redis.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { MetroColorAssigner } from "./metroColorAssigner.js";
import {
  ICreateTagDto,
  IHandoverResultDto,
  ITagAssignmentDto,
  ITagEntity,
  ITagMemberEntity,
  IUpdateTagDto
} from "./tagTypes.js";
import { TerminalLogger } from "../../shared/index.js";

// 内存级测试桩点字典 (支持在离线测试沙箱中微秒级执行)
const mockTagsMap = new Map<number, ITagEntity>();
const mockTagMembersMap = new Map<number, ITagMemberEntity>();
let mockTagIdCounter = 1;
let mockMemberIdCounter = 1;

export class TagService {
  /**
   * 注册用于离线单元测试的虚拟标签
   */
  public static mockRegisterTag(tag: ITagEntity): void {
    mockTagsMap.set(tag.id, tag);
  }

  /**
   * 注册用于离线单元测试的标签成员绑定
   */
  public static mockRegisterTagMember(tm: ITagMemberEntity): void {
    mockTagMembersMap.set(tm.id, tm);
  }

  /**
   * 清理测试沙箱标签桩点
   */
  public static clearMockTags(): void {
    mockTagsMap.clear();
    mockTagMembersMap.clear();
    mockTagIdCounter = 1;
    mockMemberIdCounter = 1;
  }

  /**
   * 获取测试沙箱中指定用户持有的全部标签 ID
   */
  public static getMockUserTagIds(schoolId: number, userId: number): number[] {
    const ids: number[] = [];
    for (const tm of mockTagMembersMap.values()) {
      if (tm.schoolId === schoolId && tm.userId === userId) {
        const tag = mockTagsMap.get(tm.tagId);
        if (tag && tag.schoolId === schoolId && tag.isDeleted === 0) {
          ids.push(tm.tagId);
        }
      }
    }
    return ids;
  }

  /**
   * 获取测试沙箱中全部标签字典
   */
  public static getMockTagsMap(): Map<number, ITagEntity> {
    return mockTagsMap;
  }

  /**
   * 查询全校岗位标签全景调度大盘 (支持二级缓存)
   */
  public static async getTagAssignmentsDashboard(schoolId: number): Promise<ITagAssignmentDto[]> {
    const redis = getRedisClient();
    const cacheKey = `tenant:${schoolId}:tag:assignments`;

    // 1. 优先读缓存
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    } else {
      const cached = await getTenantKV<ITagAssignmentDto[]>(schoolId, "tag", "assignments");
      if (cached.status === 1 && cached.data) return cached.data;
    }

    let dashboard: ITagAssignmentDto[] = [];

    if (getMySQLPool()) {
      // 2. MySQL 回源
      const tagSql = `
        SELECT id, schoolId, name, color, \`desc\`, sortOrder 
        FROM tags 
        WHERE schoolId = ? AND isDeleted = 0 
        ORDER BY sortOrder ASC, id ASC
      `;
      const tags: any[] = await executeASTSelect(tagSql, [schoolId]);
      if (!tags || tags.length === 0) return [];

      const memberSql = `
        SELECT tm.tagId, u.id AS userId, u.realName, u.nickName, u.phone, u.jobNo, u.isBan, tm.createdAt AS assignedAt
        FROM tag_members tm
        JOIN users u ON tm.userId = u.id
        WHERE tm.schoolId = ? AND u.isDeleted = 0
      `;
      const members: any[] = await executeASTSelect(memberSql, [schoolId]);

      const memberMap = new Map<number, any[]>();
      for (const m of members) {
        if (!memberMap.has(m.tagId)) memberMap.set(m.tagId, []);
        memberMap.get(m.tagId)!.push({
          userId: m.userId,
          realName: m.realName || m.nickName || "未实名",
          phone: m.phone || "",
          jobNo: m.jobNo || "",
          userStatus: m.isBan !== undefined ? m.isBan : 0,
          assignedAt: m.assignedAt
        });
      }

      dashboard = tags.map((t: any) => {
        const tagMemberList = memberMap.get(t.id) || [];
        return {
          tagId: t.id,
          schoolId: t.schoolId,
          tagName: t.name,
          tagColor: t.color,
          tagDesc: t.desc || "",
          sortOrder: t.sortOrder,
          activeMembersCount: tagMemberList.length,
          members: tagMemberList,
          authorizedScopes: {
            campusNames: ["全校通用"],
            categoryNames: ["综合维保"]
          }
        };
      });
    } else {
      // 内存沙箱大盘组装
      const tags = Array.from(mockTagsMap.values())
        .filter((t) => t.schoolId === schoolId && t.isDeleted === 0)
        .sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id - b.id));

      const { WeChatAuthService } = await import("../auth/wechatAuthService.js");
      const usersMap = WeChatAuthService.getMockUsersMap();

      dashboard = tags.map((t) => {
        const members: any[] = [];
        for (const tm of mockTagMembersMap.values()) {
          if (tm.schoolId === schoolId && tm.tagId === t.id) {
            const user = usersMap.get(tm.userId);
            members.push({
              userId: tm.userId,
              realName: user?.realName || "测试师傅",
              phone: user?.phone || "",
              jobNo: user?.jobNo || "",
              userStatus: user?.isBan || 0,
              assignedAt: tm.createdAt
            });
          }
        }
        return {
          tagId: t.id,
          schoolId: t.schoolId,
          tagName: t.name,
          tagColor: t.color,
          tagDesc: t.desc || "",
          sortOrder: t.sortOrder,
          activeMembersCount: members.length,
          members,
          authorizedScopes: {
            campusNames: ["全校通用"],
            categoryNames: ["综合维保"]
          }
        };
      });
    }

    // 3. 写入缓存 (30 分钟 TTL)
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(dashboard), "EX", 1800);
      } catch {}
    }
    await setTenantKV(schoolId, "tag", "assignments", dashboard, 1800);

    return dashboard;
  }

  /**
   * 创建岗位职能标签
   */
  public static async createTag(schoolId: number, dto: ICreateTagDto): Promise<ITagEntity> {
    if (!dto.name || dto.name.trim() === "") {
      throw new Error("岗位标签名称不能为空");
    }

    const tagName = dto.name.trim();

    // 1. 同名唯一性校验 (uk_school_tag)
    const duplicate = await this.checkTagNameDuplicate(schoolId, tagName);
    if (duplicate) {
      throw new Error(`同名岗位标签 [${tagName}] 已存在，请勿重复创建`);
    }

    // 2. 自适应 Windows Metro UI 经典色彩分配
    const color = dto.color || MetroColorAssigner.assignColor(tagName);

    let newTag: ITagEntity;

    if (getMySQLPool()) {
      const insertSql = `
        INSERT INTO tags (schoolId, name, color, \`desc\`, sortOrder, isDeleted)
        VALUES (?, ?, ?, ?, ?, 0)
      `;
      const res: any = await executeASTInsert(insertSql, [
        schoolId,
        tagName,
        color,
        dto.desc || "",
        dto.sortOrder || 0
      ]);

      const tagId = res.insertId || res.data?.[0]?.insertId || res.data?.[0]?.id;

      if (dto.initialMemberUserIds && dto.initialMemberUserIds.length > 0) {
        for (const uId of dto.initialMemberUserIds) {
          await this.addMemberToTag(schoolId, tagId, uId);
        }
      }

      newTag = {
        id: tagId,
        schoolId,
        name: tagName,
        color,
        desc: dto.desc || "",
        sortOrder: dto.sortOrder || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: 0
      };
    } else {
      const tagId = mockTagIdCounter++;
      newTag = {
        id: tagId,
        schoolId,
        name: tagName,
        color,
        desc: dto.desc || "",
        sortOrder: dto.sortOrder || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: 0
      };
      mockTagsMap.set(tagId, newTag);

      if (dto.initialMemberUserIds && dto.initialMemberUserIds.length > 0) {
        for (const uId of dto.initialMemberUserIds) {
          await this.addMemberToTag(schoolId, tagId, uId);
        }
      }
    }

    await this.evictTagCache(schoolId);
    TerminalLogger.info(
      `[M16 岗位标签] 学校 ${schoolId} 新建标签 ${tagName} (id: ${newTag.id}, color: ${color})`,
      "TagCenter"
    );

    return newTag;
  }

  /**
   * 更新岗位标签元数据
   */
  public static async updateTag(schoolId: number, tagId: number, dto: IUpdateTagDto): Promise<ITagEntity> {
    const tag = await this.getTagById(schoolId, tagId);
    if (!tag) {
      throw new Error("待更新的岗位标签不存在");
    }

    if (dto.name && dto.name.trim() !== tag.name) {
      const trimmed = dto.name.trim();
      const duplicate = await this.checkTagNameDuplicate(schoolId, trimmed, tagId);
      if (duplicate) {
        throw new Error(`同名岗位标签 [${trimmed}] 已存在，请勿重复更新`);
      }
      tag.name = trimmed;
    }

    if (dto.color !== undefined) tag.color = dto.color;
    if (dto.desc !== undefined) tag.desc = dto.desc;
    if (dto.sortOrder !== undefined) tag.sortOrder = dto.sortOrder;
    tag.updatedAt = new Date().toISOString();

    if (getMySQLPool()) {
      const sql = `
        UPDATE tags 
        SET name = ?, color = ?, \`desc\` = ?, sortOrder = ?, updatedAt = NOW()
        WHERE schoolId = ? AND id = ? AND isDeleted = 0
      `;
      await executeASTUpdate(sql, [tag.name, tag.color, tag.desc, tag.sortOrder, schoolId, tagId]);
    } else {
      mockTagsMap.set(tagId, tag);
    }

    await this.evictTagCache(schoolId);
    return tag;
  }

  /**
   * 软删除岗位标签 (FlowLock 联动：名下在办工单阻断门禁)
   */
  public static async deleteTag(schoolId: number, tagId: number): Promise<boolean> {
    const tag = await this.getTagById(schoolId, tagId);
    if (!tag) {
      throw new Error("待删除的岗位标签不存在");
    }

    // 检查是否有在办工单 (status IN (1, 2))
    const hasActivePatrols = await this.hasActivePatrolsForTag(schoolId, tagId);
    if (hasActivePatrols) {
      throw new Error("无法删除: 该岗位标签名下仍有进行中的工单，请先完成工单交接");
    }

    if (getMySQLPool()) {
      const delSql = `UPDATE tags SET isDeleted = 1, updatedAt = NOW() WHERE schoolId = ? AND id = ?`;
      await executeASTUpdate(delSql, [schoolId, tagId]);
    } else {
      tag.isDeleted = 1;
      tag.updatedAt = new Date().toISOString();
    }

    await this.evictTagCache(schoolId);
    return true;
  }

  /**
   * 为岗位标签绑定新人员 (守护单用户持岗上限 Max Limit = 10)
   */
  public static async addMemberToTag(schoolId: number, tagId: number, userId: number): Promise<boolean> {
    const tag = await this.getTagById(schoolId, tagId);
    if (!tag) {
      throw new Error("指定的岗位标签不存在");
    }

    // 检查该用户是否已持有该标签
    const alreadyMember = await this.isUserInTag(schoolId, tagId, userId);
    if (alreadyMember) {
      return true; // 幂等放行
    }

    // 单用户持岗数量硬上限守护
    const currentTagCount = await this.getUserTagCount(schoolId, userId);
    if (currentTagCount >= 10) {
      throw new Error("该员工持岗已达上限 (10个)，请先解除部分闲置岗位");
    }

    if (getMySQLPool()) {
      const sql = `
        INSERT IGNORE INTO tag_members (schoolId, tagId, userId, createdAt)
        VALUES (?, ?, ?, NOW())
      `;
      await executeASTInsert(sql, [schoolId, tagId, userId]);
    } else {
      const mId = mockMemberIdCounter++;
      mockTagMembersMap.set(mId, {
        id: mId,
        schoolId,
        tagId,
        userId,
        createdAt: new Date().toISOString()
      });
    }

    await this.evictTagCache(schoolId);
    return true;
  }

  /**
   * 解除人员岗位标签绑定
   */
  public static async removeMemberFromTag(schoolId: number, tagId: number, userId: number): Promise<boolean> {
    if (getMySQLPool()) {
      const sql = `DELETE FROM tag_members WHERE schoolId = ? AND tagId = ? AND userId = ?`;
      await executeASTUpdate(sql, [schoolId, tagId, userId]);
    } else {
      for (const [id, tm] of mockTagMembersMap.entries()) {
        if (tm.schoolId === schoolId && tm.tagId === tagId && tm.userId === userId) {
          mockTagMembersMap.delete(id);
          break;
        }
      }
    }

    await this.evictTagCache(schoolId);
    return true;
  }

  /**
   * 算法 2：一键岗位轮岗无缝交接 (零写放大)
   */
  public static async handoverTag(
    schoolId: number,
    tagId: number,
    fromUserId: number,
    toUserId: number
  ): Promise<IHandoverResultDto> {
    if (fromUserId === toUserId) {
      throw new Error("交接人与接任人不能为同一用户");
    }

    // 1. 校验交接双方是否均属于当前学校 (防跨租户窜访)
    const users = await this.getSchoolUsersByIds(schoolId, [fromUserId, toUserId]);
    if (users.length < 2) {
      throw new Error("交接双方必须是本校合法有效用户");
    }

    const fromUser = users.find((u) => u.id === fromUserId);
    const toUser = users.find((u) => u.id === toUserId);

    if (!fromUser || !toUser) {
      throw new Error("交接双方必须是本校合法有效用户");
    }

    // 2. 校验岗位标签合法性
    const tag = await this.getTagById(schoolId, tagId);
    if (!tag) {
      throw new Error("指定的岗位标签不存在");
    }

    // 3. 校验移交人当前确实持有该标签
    const fromUserHolding = await this.isUserInTag(schoolId, tagId, fromUserId);
    if (!fromUserHolding) {
      throw new Error(`交接失败: 当前移交人员未持有该岗位职能标签`);
    }

    // 4. 接任人持岗上限检查 (若接任人尚未持有该标签)
    const toUserHolding = await this.isUserInTag(schoolId, tagId, toUserId);
    if (!toUserHolding) {
      const toUserTagCount = await this.getUserTagCount(schoolId, toUserId);
      if (toUserTagCount >= 10) {
        throw new Error(`接任人 [${toUser.realName}] 持岗已达上限 (10个)，无法接任`);
      }
    }

    // 5. 执行原子单条置换 (零写放大)
    if (getMySQLPool()) {
      const handoverSql = `
        UPDATE tag_members 
        SET userId = ?, createdAt = NOW() 
        WHERE schoolId = ? AND tagId = ? AND userId = ?
      `;
      const updateRes: any = await executeASTUpdate(handoverSql, [toUserId, schoolId, tagId, fromUserId]);
      if (updateRes.affectedRows === 0) {
        throw new Error(`移交人员 [${fromUser.realName}] 当前未持有此标签`);
      }
    } else {
      let swapped = false;
      for (const tm of mockTagMembersMap.values()) {
        if (tm.schoolId === schoolId && tm.tagId === tagId && tm.userId === fromUserId) {
          tm.userId = toUserId;
          tm.createdAt = new Date().toISOString();
          swapped = true;
          break;
        }
      }
      if (!swapped) {
        throw new Error(`移交人员 [${fromUser.realName}] 当前未持有此标签`);
      }
    }

    // 6. 清理缓存
    await this.evictTagCache(schoolId);

    const transferredAt = new Date().toISOString();
    TerminalLogger.info(
      `[M16 一键交接] 标签 [${tag.name}] 由 ${fromUser.realName} 成功交接给 ${toUser.realName} (在办工单零改动)`,
      "TagHandover"
    );

    return {
      tagId,
      tagName: tag.name,
      fromUserId,
      fromUserName: fromUser.realName || fromUser.nickName || "原在岗人员",
      toUserId,
      toUserName: toUser.realName || toUser.nickName || "新在岗人员",
      transferredAt
    };
  }

  /**
   * 解析指定标签当前在岗值班人员清单 (提供给 M23 智能网格派单)
   */
  public static async resolveTagOnDutyUsers(schoolId: number, tagId: number): Promise<number[]> {
    if (getMySQLPool()) {
      const sql = `SELECT userId FROM tag_members WHERE schoolId = ? AND tagId = ?`;
      const rows: any[] = await executeASTSelect(sql, [schoolId, tagId]);
      return rows.map((r) => Number(r.userId));
    }

    const uIds: number[] = [];
    for (const tm of mockTagMembersMap.values()) {
      if (tm.schoolId === schoolId && tm.tagId === tagId) {
        uIds.push(tm.userId);
      }
    }
    return uIds;
  }

  /**
   * 按照 ID 检索岗位标签实体
   */
  public static async getTagById(schoolId: number, tagId: number): Promise<ITagEntity | null> {
    if (getMySQLPool()) {
      const sql = `SELECT * FROM tags WHERE schoolId = ? AND id = ? AND isDeleted = 0 LIMIT 1`;
      const rows: any[] = await executeASTSelect(sql, [schoolId, tagId]);
      return rows.length > 0 ? rows[0] : null;
    }

    const tag = mockTagsMap.get(tagId);
    if (tag && tag.schoolId === schoolId && tag.isDeleted === 0) {
      return { ...tag };
    }
    return null;
  }

  private static async checkTagNameDuplicate(
    schoolId: number,
    name: string,
    excludeTagId?: number
  ): Promise<boolean> {
    if (getMySQLPool()) {
      let sql = `SELECT id FROM tags WHERE schoolId = ? AND name = ? AND isDeleted = 0`;
      const params: any[] = [schoolId, name];
      if (excludeTagId) {
        sql += ` AND id != ?`;
        params.push(excludeTagId);
      }
      sql += ` LIMIT 1`;
      const rows: any[] = await executeASTSelect(sql, params);
      return rows.length > 0;
    }

    for (const tag of mockTagsMap.values()) {
      if (tag.schoolId === schoolId && tag.isDeleted === 0 && tag.name === name && tag.id !== excludeTagId) {
        return true;
      }
    }
    return false;
  }

  private static async isUserInTag(schoolId: number, tagId: number, userId: number): Promise<boolean> {
    if (getMySQLPool()) {
      const sql = `SELECT id FROM tag_members WHERE schoolId = ? AND tagId = ? AND userId = ? LIMIT 1`;
      const rows: any[] = await executeASTSelect(sql, [schoolId, tagId, userId]);
      return rows.length > 0;
    }

    for (const tm of mockTagMembersMap.values()) {
      if (tm.schoolId === schoolId && tm.tagId === tagId && tm.userId === userId) {
        return true;
      }
    }
    return false;
  }

  private static async getUserTagCount(schoolId: number, userId: number): Promise<number> {
    if (getMySQLPool()) {
      const sql = `
        SELECT COUNT(1) AS cnt 
        FROM tag_members tm
        JOIN tags t ON tm.tagId = t.id
        WHERE tm.schoolId = ? AND tm.userId = ? AND t.isDeleted = 0
      `;
      const rows: any[] = await executeASTSelect(sql, [schoolId, userId]);
      return rows[0]?.cnt || 0;
    }

    let count = 0;
    for (const tm of mockTagMembersMap.values()) {
      if (tm.schoolId === schoolId && tm.userId === userId) {
        const tag = mockTagsMap.get(tm.tagId);
        if (tag && tag.schoolId === schoolId && tag.isDeleted === 0) {
          count++;
        }
      }
    }
    return count;
  }

  private static async hasActivePatrolsForTag(schoolId: number, tagId: number): Promise<boolean> {
    if (getMySQLPool()) {
      const sql = `SELECT COUNT(1) AS cnt FROM patrols WHERE schoolId = ? AND tagId = ? AND status IN (1, 2) AND isDeleted = 0`;
      const rows: any[] = await executeASTSelect(sql, [schoolId, tagId]);
      return rows[0]?.cnt > 0;
    }

    return false;
  }

  private static async getSchoolUsersByIds(schoolId: number, userIds: number[]): Promise<any[]> {
    if (getMySQLPool()) {
      const sql = `SELECT id, realName, nickName FROM users WHERE schoolId = ? AND id IN (${userIds.join(",")})`;
      return await executeASTSelect(sql, [schoolId]);
    }

    const { WeChatAuthService } = await import("../auth/wechatAuthService.js");
    const usersMap = WeChatAuthService.getMockUsersMap();
    const result: any[] = [];
    for (const id of userIds) {
      const u = usersMap.get(id);
      if (u && u.schoolId === schoolId) {
        result.push({ id: u.id, realName: u.realName, nickName: u.realName });
      }
    }
    return result;
  }

  private static async evictTagCache(schoolId: number): Promise<void> {
    const redis = getRedisClient();
    const cacheKey = `tenant:${schoolId}:tag:assignments`;
    if (redis) {
      try {
        await redis.del(cacheKey);
      } catch {}
    }
    await delTenantKV(schoolId, "tag", "assignments");
  }
}
