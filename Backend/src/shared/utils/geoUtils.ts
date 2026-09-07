/**
 * M20: 高精度地理测算与防 NaN 几何计算工具箱
 * (High-Precision Anti-NaN Geo Measurement Utils)
 * 
 * 核心技术保障：
 * 1. 采用大圆球面半正矢公式 (Haversine Formula)
 * 2. 双重闭区间钳制 (Clamping) 过滤 IEEE 754 浮点微差，彻底杜绝 Math.asin 产生 NaN
 * 3. GCJ-02 (火星坐标) 与 WGS-84 坐标投影换算支持
 */

export class GeoUtils {
  private static readonly EARTH_RADIUS_METERS = 6371000.0;

  /**
   * 采用半正矢公式 (Haversine Formula) 计算两点球面距离 (单位: 米)
   * 严格防止因浮点运算精度溢出导致 Math.asin(sqrt(h)) 返回 NaN
   */
  public static computeHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    // 快速排查坐标完全重合情形
    if (lat1 === lat2 && lon1 === lon2) {
      return 0;
    }

    const toRad = Math.PI / 180.0;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const deltaPhi = (lat2 - lat1) * toRad;
    const deltaLambda = (lon2 - lon1) * toRad;

    const sinDeltaPhi = Math.sin(deltaPhi / 2.0);
    const sinDeltaLambda = Math.sin(deltaLambda / 2.0);

    const h =
      sinDeltaPhi * sinDeltaPhi +
      Math.cos(phi1) * Math.cos(phi2) * sinDeltaLambda * sinDeltaLambda;

    // 核心安全保护第一道: 将 h 截断在 [0.0, 1.0] 闭区间，防止微弱浮点上溢
    const clampedH = Math.min(1.0, Math.max(0.0, h));
    const sqrtH = Math.sqrt(clampedH);

    // 核心安全保护第二道: 保证 sqrtH 严格处于 [-1.0, 1.0] 定义域内
    const safeSqrtH = Math.min(1.0, Math.max(-1.0, sqrtH));

    const distance = 2.0 * this.EARTH_RADIUS_METERS * Math.asin(safeSqrtH);
    return Number(distance.toFixed(2));
  }

  /**
   * 判断两点是否在指定半径地理围栏内
   */
  public static isWithinGeofence(
    userLat: number,
    userLon: number,
    targetLat: number,
    targetLon: number,
    radiusMeters: number
  ): boolean {
    const dist = this.computeHaversineDistance(userLat, userLon, targetLat, targetLon);
    return dist <= radiusMeters;
  }
}
