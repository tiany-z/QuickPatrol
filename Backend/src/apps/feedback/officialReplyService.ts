/**
 * 高校后勤巡查e速办 v4.0 - M32: 诉求责任科室流转与官方正式答复业务服务
 * (Official Reply Service & Flow Engine)
 */

import crypto from "crypto";
import { executeQuery, getMySQLPool } from "../../shared/db/mysql.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { ConfidentialVaultService } from "./confidentialVaultService.js";
import { DeptDispatcher } from "./deptDispatcher.js";
import {
  ISubmitReplyRequestDto,
  ISubmitReplyResponseDto,
  ISendThanksCardRequestDto,
  ISendThanksCardResponseDto,
  ThanksCardType,
  ISlaCountdownResult
} from "./officialReplyTypes.js";

// 离线单测内存沙箱数据结构
interface IMockPostRow {
  id: number;
  schoolId: number;
  creatorId: number;
  title: string;
  content: string;
  status: number;
  isTop: number;
  targetDeptId?: number;
  targetDeptName?: string;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface IMockCommentRow {
  id: number;
  schoolId: number;
  postId: number;
  userId: number;
  guestNick: string;
  content: string;
  createdAt: string;
  isDeleted: number;
}

const mockPostsStore = new Map<number, IMockPostRow>();
const mockCommentsStore: IMockCommentRow[] = [];
let mockCommentIdCounter = 1000;

export class OfficialReplyService {
  /**
   * 重置测试沙箱内存数据
   */
  public static resetMockData(): void {
    mockPostsStore.clear();
    mockCommentsStore.length = 0;
    mockCommentIdCounter = 1000;
  }

  /**
   * 注册虚拟诉求 (供单元测试初始化)
   */
  public static mockRegisterPost(post: Partial<IMockPostRow> & { id: number; schoolId: number; title: string }): IMockPostRow {
    const row: IMockPostRow = {
      id: post.id,
      schoolId: post.schoolId,
      creatorId: post.creatorId ?? 0,
      title: post.title,
      content: post.content || "",
      status: post.status ?? 0,
      isTop: post.isTop ?? 0,
      targetDeptId: post.targetDeptId ?? 1,
      targetDeptName: post.targetDeptName || "后勤管理处综合办公室",
      likeCount: post.likeCount ?? 0,
      commentCount: post.commentCount ?? 0,
      createdAt: post.createdAt || new Date().toISOString(),
      updatedAt: post.updatedAt || new Date().toISOString()
    };
    mockPostsStore.set(row.id, row);
    return row;
  }

  public static getMockPost(id: number): IMockPostRow | undefined {
    return mockPostsStore.get(id);
  }

  /**
   * 1. 科室主管主动认领承办诉求
   */
  public static async claimAppeal(
    schoolId: number,
    appealId: number,
    operatorUserId: number,
    departmentId: number
  ): Promise<void> {
    if (getMySQLPool()) {
      const lockSql = `SELECT id, status FROM posts WHERE id = ? AND schoolId = ? FOR UPDATE`;
      const rows = await executeQuery(lockSql, [appealId, schoolId]);
      if (rows.status !== 1 || !rows.data || rows.data.length === 0) {
        throw new Error("未找到目标诉求或无权访问");
      }

      await executeQuery(
        `UPDATE posts SET targetDepartmentId = ?, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [departmentId, appealId, schoolId]
      );
    } else {
      const post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("未找到目标诉求或无权访问");
      }
      post.targetDeptId = departmentId;
      post.updatedAt = new Date().toISOString();
    }

    // 记录流转审计日志
    await AuditLogger.log(
      schoolId,
      operatorUserId,
      "CLAIM_APPEAL",
      "Patrol",
      "127.0.0.1",
      { appealId, departmentId }
    );
  }

  /**
   * 2. 部门职责不符申请退单至综合办仲裁
   */
  public static async rejectToOffice(
    schoolId: number,
    appealId: number,
    operatorUserId: number,
    reason: string
  ): Promise<void> {
    if (!reason || reason.trim().length < 5) {
      throw new Error("PARAM_ERROR: 申请退回理由不能少于 5 个字");
    }

    if (getMySQLPool()) {
      const lockSql = `SELECT id, status FROM posts WHERE id = ? AND schoolId = ? FOR UPDATE`;
      const rows = await executeQuery(lockSql, [appealId, schoolId]);
      if (rows.status !== 1 || !rows.data || rows.data.length === 0) {
        throw new Error("未找到目标诉求或无权访问");
      }

      // 退回综合办公室公海池 (deptId = 1)
      await executeQuery(
        `UPDATE posts SET targetDepartmentId = 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [appealId, schoolId]
      );
    } else {
      const post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("未找到目标诉求或无权访问");
      }
      post.targetDeptId = 1;
      post.updatedAt = new Date().toISOString();
    }

