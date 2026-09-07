/**
 * M22: 防篡改硬件级水印相机与 OSS 租户直传核心类型定义
 * (OSS Direct Upload & Watermark Camera Types)
 */

/**
 * 租户云存储配置实体契约 (解密后的运行时配置)
 */
export interface ITenantStorageConfig {
  provider: 'aliyun_oss' | 'tencent_cos'; // 云存储厂商
  region: string;                          // 地域 (如: oss-cn-beijing / ap-beijing)
  bucket: string;                          // Bucket 存储桶名称
  accessKeyId: string;                     // 存储访问密钥 ID
  accessKeySecret: string;                 // 存储访问密钥 Secret
  roleArn?: string;                        // STS RAM 角色 ARN (可选)
  customCdnDomain?: string;                // 自定义加速域名 (如: https://cdn.quickpatrol.edu.cn)
}

/**
 * 获取 STS 临时凭证请求参数
 */
export interface IStsTokenRequest {
  scene: 'patrol' | 'handle' | 'review';  // 上传业务场景: patrol=报修, handle=施工, review=质检
}

/**
 * 下发给客户端的 STS 临时直传凭证 DTO
 */
export interface IStsTokenResponseDto {
  provider: 'aliyun_oss' | 'tencent_cos';
  uploadHost: string;                     // 客户端直连 Host
  accessKeyId: string;                    // 临时 AccessKeyId / 派发 KeyId
  policyBase64: string;                   // 经过 Base64 编码的权限策略
  signature: string;                      // 服务端派发的 HMAC-SHA1 签名
  securityToken?: string;                 // STS SecurityToken (腾讯云/阿里云临时凭证)
  dirPrefix: string;                      // 强制要求的租户沙箱路径前缀 (schools/101/patrol/202609/)
  expiration: string;                     // 凭证过期绝对时间 (ISO8601)
  expiresInSeconds: number;               // 剩余有效秒数 (固定 900 秒)
  cdnDomain: string;                      // 上传成功后拼接访问链接的 CDN 域名
}

/**
 * 水印压制渲染上下文定义
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

/**
 * 直传成功返回结果 DTO
 */
export interface IUploadResultDto {
  fileUrl: string;                        // CDN 永久访问地址
  storagePath: string;                    // 云存储内部相对路径
  fileSize: number;                       // 压缩后实际上传文件字节数
  width: number;                          // 图片最终宽度
  height: number;                         // 图片最终高度
  fingerprint: string;                    // 防伪数字指纹 (如: FP-9A1B-3C4D)
}

/**
 * 嵌入工单主表或证据快照的元数据
 */
export interface IPhotoEvidenceMetadata {
  url: string;
  fingerprint: string;
  capturedAt: string;
  operatorId: number;
  latitude: number;
  longitude: number;
  location: string;
}
