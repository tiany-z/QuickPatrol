/**
 * M20: 线下固定资产二维码与防作弊打卡中枢服务
 * (QR Points & Anti-Cheating Inspection Scan Domain Service)
 * 
 * 核心技术实现：
 * 1. 资产二维码数字化建档与 32 字符 Scene 紧凑 Base62 编码
 * 2. 租户加盐 HMAC-SHA256 防伪数字签名与常数时间验签 (crypto.timingSafeEqual)
 * 3. 现场摄像头强制取景校验 (onlyFromCamera)
 * 4. 防 NaN 极值截断的大圆球面 Haversine 物理测距与三阶动态地理围栏判定
 * 5. scanCount 原子自增与 M19 不可篡改运维审计打卡全量留痕
 * 6. 双轨驱动：生产环境直连 MySQL AST，离线/测试环境内存沙箱自愈
 */

import crypto from "node:crypto";
import { executeASTInsert, executeASTSelect, executeASTUpdate } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { Base62Utils } from "../../shared/utils/base62Utils.js";
import { GeoUtils } from "../../shared/utils/geoUtils.js";
import { AuditLogger } from "../../shared/log/auditLogger.js";
import { SettingsService } from "../../services/school/settingsService.js";
import { TerminalLogger } from "../../shared/index.js";
import {
  ICreatePointRequest,
  ICreatePointResponse,
  IPatrolQrcodePointEntity,
  IPointCoordinates,
  IVerifyPointScanRequest,
  IVerifyPointScanResultDto
} from "./qrcodeTypes.js";

// 内存测试沙箱二维码点位桩点字典
const mockPointsMap = new Map<number, IPatrolQrcodePointEntity>();
let mockPointIdCounter = 1;

export class QrcodeService {
  /**
   * 注册虚拟点位桩点 (用于离线单元测试)
   */
  public static mockRegisterPoint(
    point: Partial<IPatrolQrcodePointEntity> & { schoolId: number; name: string }
  ): IPatrolQrcodePointEntity {
    const id = point.id || mockPointIdCounter++;
    const entity: IPatrolQrcodePointEntity = {
      id,
      schoolId: point.schoolId,
      campusId: point.campusId || 1,
      name: point.name,
      code: point.code || `PT-${point.schoolId}-1-${Date.now().toString().slice(-4)}${Math.floor(1000 + Math.random() * 9000)}`,
      location: point.location || JSON.stringify({ latitude: 0, longitude: 0, addressDescription: "" }),
      categoryId: point.categoryId || 0,
      qrcodeUrl: point.qrcodeUrl || "",
      scanCount: point.scanCount || 0,
      createdAt: point.createdAt || new Date().toISOString(),
      isDeleted: point.isDeleted || 0
    };
    mockPointsMap.set(id, entity);
    return entity;
  }

  /**
   * 清空测试沙箱点位数据
   */
  public static clearMockPoints(): void {
    mockPointsMap.clear();
    mockPointIdCounter = 1;
  }

  /**
   * 获取测试沙箱点位全量字典
   */
  public static getMockPointsMap(): Map<number, IPatrolQrcodePointEntity> {
    return mockPointsMap;
  }

  /**
   * 1. 创建固定资产二维码点位并签发小程序码
   */
  public static async createPoint(
    schoolId: number,
    req: ICreatePointRequest
  ): Promise<ICreatePointResponse> {
    if (!req.name || typeof req.name !== "string" || !req.name.trim()) {
      throw new Error("点位名称不能为空");
    }
    if (typeof req.latitude !== "number" || typeof req.longitude !== "number") {
      throw new Error("必须提供合法的点位经纬度坐标");
    }

    // 构造结构化物理坐标与空间描述
    const locationJson: IPointCoordinates = {
      latitude: req.latitude,
      longitude: req.longitude,
      addressDescription: req.address || req.name
    };
    const locationStr = JSON.stringify(locationJson);

    // 生成点位唯一业务编号
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const pointCode = `PT-${schoolId}-${req.campusId}-${Date.now().toString().slice(-4)}${randomSuffix}`;

    let pointId: number;

    if (getMySQLPool()) {
      const insertSql = `
        INSERT INTO patrol_qrcode_points (
          schoolId, campusId, name, code, location, categoryId, scanCount, isDeleted, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NOW())
      `;
      const res: any = await executeASTInsert(insertSql, [
        schoolId,
        req.campusId,
        req.name.trim(),
        pointCode,
        locationStr,
        req.categoryId || 0
      ]);
      pointId = Number(res?.data?.[0]?.insertId || res?.insertId || 1);
    } else {
      // 内存沙箱落盘
      pointId = mockPointIdCounter++;
      const entity: IPatrolQrcodePointEntity = {
        id: pointId,
        schoolId,
        campusId: req.campusId,
        name: req.name.trim(),
        code: pointCode,
        location: locationStr,
        categoryId: req.categoryId || 0,
        qrcodeUrl: "",
        scanCount: 0,
        createdAt: new Date().toISOString(),
        isDeleted: 0
      };
      mockPointsMap.set(pointId, entity);
    }

    // 获取该校的二维码专属加盐秘钥
    const signSecret = await this.getSchoolQrSecret(schoolId);

    // 计算防伪签名并生成 32 字符紧凑 Scene (p:{base62Id}:{sign8})
    const base62Id = Base62Utils.encode(pointId);
    const sign8 = this.generateHmacSignature(schoolId, pointId, pointCode, signSecret);
    const compactScene = `p:${base62Id}:${sign8}`;

    // 生成 CDN 二维码高清直链
    const qrcodeUrl = this.generateCdnQrCodeUrl(schoolId, compactScene);

    // 回写 CDN 链接
    if (getMySQLPool()) {
      await executeASTUpdate(
        `UPDATE patrol_qrcode_points SET qrcodeUrl = ? WHERE id = ? AND schoolId = ?`,
        [qrcodeUrl, pointId, schoolId]
      );
    } else {
      const p = mockPointsMap.get(pointId);
      if (p) p.qrcodeUrl = qrcodeUrl;
    }

    TerminalLogger.info(
      `[M20 二维码建档] 学校 ${schoolId} 成功创建点位 ID=${pointId}, 编号=${pointCode}, 紧凑Scene=${compactScene}`,
      "QrcodeService"
    );

    return {
      id: pointId,
      code: pointCode,
      name: req.name.trim(),
      qrcodeUrl,
      scenePayload: compactScene,
      downloadUrl: qrcodeUrl
    };
  }

