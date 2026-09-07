/**
 * 高校后勤巡查e速办 v4.0 - M24: 师傅抢修工作台与接单协同控制器
 * (Accept & Workbench Controller)
 * 
 * 核心职责：
 * 1. 师傅接单与抢单接口 (POST /api/patrol/accept)
 * 2. 现场协同改派与同组转交接口 (POST /api/patrol/transfer)
 * 3. 师傅四象限看板未读角标聚合统计 (GET /api/patrol/workbench-summary)
 * 4. 师傅四象限任务列表动态加权分页检索 (GET /api/patrol/workbench-list)
 */

import { returnError, returnSuccess, StandardResult } from "../../shared/flow/result.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { executeASTSelect } from "../../shared/sql/astRunner.js";
import { WeChatAuthService } from "../../services/auth/wechatAuthService.js";
import { PatrolService } from "./patrolService.js";
import { PatrolStateMachine } from "./patrolStateMachine.js";
import { TransferService } from "./transferService.js";
import {
  IAcceptPatrolRequest,
  IAcceptPatrolResponseDto,
  ITransferPatrolRequest,
  ITransferPatrolResponseDto,
  IMasterWorkbenchSummaryDto,
  IMasterWorkbenchQueryDto,
  IMasterTaskCardDto,
  PatrolStatusEnum
} from "./stateMachineTypes.js";

export interface IOperatorContext {
  schoolId: number;
  userId: number;
  role?: number;
  ip?: string;
  realName?: string;
}

export class AcceptController {
  /**
   * 师傅接单 / 抢单处理器
   * POST /api/patrol/accept
   */
  public static async handleAccept(
    ctx: IOperatorContext,
    body: IAcceptPatrolRequest
  ): Promise<StandardResult<IAcceptPatrolResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;

      if (!schoolId || !userId) {
        return returnError("未授权的后勤师傅身份");
      }

      if (!body || !body.patrolId) {
        return returnError("缺少必要参数 patrolId");
      }

      // 获取当前用户姓名
      let userName = ctx.realName;
      if (!userName) {
        const mockUser = WeChatAuthService.getMockUserById(userId);
        userName = mockUser?.realName || `师傅_${userId}`;
      }

      const result = await PatrolStateMachine.executeAcceptClaim(
        schoolId,
        Number(body.patrolId),
        userId,
        userName,
        ip
      );

