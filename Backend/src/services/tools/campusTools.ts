/**
 * 高校后勤巡查e速办 v4.0 - M48: 7 大受控后勤事实数据工具箱
 * 文件路径: src/services/tools/campusTools.ts
 * 核心职责: 提供校区科室架构、校园广场官方公告、以及后勤服务规范规章字典等
 *           3 大权威事实数据工具的具体实现。
 */

import { executeQuery } from "../../shared/db/mysql.js";
import {
  IToolExecutionContext,
  IQueryCampusDeptArgs,
  IDepartmentFactItem,
  IQueryPostFeedsArgs,
  IPostFeedFactItem,
  IQueryServiceRegulationsArgs,
  IRegulationRuleItem
} from "../../contracts/aiToolContract.js";

export class CampusTools {
  public static mockDepartments: any[] = [];
  public static mockPostFeeds: any[] = [];

  public static resetMock(): void {
    CampusTools.mockDepartments = [];
    CampusTools.mockPostFeeds = [];
  }

  /**
   * 5. query_campus_and_departments: 校区科室架构与值班电话查询
   */
  public async queryCampusAndDepartments(
    args: IQueryCampusDeptArgs,
    context: IToolExecutionContext
  ): Promise<IDepartmentFactItem[]> {
    const { schoolId } = context;
    const conditions: string[] = ["d.schoolId = ?"];
    const params: any[] = [schoolId];

    if (args.campusKeyword && args.campusKeyword.trim() !== "") {
      conditions.push("c.name LIKE ?");
      params.push(`%${args.campusKeyword.trim()}%`);
    }

    if (args.serviceCategory && args.serviceCategory.trim() !== "") {
      conditions.push("(d.name LIKE ? OR d.description LIKE ?)");
      const cat = `%${args.serviceCategory.trim()}%`;
      params.push(cat, cat);
    }

    const sql = `
      SELECT 
        d.name AS deptName, c.name AS campusName, d.officeLocation,
        d.contactPhone AS hotlinePhone, d.leaderName AS dutyLeader, d.description AS serviceScope
      FROM departments d
      LEFT JOIN campuses c ON d.campusId = c.id
      WHERE ${conditions.join(" AND ")}
      LIMIT 4
    `;

    try {
      const res = await executeQuery(sql, params);
      if (res.status === 1 && res.data && res.data.length > 0) {
        return res.data.map((r: any) => ({
          deptName: r.deptName,
          campusName: r.campusName || "全校通用",
          officeLocation: r.officeLocation || "后勤综合服务楼",
          hotlinePhone: r.hotlinePhone || "0535-6677889",
          dutyLeader: r.dutyLeader || "值班长",
          serviceScope: r.serviceScope || "后勤常规维保保障"
        }));
      }
    } catch {
      // 容错降级
    }

    // 内存沙箱匹配
    let list = CampusTools.mockDepartments.filter((d) => d.schoolId === schoolId);
    if (args.campusKeyword && args.campusKeyword.trim() !== "") {
      const kw = args.campusKeyword.trim().toLowerCase();
      list = list.filter((d) => (d.campusName || "").toLowerCase().includes(kw));
    }
    if (args.serviceCategory && args.serviceCategory.trim() !== "") {
      const cat = args.serviceCategory.trim().toLowerCase();
      list = list.filter(
        (d) =>
          (d.deptName || "").toLowerCase().includes(cat) ||
          (d.serviceScope || "").toLowerCase().includes(cat)
      );
    }

    if (list.length > 0) {
      return list.slice(0, 4);
    }

    // 官方兜底保底科室
    return [
      {
        deptName: "后勤综合维修调度中心",
        campusName: "主校区",
        officeLocation: "后勤办公楼 102 调度室",
        hotlinePhone: "0535-6677889 (24小时报修急修热线)",
        dutyLeader: "总值班长",
        serviceScope: "统筹全校水暖、强弱电、门窗五金、公共设施维修"
      }
    ];
  }

