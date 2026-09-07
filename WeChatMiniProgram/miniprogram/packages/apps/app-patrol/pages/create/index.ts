/**
 * M21: 微信小程序端隐患巡查上报核心页面
 * (MiniProgram Patrol Work Order Creation Page)
 * 
 * 核心特性：
 * 1. M20 线下二维码扫码进件高速回填 (fromScan=1, pointId, campus, category, location)
 * 2. 自由巡查全屏地图选点与后端建筑 POI 空间欧氏吸附 (/api/patrol/poi/snap)
 * 3. 客户端 3 秒滑动防抖无感本地草稿箱 (自动镜像持久化与断点一键恢复)
 * 4. 九宫格现场照片实况勘验直传 (支持 1~9 张多图)
 * 5. 动态紧急程度胶囊组 (普通/中等/加急) 与公开监督开关
 * 6. clientToken 毫秒级幂等凭据与提单状态机防刷防爆
 */

import { ICreatePageData, IPatrolDraftPayload } from "./types.js";
import { API_BASE } from "../../../../../config/env.js";

Page<ICreatePageData, any>({
  data: {
    campusId: 1,
    categoryId: 1,
    title: "",
    desc: "",
    images: [],
    location1: "",
    location2: "",
    latitude: null,
    longitude: null,
    priorityLevel: 1, // 0普通, 1中等, 2加急
    isPublic: 1,      // 1公开, 0仅内部可见
    isFromQrScan: false,
    scannedPointId: 0,
    isSubmitting: false,
    hasDraftPrompted: false,
    clientToken: "",
    campusesList: [
      { id: 1, name: "东校区" },
      { id: 2, name: "西校区" },
      { id: 3, name: "南校区" }
    ],
    categoriesList: [
      { id: 1, name: "水电暖通", icon: "💧" },
      { id: 2, name: "土建木工", icon: "🔨" },
      { id: 3, name: "桌椅门窗", icon: "🚪" },
      { id: 4, name: "消防安防", icon: "🧯" },
      { id: 5, name: "绿化环卫", icon: "🌳" },
      { id: 6, name: "公共照明", icon: "💡" }
    ],
    campusIndex: 0,
    categoryIndex: 0
  },

  draftTimer: null as any,

  onLoad(query: any) {
    // 1. 初始化客户端唯一防重幂等 Token
    this.initClientToken();

    // 2. 检查是否来自 M20 扫码高速进件
    if (query && query.fromScan === "1") {
      const cId = Number(query.campusId) || 1;
      const catId = Number(query.categoryId) || 1;
      const cIdx = Math.max(0, this.data.campusesList.findIndex((c: any) => c.id === cId));
      const catIdx = Math.max(0, this.data.categoriesList.findIndex((c: any) => c.id === catId));

      this.setData({
        isFromQrScan: true,
        scannedPointId: Number(query.pointId) || 0,
        campusId: cId,
        categoryId: catId,
        campusIndex: cIdx,
        categoryIndex: catIdx,
        location1: decodeURIComponent(query.location1 || ""),
        location2: decodeURIComponent(query.location2 || "")
      });

      wx.showToast({
        title: "已锁定打卡点位",
        icon: "success",
        duration: 1500
      });
    } else {
      // 3. 自由提报模式：探针扫描本地未提交草稿
      this.checkAndRestoreDraft();
    }
  },

  onUnload() {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
    }
  },

  /**
   * 生成唯一防重提交凭据 Token
   */
  initClientToken() {
    const randomSalt = Math.random().toString(36).substring(2, 10);
    const token = `SUBMIT-${Date.now()}-${randomSalt}`;
    this.setData({ clientToken: token });
  },

  /**
   * 表单输入字段通用绑定与 3 秒防抖自动落盘
   */
  onInputTitle(e: any) {
    this.setData({ title: e.detail.value });
    this.triggerDraftAutoSave();
  },

  onInputDesc(e: any) {
    this.setData({ desc: e.detail.value });
    this.triggerDraftAutoSave();
  },

  onInputLocation1(e: any) {
    this.setData({ location1: e.detail.value });
    this.triggerDraftAutoSave();
  },

  onInputLocation2(e: any) {
    this.setData({ location2: e.detail.value });
    this.triggerDraftAutoSave();
  },

  onCampusChange(e: any) {
    const idx = Number(e.detail.value);
    const campus = this.data.campusesList[idx];
    if (campus) {
      this.setData({
        campusIndex: idx,
        campusId: campus.id
      });
      this.triggerDraftAutoSave();
    }
  },

  onCategoryChange(e: any) {
    const idx = Number(e.detail.value);
    const cat = this.data.categoriesList[idx];
    if (cat) {
      this.setData({
        categoryIndex: idx,
        categoryId: cat.id
      });
      this.triggerDraftAutoSave();
    }
  },

  selectPriority(e: any) {
    const level = Number(e.currentTarget.dataset.level) as 0 | 1 | 2;
    this.setData({ priorityLevel: level });
    this.triggerDraftAutoSave();
  },

  togglePublic(e: any) {
    const isPublic = e.detail.value ? 1 : 0;
    this.setData({ isPublic });
    this.triggerDraftAutoSave();
  },

  /**
   * 3 秒滑动防抖本地草稿自动持久化
   */
  triggerDraftAutoSave() {
    if (this.data.isFromQrScan) return; // 扫码打卡场景保护原始点位，不覆盖自由草稿
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
    }

    this.draftTimer = setTimeout(() => {
      this.saveDraftToStorage();
    }, 3000);
  },

  saveDraftToStorage() {
    const app = getApp<any>();
    const schoolId = app?.globalData?.currentSchoolId || 1;
    const userId = app?.globalData?.userInfo?.id || 0;
    const draftKey = `quickpatrol_draft_${schoolId}_${userId}`;

    const payload: IPatrolDraftPayload = {
      schoolId,
      userId,
      updatedTimestamp: Date.now(),
      data: {
        campusId: this.data.campusId,
        categoryId: this.data.categoryId,
        title: this.data.title,
        desc: this.data.desc,
        images: this.data.images,
        location1: this.data.location1,
        location2: this.data.location2,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        priorityLevel: this.data.priorityLevel,
        isPublic: this.data.isPublic,
        pointId: this.data.scannedPointId || undefined
      }
    };

    wx.setStorage({
      key: draftKey,
      data: payload
    });
  },

  /**
   * 探针检查并恢复本地草稿
   */
  checkAndRestoreDraft() {
    const app = getApp<any>();
    const schoolId = app?.globalData?.currentSchoolId || 1;
    const userId = app?.globalData?.userInfo?.id || 0;
    const draftKey = `quickpatrol_draft_${schoolId}_${userId}`;

    wx.getStorage({
      key: draftKey,
      success: (res) => {
        const draft: IPatrolDraftPayload = res.data;
        if (draft && draft.data && (draft.data.title || draft.data.desc || draft.data.images?.length > 0)) {
          wx.showModal({
            title: "发现未提交草稿",
            content: "检测到您上次有未完成的报修草稿，是否立即恢复？",
            confirmText: "恢复内容",
            cancelText: "放弃草稿",
            success: (modalRes) => {
              if (modalRes.confirm) {
                const d = draft.data;
                const cIdx = Math.max(0, this.data.campusesList.findIndex((c: any) => c.id === d.campusId));
                const catIdx = Math.max(0, this.data.categoriesList.findIndex((c: any) => c.id === d.categoryId));

                this.setData({
                  campusId: d.campusId || 1,
                  categoryId: d.categoryId || 1,
                  campusIndex: cIdx,
                  categoryIndex: catIdx,
                  title: d.title || "",
                  desc: d.desc || "",
                  images: d.images || [],
                  location1: d.location1 || "",
                  location2: d.location2 || "",
                  latitude: d.latitude || null,
                  longitude: d.longitude || null,
                  priorityLevel: d.priorityLevel !== undefined ? d.priorityLevel : 1,
                  isPublic: d.isPublic !== undefined ? d.isPublic : 1
                });
                wx.showToast({ title: "草稿已恢复", icon: "success" });
              } else {
                wx.removeStorage({ key: draftKey });
              }
            }
          });
        }
      }
    });
  },

  /**
   * 九宫格拍照与选取实况图片 (1~9张)
   */
  handleChooseImages() {
    const remainCount = 9 - this.data.images.length;
    if (remainCount <= 0) {
      wx.showToast({ title: "最多支持上传 9 张现场照片", icon: "none" });
      return;
    }

    wx.showActionSheet({
      itemList: ["📷 防篡改水印相机现场存证 (推荐)", "🖼️ 从手机相册选取"],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 调起 M22 防篡改水印相机
          const currentCampus = this.data.campusesList[this.data.campusIndex]?.name || "主校区";
          const locationDesc = this.data.location1 || "现场勘验";
          wx.navigateTo({
            url: `/packages/apps/app-patrol/pages/camera/index?scene=patrol&campusName=${encodeURIComponent(currentCampus)}&location=${encodeURIComponent(locationDesc)}`
          });
        } else if (res.tapIndex === 1) {
          wx.chooseMedia({
            count: remainCount,
            mediaType: ["image"],
            sourceType: ["album"],
            sizeType: ["compressed"],
            success: (mediaRes) => {
              const newPaths = mediaRes.tempFiles.map((f) => f.tempFilePath);
              this.setData({
                images: [...this.data.images, ...newPaths]
              });
              this.triggerDraftAutoSave();
            }
          });
        }
      }
    });
  },

  /**
   * M22 水印相机完成现场拍照直传后的证据回传注入入口
   */
  onPhotoCaptured(cdnUrl: string) {
    if (!cdnUrl) return;
    this.setData({
      images: [...this.data.images, cdnUrl]
    });
    this.triggerDraftAutoSave();
    wx.showToast({ title: "水印存证已录入", icon: "success" });
  },

  handleRemoveImage(e: any) {
    const idx = Number(e.currentTarget.dataset.index);
    const updated = this.data.images.filter((_: any, i: number) => i !== idx);
    this.setData({ images: updated });
    this.triggerDraftAutoSave();
  },

  handlePreviewImage(e: any) {
    const current = e.currentTarget.dataset.url;
    wx.previewImage({
      current,
      urls: this.data.images
    });
  },

  /**
   * 全屏地图选点与后端校内建筑 POI 吸附
   */
  handleChooseMapLocation() {
    wx.chooseLocation({
      latitude: this.data.latitude || undefined,
      longitude: this.data.longitude || undefined,
      success: async (res) => {
        const lat = res.latitude;
        const lng = res.longitude;
        const rawName = res.name || res.address || "";

        this.setData({
          latitude: lat,
          longitude: lng,
          location1: rawName
        });

        // 发起后端 POI 建筑物吸附检索
        wx.request({
          url: `${API_BASE}/api/patrol/poi/snap`,
          method: "POST",
          data: {
            campusId: this.data.campusId,
            latitude: lat,
            longitude: lng
          },
          success: (snapRes: any) => {
            if (snapRes.statusCode === 200 && snapRes.data?.status === 1 && snapRes.data?.data?.isSnapped) {
              const snap = snapRes.data.data;
              this.setData({
                location1: snap.buildingName,
                latitude: snap.snappedLat,
                longitude: snap.snappedLng
              });
              wx.showToast({
                title: `已吸附至: ${snap.buildingName}`,
                icon: "none"
              });
            }
          },
          complete: () => {
            this.triggerDraftAutoSave();
          }
        });
      }
    });
  },

  /**
   * 提交工单主入口
   */
  async handleSubmitPatrol() {
    if (this.data.isSubmitting) return;

    // 前置边界校验
    if (!this.data.title.trim() || this.data.title.trim().length < 2) {
      wx.showToast({ title: "故障标题不得少于2个字", icon: "none" });
      return;
    }
    if (!this.data.desc.trim() || this.data.desc.trim().length < 5) {
      wx.showToast({ title: "详细描述请不少于5个字", icon: "none" });
      return;
    }
    if (this.data.images.length === 0) {
      wx.showToast({ title: "请至少上传1张现场照片", icon: "none" });
      return;
    }
    if (!this.data.location1.trim()) {
      wx.showToast({ title: "请填写或在地图选定建筑物", icon: "none" });
      return;
    }
    if (!this.data.location2.trim()) {
      wx.showToast({ title: "请补充具体楼层或房间号", icon: "none" });
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: "正在提报工单..." });

    wx.request({
      url: `${API_BASE}/api/patrol/create`,
      method: "POST",
      data: {
        campusId: this.data.campusId,
        categoryId: this.data.categoryId,
        title: this.data.title.trim(),
        desc: this.data.desc.trim(),
        images: this.data.images,
        location1: this.data.location1.trim(),
        location2: this.data.location2.trim(),
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        priorityLevel: this.data.priorityLevel,
        isPublic: this.data.isPublic,
        clientToken: this.data.clientToken,
        pointId: this.data.scannedPointId || undefined
      },
      success: (res: any) => {
        wx.hideLoading();
        if (res.statusCode === 200 && res.data && res.data.status === 1) {
          // 清除本地 Storage 草稿
          const app = getApp<any>();
          const schoolId = app?.globalData?.currentSchoolId || 1;
          const userId = app?.globalData?.userInfo?.id || 0;
          wx.removeStorage({ key: `quickpatrol_draft_${schoolId}_${userId}` });

          wx.showToast({
            title: "隐患提报成功！",
            icon: "success",
            duration: 1500
          });

          // 成功后延时跳转回前页或详情页
          setTimeout(() => {
            wx.navigateBack({
              fail: () => {
                wx.redirectTo({ url: "/pages/index/index" });
              }
            });
          }, 1200);
        } else {
          const errMsg = res.data?.content || res.data?.message || "提单受阻，请稍后重试";
          wx.showModal({
            title: "提单未完成",
            content: errMsg,
            showCancel: false
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showModal({
          title: "网络连接异常",
          content: err.errMsg || "请求超时，草稿已保存在本地，请重试！",
          showCancel: false
        });
      },
      complete: () => {
        this.setData({ isSubmitting: false });
      }
    });
  }
});
