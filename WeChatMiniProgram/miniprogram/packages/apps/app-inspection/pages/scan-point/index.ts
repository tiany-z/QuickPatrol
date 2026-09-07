/**
 * M20: 微信小程序端现场扫码与防作弊打卡核心页
 * (MiniProgram Anti-Cheating Inspection Scan Page)
 * 
 * 核心设计：
 * 1. 强制仅允许物理摄像头现场扫码 (onlyFromCamera: true)，封死相册选图代扫作弊
 * 2. 调取硬件高精度 GPS 经纬度与精度半径
 * 3. 提交后端三阶地理围栏核验与 HMAC-SHA256 防伪比对
 * 4. 核验通过后触发触感振动反馈，秒级重定向至 M21 工单提报页并自动灌入校区/点位/门类
 */

import { API_BASE } from "../../../../../config/env.js";

export interface IScanPointData {
  isProcessing: boolean;
  verifyingText: string;
  statusBarHeight: number;
}

Page({
  data: {
    isProcessing: false,
    verifyingText: "正在就绪现场防伪取景...",
    statusBarHeight: 44
  },

  onLoad() {
    try {
      const sys = wx.getSystemInfoSync();
      if (sys && sys.statusBarHeight) {
        this.setData({ statusBarHeight: sys.statusBarHeight });
      }
    } catch (e) {
      console.warn("[ScanPoint] 获取状态栏高度异常", e);
    }

    // 页面进入时稍作缓冲后调起现场物理摄像头扫码
    setTimeout(() => {
      this.startPhysicalCameraScan();
    }, 300);
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: "/pages/workplace/index" });
    }
  },

  handleRescan() {
    this.startPhysicalCameraScan();
  },

  /**
   * 启动物理摄像头扫码
   * 关键约束: onlyFromCamera: true (从底层屏蔽微信从相册选取二维码图片)
   */
  startPhysicalCameraScan() {
    if (this.data.isProcessing) return;

    this.setData({
      isProcessing: true,
      verifyingText: "正在开启现场物理摄像头..."
    });

    wx.scanCode({
      onlyFromCamera: true,
      scanType: ["qrCode"],
      success: async (res) => {
        const sceneRaw = res.result;
        await this.handleScanSuccess(sceneRaw);
      },
      fail: (err) => {
        this.setData({ isProcessing: false });
        if (err.errMsg && err.errMsg.includes("cancel")) {
          this.setData({ verifyingText: "扫码已取消，点击下方按钮可重新扫码" });
          wx.showToast({ title: "已取消扫码", icon: "none" });
        } else {
          this.setData({ verifyingText: "摄像头调起失败，请检查相机权限" });
          wx.showModal({
            title: "扫码异常",
            content: "无法调起物理摄像头，请在系统设置中允许微信相机权限后重试。",
            showCancel: false
          });
        }
      }
    });
  },

  /**
   * 获取高精度硬件 GPS 并提交后端防作弊判定
   */
  async handleScanSuccess(sceneRaw: string) {
    this.setData({ isProcessing: true, verifyingText: "正在获取硬件 GPS 并核验三阶地理围栏..." });

    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 3000,
      success: async (loc) => {
        try {
          this.setData({ verifyingText: "正在向服务器验真防伪签名..." });

          // 发起后端防作弊验真请求
          const res = await new Promise<any>((resolve, reject) => {
            wx.request({
              url: `${API_BASE}/api/inspection/qrcode/verify`,
              method: "POST",
              data: {
                scene: sceneRaw,
                userLatitude: loc.latitude,
                userLongitude: loc.longitude,
                accuracy: loc.accuracy || 5,
                scanSource: "camera"
              },
              success: (r) => {
                if (r.statusCode === 200 && r.data && (r.data as any).status === 1) {
                  resolve((r.data as any).data);
                } else {
                  reject(new Error((r.data as any)?.content || (r.data as any)?.message || "打卡核验失败"));
                }
              },
              fail: (e) => reject(e)
            });
          });

          if (res && res.isVerified) {
            // 触感震动反馈
            wx.vibrateShort({ type: "medium" });

            this.setData({
              isProcessing: false,
              verifyingText: "✅ 点位核验通过！正在为您直达工单提报..."
            });

            wx.showToast({
              title: res.warningMessage || "现场打卡成功！",
              icon: "success",
              duration: 1500
            });

            // 秒级自动跳转至 M21 报修提报页，回填点位与空间元数据
            setTimeout(() => {
              const p = res;
              wx.redirectTo({
                url: `/packages/apps/app-patrol/pages/create/index?fromScan=1&pointId=${p.pointId}&campusId=${p.campusId}&categoryId=${p.recommendedCategoryId}&location1=${encodeURIComponent(p.campusName || '')}&location2=${encodeURIComponent(p.locationText || '')}`
              });
            }, 1200);
          }
        } catch (apiErr: any) {
          this.setData({
            isProcessing: false,
            verifyingText: "❌ 打卡未通过：" + (apiErr.message || "距离目标点位偏差过大")
          });
          wx.showModal({
            title: "打卡未通过",
            content: apiErr.message || "距离目标点位偏差过大，请亲临现场重新扫码！",
            showCancel: false,
            confirmText: "重新扫码",
            success: () => this.startPhysicalCameraScan()
          });
        }
      },
      fail: () => {
        this.setData({
          isProcessing: false,
          verifyingText: "⚠️ 无法获取手机定位，请开启位置权限"
        });
        wx.showModal({
          title: "定位失败",
          content: "无法获取手机高精度 GPS，请开启微信位置权限后重试。",
          showCancel: false
        });
      }
    });
  }
});
