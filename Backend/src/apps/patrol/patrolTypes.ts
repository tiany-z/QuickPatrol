/**
 * M21: 隐患巡查上报与校内建筑 POI 吸附强类型数据契约
 * (Patrol Work Order Entity & Request/Response DTO Types)
 */

/**
 * 巡查工单核心主表实体 (对应数据库表: patrols)
 */
export interface IPatrolEntity {
  id: number;                     // 工单主键自增 ID (patrolId)
  schoolId: number;               // 所属学校 ID (租户隔离键)
  campusId: number;               // 发生校区 ID (关联 campuses.id)
  categoryId: number;             // 故障分类 ID (关联 categories.id)
  orderNo: string;                // 业务单号 (唯一索引: uk_school_orderno, 如: LCU-20260905-0001)
  creatorId: number;              // 提报人用户 ID (关联 users.id)
  title: string;                  // 问题简要标题 (如: "科技楼3楼开水间渗水")
  desc: string;                   // 故障详细文字描述
  imagesJson: string;             // 现场勘验照片 URL 列表 (JSON Array 序列化字符串, 1~9张)
  location1: string;              // 一级区域地点 (如: "科技楼")
  location2: string;              // 二级精准点位 (如: "3楼开水间")
  latitude: number | null;        // 提报 GPS 纬度 (GCJ-02)
  longitude: number | null;       // 提报 GPS 经度 (GCJ-02)
  status: 0 | 1 | 2 | 3 | 4 | 5;  // 状态: 0待处理, 1处理中, 2已整改待复核, 3已办结, 4已评价结案, 5复核驳回
  currentHandlerId: number;       // 当前责任施工人 ID (初始为 0)
  currentReviewerId: number;      // 当前验收复核人 ID (初始为 0)
  deadline: string | null;        // 处理截止时限 (YYYY-MM-DD HH:mm:ss)
  priorityLevel: 0 | 1 | 2;       // 优先级: 0普通, 1中等, 2加急(特急)
  isPublic: 0 | 1;                // 是否公开至校园广场: 1公开, 0仅内部可见
  completedAt: string | null;     // 最终验收结案时间
  createdAt: string;              // 提报时间
  updatedAt: string;              // 更新时间
  isDeleted: 0 | 1;               // 软删除标记: 0正常, 1已删除
}

/**
 * 隐患提报请求入参契约
 */
export interface ICreatePatrolRequest {
  campusId: number;               // 校区 ID (必填)
  categoryId: number;             // 分类 ID (必填)
  title: string;                  // 故障标题 (必填, 2~64字)
  desc: string;                   // 详细描述 (必填, 5~500字)
  images: string[];               // 现场勘验图片列表 (必填, 至少 1 张, 最多 9 张)
  location1: string;              // 一级区域/楼栋 (必填)
  location2: string;              // 二级详细房间号/具体位置 (必填)
  latitude?: number | null;       // 选点或当前 GPS 纬度
  longitude?: number | null;      // 选点或当前 GPS 经度
  priorityLevel?: 0 | 1 | 2;      // 紧急程度 (默认为 1: 中等)
  isPublic?: 0 | 1;               // 是否公开至广场 (默认为 1: 公开)
  clientToken: string;            // 防重复点击与幂等 Token (必填)
  pointId?: number;               // 可选：来源若为 M20 线下二维码打卡，携带实体点位 ID
}

/**
 * 隐患提报成功响应 DTO
 */
export interface ICreatePatrolResponseDto {
  patrolId: number;               // 生成的工单主键自增 ID
  orderNo: string;                // 生成的业务工单编号 (如: LCU-20260905-0008)
  status: 0;                      // 初始状态恒为 0 (待处理)
  statusText: string;             // "待处理 / 待派单"
  deadline: string;               // 计算核准的 SLA 截止时限
  createdAt: string;              // 创建时间戳
}

/**
 * 校内建筑物 POI 实体 (对应数据库表: campuses_poi)
 */
export interface ICampusPoiEntity {
  id: number;
  schoolId: number;
  campusId: number;
  name: string;                   // 建筑名称 (如: "逸夫图书信息大楼", "弘毅楼B座")
  latitude: number;               // 中心基准纬度 (GCJ-02)
  longitude: number;              // 中心基准经度 (GCJ-02)
  categoryTags?: string[];        // 属性标签: ["教学楼", "实验楼", "宿舍"]
  isDeleted?: number;
}

/**
 * POI 空间吸附判定输出契约
 */
export interface IPoiSnapResultDto {
  isSnapped: boolean;             // 是否成功吸附到具体建筑物 (<= 35m)
  buildingName: string;           // 吸附得到的建筑名称 (若未吸附返回空串)
  snappedLat: number;             // 吸附后的纬度 (吸附成功为建筑中心，未吸附为原始纬度)
  snappedLng: number;             // 吸附后的经度 (吸附成功为建筑中心，未吸附为原始经度)
  distanceMeters: number;         // 距离最近建筑物的物理偏差 (米)
}

/**
 * 小程序本地 Storage 草稿箱存储数据契约
 */
export interface IPatrolDraftPayload {
  schoolId: number;
  userId: number;
  updatedTimestamp: number;       // 最后草稿更新毫秒时间戳
  data: {
    campusId: number;
    categoryId: number;
    title: string;
    desc: string;
    images: string[];
    location1: string;
    location2: string;
    latitude: number | null;
    longitude: number | null;
    priorityLevel: 0 | 1 | 2;
    isPublic: 0 | 1;
    pointId?: number;
  };
}

/**
 * 分类基础信息实体
 */
export interface ICategoryEntity {
  id: number;
  schoolId: number;
  name: string;
  icon?: string;
  defaultDays: number;
  sortOrder?: number;
  isDeleted?: number;
}
