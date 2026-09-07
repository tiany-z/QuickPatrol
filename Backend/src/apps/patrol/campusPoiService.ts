/**
 * M21: 校内建筑 POI 空间吸附中枢服务
 * (Campus POI Spatial Snapping Domain Service)
 * 
 * 核心技术实现：
 * 1. 局部等距切平面高精度欧氏投影测距算法 (Equirectangular Projection)
 * 2. 校区已知建筑物几何中心拓扑最近邻检索 (Nearest Neighbor Search)
 * 3. 35 米防抖磁吸临界阈值判定 (R_snap = 35.0m)
 * 4. 离线单元测试沙箱与生产环境直连 MySQL AST 双模适配
 */

import { executeASTSelect } from "../../shared/sql/index.js";
import { getMySQLPool } from "../../shared/db/mysql.js";
import { ICampusPoiEntity, IPoiSnapResultDto } from "./patrolTypes.js";

// 内存测试沙箱校内建筑物 POI 字典
const mockPoiMap = new Map<number, ICampusPoiEntity>();
let mockPoiIdCounter = 1;

export class CampusPoiService {
  public static readonly SNAP_THRESHOLD_METERS = 35.0; // 35 米吸附半径

  /**
   * 注册虚拟 POI 桩点 (用于离线单元测试)
   */
  public static mockRegisterPoi(
    poi: Partial<ICampusPoiEntity> & { schoolId: number; name: string; latitude: number; longitude: number }
  ): ICampusPoiEntity {
    const id = poi.id || mockPoiIdCounter++;
    const entity: ICampusPoiEntity = {
      id,
      schoolId: poi.schoolId,
      campusId: poi.campusId || 1,
      name: poi.name,
      latitude: poi.latitude,
      longitude: poi.longitude,
      categoryTags: poi.categoryTags || ["教学楼"],
      isDeleted: poi.isDeleted || 0
    };
    mockPoiMap.set(id, entity);
    return entity;
  }

  /**
   * 清空测试沙箱 POI 数据
   */
  public static clearMockPois(): void {
    mockPoiMap.clear();
    mockPoiIdCounter = 1;
  }

  /**
   * 获取测试沙箱 POI 字典
   */
  public static getMockPoisMap(): Map<number, ICampusPoiEntity> {
    return mockPoiMap;
  }

  /**
   * 根据当前图钉经纬度反查并吸附校区内最近的建筑物 (算法 1)
   */
  public static async snapNearestBuilding(
    schoolId: number,
    campusId: number,
    userLat: number,
    userLng: number
  ): Promise<IPoiSnapResultDto> {
    let poiList: ICampusPoiEntity[] = [];

    if (getMySQLPool()) {
      try {
        const selectSql = `
          SELECT id, schoolId, campusId, name, latitude, longitude
          FROM campuses_poi
          WHERE schoolId = ? AND campusId = ? AND isDeleted = 0
        `;
        const res = await executeASTSelect<ICampusPoiEntity>(selectSql, [schoolId, campusId]);
        if (Array.isArray(res)) {
          poiList = res;
        }
      } catch {
        // 生产 DB 容错降级
      }
    }

    // 若无 MySQL 数据，检查内存沙箱
    if (poiList.length === 0) {
      poiList = Array.from(mockPoiMap.values()).filter(
        (p) => p.schoolId === schoolId && p.campusId === campusId && (p.isDeleted || 0) === 0
      );
    }

    // 若校区内完全没有配置建筑物 POI，返回未吸附状态
    if (poiList.length === 0) {
      return {
        isSnapped: false,
        buildingName: "",
        snappedLat: userLat,
        snappedLng: userLng,
        distanceMeters: 9999.0
      };
    }

    let minDistance = Number.MAX_VALUE;
    let closestBuilding: ICampusPoiEntity | null = null;

    for (const b of poiList) {
      const dist = this.approximateDistanceMeters(userLat, userLng, b.latitude, b.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        closestBuilding = b;
      }
    }

    // 判定是否命中 35 米吸附阈值
    if (minDistance <= this.SNAP_THRESHOLD_METERS && closestBuilding) {
      return {
        isSnapped: true,
        buildingName: closestBuilding.name,
        snappedLat: closestBuilding.latitude,
        snappedLng: closestBuilding.longitude,
        distanceMeters: Number(minDistance.toFixed(1))
      };
    }

    return {
      isSnapped: false,
      buildingName: "",
      snappedLat: userLat,
      snappedLng: userLng,
      distanceMeters: Number(minDistance.toFixed(1))
    };
  }

  /**
   * 局部等距切平面高精度欧氏投影测距算法
   * (计算开销极低，在校区 3km 范围内几何误差 < 0.1%)
   */
  public static approximateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000.0;
    const toRad = Math.PI / 180.0;
    const meanLat = ((lat1 + lat2) / 2.0) * toRad;
    const deltaX = (lon2 - lon1) * toRad * R * Math.cos(meanLat);
    const deltaY = (lat2 - lat1) * toRad * R;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }
}