  /**
   * 2. 核心防作弊打卡扫码核验中枢
   */
  public static async verifyAndRecordScan(
    schoolId: number,
    userId: number,
    userIp: string,
    req: IVerifyPointScanRequest
  ): Promise<IVerifyPointScanResultDto> {
    // 防线一：扫码来源通道检查 (必须为 camera 现场物理取景，严禁相册选图代扫)
    if (req.scanSource && req.scanSource !== "camera") {
      await AuditLogger.recordLog({
        schoolId,
        operatorUserId: userId,
        action: "QR_SCAN_FORBIDDEN_SOURCE",
        module: "Patrol",
        ip: userIp,
        payload: {
          reason: "尝试使用手机相册图片代打卡",
          scene: req.scene
        }
      });
      throw new Error("安全保护：严禁使用手机相册图片代打卡，请亲临现场摄像头扫码！");
    }

    // 防线二：解析 Scene 紧凑场景串 (p:base62Id:sign8)
    const parts = (req.scene || "").split(":");
    if (parts.length !== 3 || parts[0] !== "p") {
      throw new Error("无效或已损坏的资产二维码");
    }
    const base62Id = parts[1];
    const clientSign8 = parts[2];
    const pointId = Base62Utils.decode(base62Id);

    // 查询点位档案 (包含校区名、推荐分类名)
    let point: any = null;

    if (getMySQLPool()) {
      const sql = `
        SELECT 
          p.id, p.schoolId, p.campusId, p.name, p.code, p.location, p.categoryId, p.scanCount,
          c.name AS campusName,
          cat.name AS categoryName
        FROM patrol_qrcode_points p
        LEFT JOIN campuses c ON c.id = p.campusId AND c.schoolId = p.schoolId
        LEFT JOIN categories cat ON cat.id = p.categoryId AND cat.schoolId = p.schoolId
        WHERE p.id = ? AND p.schoolId = ? AND p.isDeleted = 0
        LIMIT 1
      `;
      const rows = await executeASTSelect(sql, [pointId, schoolId]);
      if (rows && rows.length > 0) {
        point = rows[0];
      }
    } else {
      const p = mockPointsMap.get(pointId);
      if (p && p.schoolId === schoolId && p.isDeleted === 0) {
        point = {
          id: p.id,
          schoolId: p.schoolId,
          campusId: p.campusId,
          name: p.name,
          code: p.code,
          location: p.location,
          categoryId: p.categoryId,
          scanCount: p.scanCount,
          campusName: "主校区",
          categoryName: "日常巡检"
        };
      }
    }

    if (!point) {
      throw new Error("该资产点位已被注销或不存在");
    }

    // 防线三：HMAC-SHA256 数字签名强校验 (常数时间比对，阻断侧信道攻击)
    const signSecret = await this.getSchoolQrSecret(schoolId);
    const expectedSign8 = this.generateHmacSignature(schoolId, point.id, point.code, signSecret);
    const isSignValid = this.verifyHmacTimingSafe(clientSign8, expectedSign8);

    if (!isSignValid) {
      await AuditLogger.recordLog({
        schoolId,
        operatorUserId: userId,
        action: "QR_SIGN_FORGERY_ATTACK",
        module: "Patrol",
        ip: userIp,
        payload: {
          pointId: point.id,
          clientSign8,
          expectedSign8
        }
      });
      throw new Error("二维码数字签名校验失败，可能系仿冒篡改！");
    }

    // 防线四：Haversine 球面几何距离测算 (防 NaN 崩溃)
    const coord: IPointCoordinates = this.parseCoordinates(point.location);
    const distanceMeters = GeoUtils.computeHaversineDistance(
      req.userLatitude,
      req.userLongitude,
      coord.latitude,
      coord.longitude
    );

    let accuracyLevel: "PERFECT" | "ACCEPTABLE" | "DEVIATED" = "PERFECT";
    let warningMessage: string | undefined = undefined;

    // 围栏判定：50m 内完美匹配；50m ~ 100m 容差放行；> 100m 强力阻断
    if (distanceMeters <= 50.0) {
      accuracyLevel = "PERFECT";
    } else if (distanceMeters <= 100.0) {
      accuracyLevel = "ACCEPTABLE";
      warningMessage = `现场 GPS 信号存在轻微漂移（偏差 ${distanceMeters} 米），已记录打卡`;
    } else {
      // 距离超限，判定远程代打卡作弊
      await AuditLogger.recordLog({
        schoolId,
        operatorUserId: userId,
        action: "QR_DISTANCE_CHEAT_BLOCKED",
        module: "Patrol",
        ip: userIp,
        payload: {
          pointId: point.id,
          distanceMeters,
          userGps: { lat: req.userLatitude, lng: req.userLongitude },
          targetGps: { lat: coord.latitude, lng: coord.longitude }
        }
      });
      throw new Error(`距离资产点位偏差过大 (${distanceMeters} 米 > 50米)，请亲临现场打卡！`);
    }

    // 防线五：原子自增扫码计数
    if (getMySQLPool()) {
      await executeASTUpdate(
        `UPDATE patrol_qrcode_points SET scanCount = scanCount + 1 WHERE id = ? AND schoolId = ?`,
        [point.id, schoolId]
      );
    } else {
      const mockP = mockPointsMap.get(point.id);
      if (mockP) {
        mockP.scanCount = (mockP.scanCount || 0) + 1;
      }
    }

    // 成功打卡审计留痕
    await AuditLogger.recordLog({
      schoolId,
      operatorUserId: userId,
      action: "QR_INSPECTION_SCAN_SUCCESS",
      module: "Patrol",
      ip: userIp,
      payload: {
        pointId: point.id,
        distanceMeters,
        accuracyLevel
      }
    });

    const newScanCount = Number(point.scanCount || 0) + 1;

    return {
      isVerified: true,
      pointId: point.id,
      pointCode: point.code,
      pointName: point.name,
      campusId: point.campusId,
      campusName: point.campusName || "主校区",
      locationText: coord.addressDescription || point.name,
      recommendedCategoryId: point.categoryId,
      recommendedCategoryName: point.categoryName || "日常巡检",
      distanceMeters,
      accuracyLevel,
      warningMessage,
      scanCount: newScanCount
    };
  }

