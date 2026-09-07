/**
 * M22: 小程序端防篡改硬件级水印相机与 OSS 直传数据模型
 */

export interface IWatermarkStampContext {
  realName: string;                       // 操作人员姓名 (如: "张建国")
  userId: number;                         // 操作人员用户ID
  campusName: string;                     // 校区名称 (如: "西校区")
  locationDescription: string;            // 建筑空间描述 (如: "11号楼·高压配电房")
  latitude: number;                       // GCJ-02 真实纬度
  longitude: number;                      // GCJ-02 真实经度
  gpsAccuracy: number;                    // 定位精度 (米)
  timestamp: number;                      // 拍照绝对物理毫秒时间戳
  orderNo?: string;                       // 关联工单单号 (如: "LCU-20260905-0008")
  sceneTitle: string;                     // 场景标题 (如: "隐患报修现场存证" / "整改完工复核凭证")
}

export interface IStsTokenResponseDto {
  provider: 'aliyun_oss' | 'tencent_cos';
  uploadHost: string;                     // 客户端直连 Host
  accessKeyId: string;                    // 临时 AccessKeyId
  policyBase64: string;                   // 经过 Base64 编码的权限策略
  signature: string;                      // 服务端派发的签名
  securityToken?: string;                 // STS SecurityToken
  dirPrefix: string;                      // 强制要求的存储前缀路径 (schools/101/patrol/202609/)
  expiration: string;                     // 凭证过期绝对时间 (ISO8601)
  expiresInSeconds: number;               // 剩余有效秒数
  cdnDomain: string;                      // CDN 域名
}

export interface ICameraPageData {
  isShooting: boolean;
  cameraPosition: 'back' | 'front';
  flashMode: 'off' | 'on' | 'auto';
  statusText: string;
  campusName: string;
  locationDescription: string;
  scene: string;
  orderNo: string;
  hasLocationPermission: boolean;
}