  /**
   * 6. query_post_feeds: 校园公共广场最新维修通告与官方检修预警
   */
  public async queryPostFeeds(
    args: IQueryPostFeedsArgs,
    context: IToolExecutionContext
  ): Promise<IPostFeedFactItem[]> {
    const { schoolId } = context;
    const conditions: string[] = ["schoolId = ?", "isOfficialNotice = 1", "auditStatus = 1"];
    const params: any[] = [schoolId];

    if (args.keyword && args.keyword.trim() !== "") {
      conditions.push("(title LIKE ? OR content LIKE ?)");
      const kw = `%${args.keyword.trim()}%`;
      params.push(kw, kw);
    }

    const sql = `
      SELECT id, title, content, publisherDeptName, createdAt, affectedBuildings
      FROM post_feeds
      WHERE ${conditions.join(" AND ")}
      ORDER BY createdAt DESC
      LIMIT 3
    `;

    try {
      const res = await executeQuery(sql, params);
      if (res.status === 1 && res.data && res.data.length > 0) {
        return res.data.map((r: any) => ({
          id: r.id,
          title: r.title,
          contentSnippet: (r.content || "").substring(0, 150),
          publisherDept: r.publisherDeptName || "后勤管理处官方发布",
          publishTime: r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : "今日",
          affectedBuildings: r.affectedBuildings || "相关受影响楼宇"
        }));
      }
    } catch {
      // 容错降级
    }

    let list = CampusTools.mockPostFeeds.filter(
      (p) => p.schoolId === schoolId && p.isOfficialNotice !== false
    );
    if (args.keyword && args.keyword.trim() !== "") {
      const kw = args.keyword.trim().toLowerCase();
      list = list.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(kw) ||
          (p.content || "").toLowerCase().includes(kw)
      );
    }

    return list.slice(0, 3).map((r: any) => ({
      id: r.id,
      title: r.title,
      contentSnippet: (r.content || "").substring(0, 150),
      publisherDept: r.publisherDeptName || "后勤管理处官方发布",
      publishTime: r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : "今日",
      affectedBuildings: r.affectedBuildings || "相关受影响楼宇"
    }));
  }

  /**
   * 7. query_service_regulations: 后勤服务规范与时效承诺标准字典
   */
  public async queryServiceRegulations(
    args: IQueryServiceRegulationsArgs,
    _context: IToolExecutionContext
  ): Promise<IRegulationRuleItem[]> {
    // 官方规范常驻事实字典
    const rules: IRegulationRuleItem[] = [
      {
        ruleCode: "SLA_EMERGENCY_01",
        ruleTitle: "特级突发险情响应承诺",
        commitmentTimeText: "接单后 15 分钟内师傅务必抵达现场",
        chargePolicy: "涉及全校公共安全一律免费紧急抢修",
        officialClause:
          "对于高压电箱跳闸冒烟、主干自来水管爆裂、电梯困人等特级险情，系统触发强电话穿透，施工师傅必须 15 分钟内到场施救。"
      },
      {
        ruleCode: "SLA_URGENT_02",
        ruleTitle: "常规加急报修处置时限",
        commitmentTimeText: "2 小时内接单到场核验",
        chargePolicy: "教学办公及宿舍公共设施自然损耗全免费",
        officialClause:
          "宿舍卫生间水阀漏水、教室照明大面积熄灭等，科室责任人需在 2 小时内响应并安排师傅入场维修。"
      },
      {
        ruleCode: "POLICY_FREE_VS_PAID_03",
        ruleTitle: "自费与公费免费维修界定标准",
        commitmentTimeText: "按日常工单流转",
        chargePolicy: "自然老化损耗免费；人为故意损坏自负配件工本费",
        officialClause:
          "凡属房屋建筑主体、原有线路管网由于年限自然损坏的老化故障，材料与工时全额公费免收；因学生违规使用大功率电器烧毁的配件，按出厂成本价收取器件费。"
      }
    ];

    if (args.category === "SLA_LIMITS") {
      return rules.filter((r) => r.ruleCode.startsWith("SLA_"));
    }
    if (args.category === "FREE_OR_CHARGE") {
      return rules.filter((r) => r.ruleCode.includes("FREE_VS_PAID"));
    }

    if (args.query && args.query.trim() !== "") {
      const q = args.query.trim().toLowerCase();
      const matched = rules.filter(
        (r) =>
          r.ruleTitle.toLowerCase().includes(q) ||
          r.officialClause.toLowerCase().includes(q) ||
          r.chargePolicy.toLowerCase().includes(q)
      );
      if (matched.length > 0) return matched;
    }

    return rules;
  }
}

export const campusTools = new CampusTools();
