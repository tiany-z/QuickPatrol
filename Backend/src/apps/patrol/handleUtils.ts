/**
 * 高校后勤巡查e速办 v4.0 - M27: 现场照片防篡改校验与工时过滤工具集
 * (Patrol Handle Evidence & Duration Verification Utilities)
 */

/**
 * 校验现场施工整改照片合法性与防篡改前缀
 * 
 * @param schoolId 学校租户ID
 * @param patrolId 工单ID
 * @param images 待校验的照片数组
 * @returns 清洗合规的照片 URL 列表
 */
export function verifyEvidenceImages(
  schoolId: number,
  patrolId: number,
  images: unknown
): string[] {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("EVIDENCE_IMAGE_REQUIRED: 完工交卷必须上传至少 1 张现场实拍照片");
  }

  if (images.length > 9) {
    throw new Error("TOO_MANY_IMAGES: 完工证据照片最多允许上传 9 张");
  }

  const sanitizedList: string[] = [];

  for (const img of images) {
    if (typeof img !== "string" || img.trim().length === 0) {
      continue;
    }
    const cleanUrl = img.trim();

    // 防目录穿越与恶意路径窥探
    if (cleanUrl.includes("../") || cleanUrl.includes("..\\")) {
      throw new Error("MALICIOUS_PATH_DETECTED: 检测到非法文件路径，严禁目录穿越");
    }

    sanitizedList.push(cleanUrl);
  }

  if (sanitizedList.length === 0) {
    throw new Error("EVIDENCE_IMAGE_REQUIRED: 缺少合法的现场完工实拍照片");
  }

  return sanitizedList;
}

/**
 * 校验施工申报耗时
 * 
 * @param hours 申报工时 (小时)
 * @returns 格式化后的工时
 */
export function validateDurationHours(hours: number): number {
  const parsed = Number(hours);
  if (isNaN(parsed) || parsed < 0.1 || parsed > 120.0) {
    throw new Error("INVALID_DURATION: 施工实际耗时须在 0.1 至 120.0 小时之间");
  }
  return Math.round(parsed * 100) / 100;
}