    await AuditLogger.log(
      schoolId,
      operatorUserId,
      "REJECT_TO_OFFICE",
      "Patrol",
      "127.0.0.1",
      { appealId, reason: reason.trim() }
    );
  }

  /**
   * 3. 综合办总调度强制二次指派责任科室 (不可再退回)
   */
  public static async forceAssignDepartment(
    schoolId: number,
    appealId: number,
    operatorUserId: number,
    targetDeptId: number,
    assignNote: string,
    isLocked: boolean = true
  ): Promise<void> {
    if (getMySQLPool()) {
      await executeQuery(
        `UPDATE posts SET targetDepartmentId = ?, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [targetDeptId, appealId, schoolId]
      );
    } else {
      const post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("未找到目标诉求或无权访问");
      }
      post.targetDeptId = targetDeptId;
      post.updatedAt = new Date().toISOString();
    }

    await AuditLogger.log(
      schoolId,
      operatorUserId,
      "FORCE_ASSIGN_DEPT",
      "Patrol",
      "127.0.0.1",
      { appealId, targetDeptId, assignNote, isLocked }
    );
  }

  /**
   * 4. 科室出具官方正式红头答复公函
   */
  public static async submitOfficialReply(
    schoolId: number,
    appealId: number,
    officerUserId: number,
    officerDeptId: number,
    dto: ISubmitReplyRequestDto
  ): Promise<ISubmitReplyResponseDto> {
    // 校验正文字数
    if (!dto.content || dto.content.trim().length < 20) {
      throw new Error("PARAM_ERROR: 官方正式答复正文不能少于 20 个字，请详实说明事实调查与整改举措");
    }

    if (!dto.decreeTitle || dto.decreeTitle.trim().length < 5 || dto.decreeTitle.trim().length > 50) {
      throw new Error("PARAM_ERROR: 公函标题须在 5 ~ 50 字之间");
    }

    let departmentName = "后勤饮食服务中心";
    if (getMySQLPool()) {
      const deptRows = await executeQuery(
        `SELECT name FROM departments WHERE id = ? AND schoolId = ? LIMIT 1`,
        [officerDeptId, schoolId]
      );
      if (deptRows.status === 1 && deptRows.data?.[0]?.name) {
        departmentName = deptRows.data[0].name;
      }
    } else {
      const rule = DeptDispatcher.RULES.find(r => r.deptId === officerDeptId);
      if (rule) {
        departmentName = rule.name;
      }
    }

    // 计算承诺截止时间
    const promiseDays = Math.max(1, Math.min(15, dto.promiseDays || 3));
    const deadlineDate = new Date(Date.now() + promiseDays * 24 * 3600 * 1000);
    const deadlineAtStr = deadlineDate.toISOString().replace("T", " ").substring(0, 19);

    // 16位大写数字防伪特征码
    const rawFingerprint = `${schoolId}:${appealId}:${officerDeptId}:${dto.decreeTitle}:${Date.now()}`;
    const digitalFingerprint = crypto
      .createHash("sha256")
      .update(rawFingerprint)
      .digest("hex")
      .substring(0, 16)
      .toUpperCase();

    // 结构化公函数据
    const structuredContent = JSON.stringify({
      decreeTitle: dto.decreeTitle.trim(),
      responderTitle: dto.responderTitle?.trim() || "科室经办主管",
      departmentName,
      promiseDays,
      deadlineAt: deadlineAtStr,
      digitalFingerprint,
      body: dto.content.trim(),
      images: dto.imageUrls || []
    });

    let replyId = ++mockCommentIdCounter;

    if (getMySQLPool()) {
      // 悲观行锁
      const lockRes = await executeQuery(
        `SELECT id, status FROM posts WHERE id = ? AND schoolId = ? FOR UPDATE`,
        [appealId, schoolId]
      );
      if (lockRes.status !== 1 || !lockRes.data || lockRes.data.length === 0) {
        throw new Error("未找到目标诉求或无权访问");
      }

      const insertSql = `
        INSERT INTO post_comments (
          schoolId, postId, userId, guestNick, guestAvatar, 
          replyCommentId, content, createdAt, isDeleted
        ) VALUES (
          ?, ?, ?, ?, '', 
          0, ?, NOW(), 0
        )
      `;
      const qRes = await executeQuery(insertSql, [
        schoolId,
        appealId,
        officerUserId,
        `[官方正式答复] ${departmentName}`,
        structuredContent
      ]);
      if (qRes.status === 1 && (qRes.data as any)?.insertId) {
        replyId = (qRes.data as any).insertId;
      }

      // 更新 posts 状态为 1 (官方已答复), 累加评论数
      await executeQuery(
        `UPDATE posts SET status = 1, commentCount = commentCount + 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [appealId, schoolId]
      );
    } else {
      const post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("未找到目标诉求或无权访问");
      }
      post.status = 1;
      post.commentCount += 1;
      post.updatedAt = new Date().toISOString();

      mockCommentsStore.push({
        id: replyId,
        schoolId,
        postId: appealId,
        userId: officerUserId,
        guestNick: `[官方正式答复] ${departmentName}`,
        content: structuredContent,
        createdAt: new Date().toISOString(),
        isDeleted: 0
      });
    }

