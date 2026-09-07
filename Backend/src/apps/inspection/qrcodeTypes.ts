/**
 * M20: 线下固定资产二维码与防作弊打卡强类型数据模型
 * (QR Points & Anti-Cheating Inspection Scan Type Contracts)
 */

/**
 * 线下巡检固定资产二维码点位实体契约 (对应表: patrol_qrcode_points)
 */
export interface IPatrolQrcodePointEntity {
  id: number;                     // 点位自增ID (主键)
  schoolId: number;               // 所属学校ID (租户隔离键)
  campusId: number;               // 所属校区ID (逻辑外键 -> campuses.id)
  name: string;                   // 点位名称 (如: 西校区1号高压配电房)
  code: string;                   // 点位唯一业务编码 (uk_school_code: schoolId, code)
  location: string;               // 详细物理空间描述 (支持结构化 JSON: {"addressDescription":"..","latitude":..,"longitude":..})
  categoryId: number;             // 默认推荐报修门类ID (逻辑外键 -> categories.id)
  qrcodeUrl: string;              // 微信小程序码 CDN 直链
  scanCount: number;              // 累计巡查打卡有效扫码次数
  createdAt: string;              // 点位布设建档时间
  isDeleted: 0 | 1;               // 软删除标记: 0正常, 1已归档删除
}

/**
 * 点位物理坐标解析结构
 */
export interface IPointCoordinates {
  latitude: number;               // GCJ-02 纬度
  longitude: number;              // GCJ-02 经度
  addressDescription: string;     // 纯文字物理空间描述
}

/**
 * 管理员创建点位请求体
 */
export interface ICreatePointRequest {
  campusId: number;               // 校区ID
  name: string;                   // 点位名称
  address: string;                // 空间描述 (如: 科技实验楼负一层B02)
  latitude: number;               // GCJ-02 纬度 (36.123456)
  longitude: number;              // GCJ-02 经度 (115.123456)
  categoryId?: number;            // 推荐分类ID (默认为 0)
}

/**
 * 点位创建成功响应
 */
export interface ICreatePointResponse {
  id: number;
  code: string;
  name: string;
  qrcodeUrl: string;
  scenePayload: string;
  downloadUrl: string;
}

/**
 * 批量导出与标签打印请求传输对象
 */
export interface IBatchExportQrRequest {
  campusId?: number;              // 可选校区过滤
  keyword?: string;               // 关键词搜索
  pointIds?: number[];            // 指定点位ID集合
}

/**
 * 二维码标签卡片导出打印 DTO
 */
export interface IQrPrintCardDto {
  pointId: number;
  pointCode: string;
  pointName: string;
  campusName: string;
  categoryName: string;
  qrcodeUrl: string;
  address: string;
}

/**
 * 移动端扫码防作弊打卡核验请求体
 */
export interface IVerifyPointScanRequest {
  scene: string;                  // 微信扫码提取的紧凑场景串 (如 p:1A:9b2c3d4e)
  userLatitude: number;           // 移动端当前获取的 GCJ-02 纬度
  userLongitude: number;          // 移动端当前获取的 GCJ-02 经度
  accuracy: number;               // 移动端硬件定位精度 (米)
  scanSource?: "camera" | "album";// 扫码来源通道 (安全规范要求必须为 camera)
}

/**
 * 扫码打卡核验响应结果 DTO
 */
export interface IVerifyPointScanResultDto {
  isVerified: boolean;            // 是否成功通过防伪与空间围栏核验
  pointId: number;                // 点位ID
  pointCode: string;              // 点位编码
  pointName: string;              // 点位名称 (西校区1号配电房)
  campusId: number;               // 校区ID
  campusName: string;             // 校区名称
  locationText: string;           // 物理精准位置
  recommendedCategoryId: number;  // 推荐报修门类ID
  recommendedCategoryName: string;// 推荐分类名称
  distanceMeters: number;         // 测算的物理距离偏差 (米)
  accuracyLevel: "PERFECT" | "ACCEPTABLE" | "DEVIATED"; // 距离精度评级
  warningMessage?: string;        // 弱信号警告提示
  scanCount: number;              // 递增后的累计扫码次数
}