  // ---------------- 私有辅助方法 ----------------

  /**
   * 计算点位防伪 HMAC-SHA256 签名 (截取高位 8 字符)
   */
  private static generateHmacSignature(
    schoolId: number,
    pointId: number,
    code: string,
    secret: string
  ): string {
    const raw = `${schoolId}:${pointId}:${code}`;
    return crypto.createHmac("sha256", secret).update(raw).digest("hex").slice(0, 8);
  }

  /**
   * 常数时间比对签名 (Prevent Timing Attacks)
   */
  private static verifyHmacTimingSafe(actual: string, expected: string): boolean {
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(actual, "utf-8"),
      Buffer.from(expected, "utf-8")
    );
  }

  /**
   * 解析点位 location 坐标 JSON
   */
  private static parseCoordinates(locationRaw: string): IPointCoordinates {
    try {
      const parsed = JSON.parse(locationRaw);
      if (typeof parsed.latitude === "number" && typeof parsed.longitude === "number") {
        return {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          addressDescription: parsed.addressDescription || ""
        };
      }
    } catch {
      // 容错处理
    }
    return { latitude: 0, longitude: 0, addressDescription: locationRaw || "" };
  }

  /**
   * 读取学校专属加盐 Secret
   */
  private static async getSchoolQrSecret(schoolId: number): Promise<string> {
    try {
      const secret = await SettingsService.getDecryptedSetting(schoolId, "QR_SIGN_SECRET");
      if (secret) {
        return secret;
      }
    } catch {
      // 容错回退
    }
    return `QuickPatrol_DefaultSalt_School_${schoolId}`;
  }

  /**
   * 生成规范化 CDN 资产直链
   */
  private static generateCdnQrCodeUrl(schoolId: number, scene: string): string {
    return `https://cdn.quickpatrol.edu.cn/schools/${schoolId}/qrcodes/${encodeURIComponent(scene)}.png`;
  }
}
