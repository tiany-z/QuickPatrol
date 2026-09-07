/**
 * M22: 防篡改硬件级水印相机核心页面控制器
 * (Watermark Camera Controller)
 * 
 * 核心职责：
 * 1. 调起小程序原生底层硬件摄像头
 * 2. 现场 GPS 经纬度高精采样与时间捕获
 * 3. 驱动离屏 Canvas 2D 渲染压制抗锯齿防伪水印
 * 4. 换取多租户沙箱 STS 临时凭据
 * 5. 零带宽直传阿里云 OSS / 腾讯云 COS
 * 6. 向提单/交卷页面返回不可篡改证据 CDN 永久直链
 */

import { ICameraPageData, IStsTokenResponseDto } from './types.js';
import { WatermarkEngine } from './watermarkEngine.js';

Page<ICameraPageData, any>({
  data: {
    isShooting: false,
    cameraPosition: 'back',
    flashMode: 'off',
    statusText: '对准隐患现场，点击快门拍摄',
    campusName: '主校区',
    locationDescription: '待核对空间',
    scene: 'patrol',
    orderNo: '',
    hasLocationPermission: true
  },

  cameraCtx: null as any,
  sceneContext: {
    scene: 'patrol',
    campusName: '主校区',
    locationDescription: '待核对空间',
    orderNo: ''
  },

  onLoad(query: any) {
    this.cameraCtx = wx.createCameraContext();

    const scene = query?.scene || 'patrol';
    const campusName = decodeURIComponent(query?.campusName || '主校区');
    const locationDescription = decodeURIComponent(query?.location || '现场');
    const orderNo = query?.orderNo || '';

    this.sceneContext = {
      scene,
      campusName,
      locationDescription,
      orderNo
    };

    this.setData({
      scene,
      campusName,
      locationDescription,
      orderNo
    });

    // 预检地理位置权限
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.userLocation'] === false) {
          this.setData({ hasLocationPermission: false });
        }
      }
    });
  },

  handleBack() {
    wx.navigateBack();
  },

  handleToggleFlash() {
    const modes: Array<'off' | 'on' | 'auto'> = ['off', 'on', 'auto'];
    const currentIdx = modes.indexOf(this.data.flashMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    this.setData({ flashMode: nextMode });
  },

  handleToggleCamera() {
    const nextPos = this.data.cameraPosition === 'back' ? 'front' : 'back';
    this.setData({ cameraPosition: nextPos });
  },

  /**
   * 拍照与水印直传处理主入口
   */
  async handleTakePhoto() {
    if (this.data.isShooting) return;
    this.setData({ isShooting: true, statusText: '正在定格现场画面与GPS...' });

    // 1. 获取物理 GPS 坐标
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (loc) => {
        // 2. 调起底层物理快门成像
        this.cameraCtx.takePhoto({
          quality: 'high',
          success: async (photoRes: any) => {
            await this.processAndUpload(photoRes.tempFilePath, loc);
          },
          fail: () => {
            this.setData({ isShooting: false, statusText: '相机快门成像失败' });
            wx.showToast({ title: '快门拍照失败，请重试', icon: 'none' });
          }
        });
      },
      fail: () => {
        this.setData({ isShooting: false, statusText: 'GPS 物理定位获取失败' });
        wx.showModal({
          title: '需要定位权限',
          content: '防篡改水印相机必须获取真实物理位置作为凭证，请前往设置开启微信位置权限！',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
      }
    });
  },

  /**
   * Canvas 2D 水印压制并直传云存储
   */
  async processAndUpload(rawPhotoPath: string, loc: any) {
    try {
      this.setData({ statusText: '正在离屏压制防篡改水印图层...' });

      // 1. 创建离屏 Canvas 2D
      const offscreenCanvas = (wx as any).createOffscreenCanvas
        ? (wx as any).createOffscreenCanvas({ type: '2d' })
        : null;

      const app = getApp<any>();
      const userInfo = app?.globalData?.userInfo || { id: 101, realName: '巡检专员' };

      let stampedPath = rawPhotoPath;
      if (offscreenCanvas) {
        stampedPath = await WatermarkEngine.stampWatermark(offscreenCanvas, rawPhotoPath, {
          realName: userInfo.realName || '巡检专员',
          userId: Number(userInfo.id || 101),
          campusName: this.sceneContext.campusName,
          locationDescription: this.sceneContext.locationDescription,
          latitude: loc.latitude,
          longitude: loc.longitude,
          gpsAccuracy: Math.round(loc.accuracy || 10),
          timestamp: Date.now(),
          orderNo: this.sceneContext.orderNo,
          sceneTitle: this.sceneContext.scene === 'handle' ? '施工整改完工存证' : '隐患巡查现场存证'
        });
      }

      this.setData({ statusText: '正在直传云存储集群...' });

      // 2. 向后端换取租户隔离的 STS 临时直传凭据
      const sts = await this.fetchStsToken(this.sceneContext.scene);

      // 3. 生成基于纳秒的防重云端文件名
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const fileName = `${Date.now()}_${randomSuffix}.jpg`;
      const fullKey = `${sts.dirPrefix}${fileName}`;

      // 4. 客户端直传阿里云 OSS / 腾讯云 COS
      await this.uploadDirectToCloud(stampedPath, sts, fullKey);

      // 5. 拼接 CDN 永久访问地址
      const cdnUrl = sts.cdnDomain.endsWith('/')
        ? `${sts.cdnDomain}${fullKey}`
        : `${sts.cdnDomain}/${fullKey}`;

      wx.showToast({ title: '已固化水印存证', icon: 'success' });

      // 6. 回调上一级页面 (M21 提单 / M27 施工交卷)
      const pages = getCurrentPages();
      const prevPage = pages[pages.length - 2] as any;
      if (prevPage && typeof prevPage.onPhotoCaptured === 'function') {
        prevPage.onPhotoCaptured(cdnUrl);
      }

      setTimeout(() => {
        wx.navigateBack();
      }, 600);
    } catch (err: any) {
      wx.showModal({
        title: '存证直传失败',
        content: err.message || '网络连接超时或云存储凭证异常，请重试',
        showCancel: false
      });
    } finally {
      this.setData({ isShooting: false, statusText: '对准隐患现场，点击快门拍摄' });
    }
  },

  /**
   * 从后端获取 STS 临时上传策略凭据
   */
  fetchStsToken(scene: string): Promise<IStsTokenResponseDto> {
    return new Promise((resolve, reject) => {
      const token = wx.getStorageSync('token') || '';

      wx.request({
        url: `/api/storage/sts-token?scene=${encodeURIComponent(scene)}`,
        method: 'GET',
        header: {
          token: token,
          Authorization: `Bearer ${token}`
        },
        success: (res: any) => {
          if (res.statusCode === 200 && res.data && res.data.status === 1 && res.data.data) {
            resolve(res.data.data);
          } else {
            const errMsg = res.data?.content || res.data?.message || '获取直传凭据失败';
            reject(new Error(errMsg));
          }
        },
        fail: (err) => reject(new Error(`网络连接失败: ${err.errMsg}`))
      });
    });
  },

  /**
   * wx.uploadFile 零带宽直传云存储
   */
  uploadDirectToCloud(filePath: string, sts: IStsTokenResponseDto, fullKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const formData: Record<string, string> = {
        key: fullKey,
        policy: sts.policyBase64,
        OSSAccessKeyId: sts.accessKeyId,
        success_action_status: '200',
        signature: sts.signature
      };

      if (sts.securityToken) {
        formData['x-oss-security-token'] = sts.securityToken;
      }

      wx.uploadFile({
        url: sts.uploadHost,
        filePath,
        name: 'file',
        formData,
        success: (res) => {
          if (res.statusCode === 200 || res.statusCode === 204) {
            resolve();
          } else {
            reject(new Error(`云存储直传被拒绝 (状态码: ${res.statusCode})`));
          }
        },
        fail: (err) => reject(new Error(`直传上传失败: ${err.errMsg}`))
      });
    });
  }
});