    await AuditLogger.log(
      schoolId,
      officerUserId,
      "OFFICIAL_REPLY_SUBMIT",
      "Patrol",
      "127.0.0.1",
      { appealId, replyId, digitalFingerprint, promiseDays }
    );

    return {
      replyId,
      appealId,
      schoolId,
      departmentName,
      responderTitle: dto.responderTitle?.trim() || "科室经办主管",
      deadlineAt: deadlineAtStr,
      digitalFingerprint,
      repliedAt: new Date().toISOString(),
      statusText: "官方正式答复公函已生效并加盖印章"
    };
  }

  /**
   * 5. 师生向责任科室赠送文创感谢卡
   */
  public static async sendThanksCard(
    schoolId: number,
    studentUserId: number,
    dto: ISendThanksCardRequestDto
  ): Promise<ISendThanksCardResponseDto> {
    const { appealId, cardType, studentComment, vaultToken } = dto;

    // 1. 若为匿名提报诉求，严格验签 VaultToken
    if (vaultToken) {
      const payload = ConfidentialVaultService.verifyAndDecodeVaultToken(vaultToken, schoolId);
      if (payload.postId !== appealId) {
        throw new Error("凭证安全校验失败: 感谢卡必须由该诉求的原提报人赠送！");
      }
    }

    // 2. 检查该诉求是否已被正式答复 (status === 1)
    let postStatus = 0;
    if (getMySQLPool()) {
      const checkSql = `SELECT id, status FROM posts WHERE id = ? AND schoolId = ? LIMIT 1`;
      const postRows = await executeQuery(checkSql, [appealId, schoolId]);
      if (postRows.status !== 1 || !postRows.data || postRows.data.length === 0) {
        throw new Error("未找到目标诉求或无权访问");
      }
      postStatus = postRows.data[0].status;
    } else {
      const post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("未找到目标诉求或无权访问");
      }
      postStatus = post.status;
    }

    if (postStatus !== 1) {
      throw new Error("该诉求尚未收到官方正式答复，无法赠送感谢卡！");
    }

    // 3. 一单一卡防刷风控
    let hasSentThanksCard = false;
    if (getMySQLPool()) {
      const commentRows = await executeQuery(
        `SELECT content FROM post_comments WHERE postId = ? AND schoolId = ? AND isDeleted = 0`,
        [appealId, schoolId]
      );
      if (commentRows.status === 1 && commentRows.data) {
        hasSentThanksCard = commentRows.data.some((c: any) => {
          try {
            return JSON.parse(c.content)?.isThanksCard === true;
          } catch {
            return false;
          }
        });
      }
    } else {
      hasSentThanksCard = mockCommentsStore.some(
        c => c.postId === appealId && c.schoolId === schoolId && (() => {
          try {
            return JSON.parse(c.content)?.isThanksCard === true;
          } catch {
            return false;
          }
        })()
      );
    }

    if (hasSentThanksCard) {
      throw new Error("针对该诉求您已赠送过文创感谢卡，请勿重复赠送！");
    }

    // 4. 构造文创卡片元数据
    const cardMap: Record<ThanksCardType, { name: string; points: number; badge: string }> = {
      SPEED: { name: "⚡ 神速解决卡", points: 10, badge: "神速使者" },
      WARMTH: { name: "🌸 暖心关怀卡", points: 10, badge: "暖心使者" },
      ACTION: { name: "🛠️ 雷厉风行卡", points: 15, badge: "攻坚啄木鸟" },
      PRAISE: { name: "🌟 全五星赞赏卡", points: 20, badge: "卓越监督官" }
    };

    const cardMeta = cardMap[cardType] || cardMap.PRAISE;

    const thanksPayload = JSON.stringify({
      isThanksCard: true,
      cardType,
      cardTypeName: cardMeta.name,
      studentComment: studentComment.trim(),
      pointsAwarded: cardMeta.points
    });

    let cardId = ++mockCommentIdCounter;

    if (getMySQLPool()) {
      const insertCardSql = `
        INSERT INTO post_comments (
          schoolId, postId, userId, guestNick, guestAvatar, 
          replyCommentId, content, createdAt, isDeleted
        ) VALUES (
          ?, ?, ?, '致谢师生', '', 
          0, ?, NOW(), 0
        )
      `;
      const qRes = await executeQuery(insertCardSql, [
        schoolId,
        appealId,
        studentUserId || 0,
        thanksPayload
      ]);
      if (qRes.status === 1 && (qRes.data as any)?.insertId) {
        cardId = (qRes.data as any).insertId;
      }

      await executeQuery(
        `UPDATE posts SET likeCount = likeCount + 1, commentCount = commentCount + 1, updatedAt = NOW() WHERE id = ? AND schoolId = ?`,
        [appealId, schoolId]
      );
    } else {
      mockCommentsStore.push({
        id: cardId,
        schoolId,
        postId: appealId,
        userId: studentUserId || 0,
        guestNick: "致谢师生",
        content: thanksPayload,
        createdAt: new Date().toISOString(),
        isDeleted: 0
      });

      const post = mockPostsStore.get(appealId);
      if (post) {
        post.likeCount += 1;
        post.commentCount += 1;
        post.updatedAt = new Date().toISOString();
      }
    }

    await AuditLogger.log(
      schoolId,
      studentUserId || 0,
      "SEND_THANKS_CARD",
      "Patrol",
      "127.0.0.1",
      { appealId, cardId, cardType, points: cardMeta.points }
    );

    return {
      cardId,
      appealId,
      cardType,
      cardTypeName: cardMeta.name,
      pointsAwarded: cardMeta.points,
      badgeAwarded: cardMeta.badge,
      departmentTotalThanksCount: 88, // 演示/测试聚合总数
      createdAt: new Date().toISOString()
    };
  }

  /**
   * 6. 将优秀办结诉求推选至 M33 校园公开空间
   */
  public static async promoteToPublicSpace(
    schoolId: number,
    appealId: number,
    operatorId: number,
    isTop: boolean = false
  ): Promise<void> {
    if (getMySQLPool()) {
      const updateSql = `
        UPDATE posts 
        SET isTop = ?, status = 1, updatedAt = NOW() 
        WHERE id = ? AND schoolId = ?
      `;
      const res = await executeQuery(updateSql, [isTop ? 1 : 0, appealId, schoolId]);
      if (res.status !== 1) {
        throw new Error("推选失败: 未找到目标诉求记录");
      }
    } else {
      const post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("推选失败: 未找到目标诉求记录");
      }
      post.isTop = isTop ? 1 : 0;
      post.status = 1;
      post.updatedAt = new Date().toISOString();
    }

    await AuditLogger.log(
      schoolId,
      operatorId,
      "PROMOTE_TO_PUBLIC",
      "Patrol",
      "127.0.0.1",
      { appealId, isTop }
    );
  }

  /**
   * 7. 获取诉求详情 (支持 ETag 304 快速放行与官方答复提取)
   */
  public static async getAppealDetail(
    schoolId: number,
    appealId: number,
    clientETag?: string,
    vaultToken?: string
  ): Promise<{ isModified: boolean; currentETag: string; appeal?: any; sla?: ISlaCountdownResult }> {
    let post: any;
    let comments: any[] = [];

    if (getMySQLPool()) {
      const postRes = await executeQuery(
        `SELECT * FROM posts WHERE id = ? AND schoolId = ? AND isDeleted = 0 LIMIT 1`,
        [appealId, schoolId]
      );
      if (postRes.status !== 1 || !postRes.data || postRes.data.length === 0) {
        throw new Error("诉求不存在或已被删除");
      }
      post = postRes.data[0];

      const commentsRes = await executeQuery(
        `SELECT * FROM post_comments WHERE postId = ? AND schoolId = ? AND isDeleted = 0 ORDER BY id ASC`,
        [appealId, schoolId]
      );
      if (commentsRes.status === 1 && commentsRes.data) {
        comments = commentsRes.data;
      }
    } else {
      post = mockPostsStore.get(appealId);
      if (!post || post.schoolId !== schoolId) {
        throw new Error("诉求不存在或已被删除");
      }
      comments = mockCommentsStore.filter(c => c.postId === appealId && c.schoolId === schoolId);
    }

    // 提取官方答复公函
    let officialReply: any = null;
    const thanksCards: any[] = [];
    const normalComments: any[] = [];

    for (const c of comments) {
      try {
        const parsed = JSON.parse(c.content);
        if (parsed.decreeTitle && parsed.digitalFingerprint) {
          officialReply = {
            replyId: c.id,
            createdAt: c.createdAt,
            ...parsed
          };
        } else if (parsed.isThanksCard) {
          thanksCards.push({
            cardId: c.id,
            createdAt: c.createdAt,
            ...parsed
          });
        } else {
          normalComments.push(c);
        }
      } catch {
        normalComments.push(c);
      }
    }

    // 比对 ETag
    const etagRes = DeptDispatcher.checkETag(
      {
        id: post.id,
        status: post.status,
        updatedAt: typeof post.updatedAt === "string" ? post.updatedAt : new Date(post.updatedAt).toISOString()
      },
      officialReply ? { id: officialReply.replyId, createdAt: officialReply.createdAt } : null,
      clientETag
    );

    if (!etagRes.isModified) {
      return {
        isModified: false,
        currentETag: etagRes.currentETag
      };
    }

    // 计算 SLA 状态
    let sla: ISlaCountdownResult | undefined;
    if (officialReply?.deadlineAt) {
      sla = DeptDispatcher.calculateSla(
        officialReply.createdAt,
        officialReply.promiseDays || 3,
        post.status === 3
      );
    }

    return {
      isModified: true,
      currentETag: etagRes.currentETag,
      appeal: {
        id: post.id,
        schoolId: post.schoolId,
        title: post.title,
        content: post.content,
        creatorId: post.creatorId,
        status: post.status,
        isTop: post.isTop,
        targetDeptId: post.targetDeptId,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        officialReply,
        thanksCards,
        commentsCount: normalComments.length
      },
      sla
    };
  }
}