      return returnSuccess(result);
    } catch (err: any) {
      const isConflict =
        err.message.includes("手慢了") ||
        err.message.includes("冲突") ||
        err.message.includes("并发");
      return returnError(err.message || "接单处理失败");
    }
  }

  /**
   * 现场工种不符改派与同事转交处理器
   * POST /api/patrol/transfer
   */
  public static async handleTransfer(
    ctx: IOperatorContext,
    body: ITransferPatrolRequest
  ): Promise<StandardResult<ITransferPatrolResponseDto>> {
    try {
      const { schoolId, userId, ip = "127.0.0.1" } = ctx;

      if (!schoolId || !userId) {
        return returnError("未授权的后勤人员身份");
      }

      if (!body || !body.patrolId || !body.transferType) {
        return returnError("缺少必要参数 patrolId 或 transferType");
      }

      const result = await TransferService.executeTransfer(schoolId, userId, ip, body);
      return returnSuccess(result);
    } catch (err: any) {
      return returnError(err.message || "协同转派处理失败");
    }
  }

  /**
   * 师傅四象限未读数字统计
   * GET /api/patrol/workbench-summary
   */
  public static async handleGetWorkbenchSummary(
    ctx: IOperatorContext
  ): Promise<StandardResult<IMasterWorkbenchSummaryDto>> {
    try {
      const { schoolId, userId } = ctx;
      if (!schoolId || !userId) {
        return returnError("未登录");
      }

      // 1. 沙箱内存与生产 DB 统一统计
      let poolCount = 0;
      let assignedCount = 0;
      let inProgressCount = 0;
      let reviewCount = 0;

      const allMockPatrols = PatrolService.getAllMockPatrols();
      if (allMockPatrols.length > 0) {
        for (const p of allMockPatrols) {
          if (p.schoolId !== schoolId || p.isDeleted === 1) continue;

          if (p.currentHandlerId === 0 && p.status === PatrolStatusEnum.PENDING) {
            poolCount++;
          } else if (p.currentHandlerId === userId && p.status === PatrolStatusEnum.PENDING) {
            assignedCount++;
          } else if (p.currentHandlerId === userId && p.status === PatrolStatusEnum.IN_PROGRESS) {
            inProgressCount++;
          } else if (
            (p.currentHandlerId === userId || p.currentReviewerId === userId) &&
            p.status === PatrolStatusEnum.UNDER_REVIEW
          ) {
            reviewCount++;
          }
        }
      } else if (getMySQLPool()) {
        const sql = `
          SELECT 
            SUM(CASE WHEN currentHandlerId = 0 AND status = 0 THEN 1 ELSE 0 END) AS poolCount,
            SUM(CASE WHEN currentHandlerId = ? AND status = 0 THEN 1 ELSE 0 END) AS assignedCount,
            SUM(CASE WHEN currentHandlerId = ? AND status = 1 THEN 1 ELSE 0 END) AS inProgressCount,
            SUM(CASE WHEN (currentHandlerId = ? OR currentReviewerId = ?) AND status = 2 THEN 1 ELSE 0 END) AS reviewCount
          FROM patrols
          WHERE schoolId = ? AND isDeleted = 0
        `;
        const rows = await executeASTSelect<any>(sql, [userId, userId, userId, userId, schoolId]);
        if (rows && rows.length > 0) {
          poolCount = Number(rows[0].poolCount || 0);
          assignedCount = Number(rows[0].assignedCount || 0);
          inProgressCount = Number(rows[0].inProgressCount || 0);
          reviewCount = Number(rows[0].reviewCount || 0);
        }
      }

      return returnSuccess({
        poolCount,
        assignedCount,
        inProgressCount,
        reviewCount
      });
    } catch (err: any) {
      return returnError(err.message || "获取工作台统计失败");
    }
  }

  /**
   * 师傅四象限任务列表动态加权分页检索
   * GET /api/patrol/workbench-list
   */
  public static async handleGetWorkbenchList(
    ctx: IOperatorContext,
    query: IMasterWorkbenchQueryDto
  ): Promise<StandardResult<{ list: IMasterTaskCardDto[]; total: number; page: number; pageSize: number }>> {
    try {
      const { schoolId, userId } = ctx;
      if (!schoolId || !userId) {
        return returnError("未登录");
      }

      const tab = query.tab || "pool";
      const page = Math.max(1, Number(query.page || 1));
      const pageSize = Math.max(1, Math.min(50, Number(query.pageSize || 10)));

      // 提取符合当前象限的全部候选单据
      let matchedList: any[] = [];
      const allMockPatrols = PatrolService.getAllMockPatrols();

      if (allMockPatrols.length > 0) {
        matchedList = allMockPatrols.filter((p) => {
          if (p.schoolId !== schoolId || p.isDeleted === 1) return false;
          if (query.campusId && p.campusId !== Number(query.campusId)) return false;
          if (query.categoryId && p.categoryId !== Number(query.categoryId)) return false;

          switch (tab) {
            case "pool":
              return p.currentHandlerId === 0 && p.status === PatrolStatusEnum.PENDING;
            case "assigned":
              return p.currentHandlerId === userId && p.status === PatrolStatusEnum.PENDING;
            case "inProgress":
              return p.currentHandlerId === userId && p.status === PatrolStatusEnum.IN_PROGRESS;
            case "review":
              return (
                (p.currentHandlerId === userId || p.currentReviewerId === userId) &&
                p.status === PatrolStatusEnum.UNDER_REVIEW
              );
            default:
              return false;
          }
        });
      } else if (getMySQLPool()) {
        let conditionSql = "";
        const params: any[] = [schoolId];

        switch (tab) {
          case "pool":
            conditionSql = "currentHandlerId = 0 AND status = 0";
            break;
          case "assigned":
            conditionSql = "currentHandlerId = ? AND status = 0";
            params.push(userId);
            break;
          case "inProgress":
            conditionSql = "currentHandlerId = ? AND status = 1";
            params.push(userId);
            break;
          case "review":
            conditionSql = "(currentHandlerId = ? OR currentReviewerId = ?) AND status = 2";
            params.push(userId, userId);
            break;
        }

        const sql = `
          SELECT * FROM patrols 
          WHERE schoolId = ? AND isDeleted = 0 AND (${conditionSql})
        `;
        matchedList = await executeASTSelect<any>(sql, params);
      }

      // 2. 映射任务卡片并计算 SLA 动态加权分与置顶状态
      const now = Date.now();
      const cardList: IMasterTaskCardDto[] = matchedList.map((p) => {
        const deadlineTs = p.deadline ? new Date(p.deadline).getTime() : now + 24 * 3600 * 1000;
        const remainingHours = Number(((deadlineTs - now) / (3600 * 1000)).toFixed(1));

        // 静态紧急程度分 (特急=100, 中等=50, 普通=20)
        const staticScore = p.priorityLevel === 2 ? 100 : p.priorityLevel === 1 ? 50 : 20;

        // 动态时间紧迫分 (倒计时不足 12 小时逐渐逼近 100 分)
        const timeUrgencyScore = remainingHours <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(100 - remainingHours * 4)));

        // SLA 动态加权公式: α * staticScore + β * timeUrgencyScore (α=0.6, β=0.4)
        const slaScore = Math.round(0.6 * staticScore + 0.4 * timeUrgencyScore);
        const isUrgentNotice = p.priorityLevel === 2 || slaScore >= 85 || remainingHours <= 2;

        const images = typeof p.imagesJson === "string" ? JSON.parse(p.imagesJson || "[]") : p.images || [];

        return {
          id: p.id,
          orderNo: p.orderNo,
          title: p.title,
          desc: p.desc,
          categoryId: p.categoryId,
          categoryName: `类别_${p.categoryId}`,
          campusId: p.campusId,
          campusName: `校区_${p.campusId}`,
          location: `${p.location1 || ""} ${p.location2 || ""}`.trim() || "校内现场",
          priorityLevel: p.priorityLevel || 1,
          status: p.status,
          statusText:
            p.status === 0
              ? "待处理"
              : p.status === 1
              ? "施工中"
              : p.status === 2
              ? "待复核"
              : p.status === 3
              ? "已办结"
              : "已结案",
          createdAt: p.createdAt || new Date().toISOString(),
          deadline: p.deadline || "",
          remainingHours,
          isUrgentNotice,
          slaScore,
          images,
          creatorName: "巡查师生"
        };
      });

      // 3. 按 SLA 加权分降序排序
      cardList.sort((a, b) => b.slaScore - a.slaScore);

      // 4. 分页截取
      const total = cardList.length;
      const startIndex = (page - 1) * pageSize;
      const pagedList = cardList.slice(startIndex, startIndex + pageSize);

      return returnSuccess({
        list: pagedList,
        total,
        page,
        pageSize
      });
    } catch (err: any) {
      return returnError(err.message || "获取工作台任务列表失败");
    }
  }
}
