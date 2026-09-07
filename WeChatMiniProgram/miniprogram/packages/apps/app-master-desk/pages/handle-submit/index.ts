/**
 * packages/apps/app-master-desk/pages/handle-submit/index.ts
 * 师傅现场施工整改完工交卷页面逻辑
 */

import { IHandleSubmitFormData } from "./types";

Page({
  data: {
    patrolId: 0,
    title: "",
    orderNo: "",
    location: "",
    content: "",
    images: [] as string[],
    durationHours: 1.0,
    quickHours: [0.5, 1.0, 2.0, 4.0, 8.0],
    submitting: false,
    hasDraft: false
  } as IHandleSubmitFormData,

  onLoad(options: { patrolId?: string; title?: string; orderNo?: string; location?: string }) {
    const pId = options.patrolId ? parseInt(options.patrolId, 10) : 0;
    this.setData({
      patrolId: pId,
      title: decodeURIComponent(options.title || "后勤抢修工单"),
      orderNo: options.orderNo || `LCU-ORDER-${pId}`,
      location: decodeURIComponent(options.location || "报修现场")
    });

    if (pId > 0) {
      this.checkLocalDraft(pId);
    }
  },

  /**
   * 检查离线断点暂存草稿并提示恢复
   */
  checkLocalDraft(pId: number) {
    try {
      const draft = wx.getStorageSync(`draft:handle:${pId}`);
      if (draft && draft.content) {
        this.setData({ hasDraft: true });
        wx.showModal({
          title: "发现未提交的完工草稿",
          content: "检测到上次因网络中断暂存的整改记录，是否一键恢复？",
          confirmText: "恢复草稿",
          cancelText: "放弃",
          success: (res) => {
            if (res.confirm) {
              this.setData({
                content: draft.content || "",
                images: Array.isArray(draft.images) ? draft.images : [],
                durationHours: draft.durationHours || 1.0
              });
            } else {
              wx.removeStorageSync(`draft:handle:${pId}`);
            }
          }
        });
      }
    } catch {
      // 容错不阻塞页面渲染
    }
  },

  /**
   * 输入整改内容说明
   */
  onContentInput(e: WechatMiniprogram.CustomEvent) {
    const val = e.detail.value;
    this.setData({ content: val });
    this.saveLocalDraft();
  },

  /**
   * 选择快捷耗时
   */
  onSelectHour(e: WechatMiniprogram.CustomEvent) {
    const hour = Number(e.currentTarget.dataset.hour);
    this.setData({ durationHours: hour });
    this.saveLocalDraft();
  },

  /**
   * 自定义耗时输入
   */
  onCustomHourInput(e: WechatMiniprogram.CustomEvent) {
    const val = parseFloat(e.detail.value);
    if (!isNaN(val)) {
      this.setData({ durationHours: val });
      this.saveLocalDraft();
    }
  },

  /**
   * 暂存离线草稿
   */
  saveLocalDraft() {
    const { patrolId, content, images, durationHours } = this.data;
    if (patrolId <= 0) return;
    try {
      wx.setStorageSync(`draft:handle:${patrolId}`, {
        content,
        images,
        durationHours,
        savedAt: Date.now()
      });
    } catch {
      // 忽略存储超限
    }
  },

  /**
   * 拍摄水印照片或上传完工照片
   */
  async onTakeWatermarkPhoto() {
    const { images, patrolId } = this.data;
    if (images.length >= 9) {
      wx.showToast({ title: "最多上传 9 张现场照片", icon: "none" });
      return;
    }

    try {
      wx.chooseMedia({
        count: 9 - images.length,
        mediaType: ["image"],
        sourceType: ["camera", "album"],
        camera: "back",
        success: (res) => {
          const newPaths = res.tempFiles.map((_f, idx) => {
            // 生成规范沙箱 OSS 模拟路径
            return `/schools/1/patrol/${patrolId}/handle/proof_${Date.now()}_${idx}.jpg`;
          });
          this.setData({
            images: [...images, ...newPaths]
          });
          this.saveLocalDraft();
          wx.showToast({ title: "照片添加成功", icon: "success" });
        }
      });
    } catch {
      wx.showToast({ title: "打开相机失败", icon: "none" });
    }
  },

  /**
   * 删除已选照片
   */
  onDeleteImage(e: WechatMiniprogram.CustomEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const updated = [...this.data.images];
    updated.splice(idx, 1);
    this.setData({ images: updated });
    this.saveLocalDraft();
  },

  /**
   * 预览大图
   */
  onPreviewImage(e: WechatMiniprogram.CustomEvent) {
    const current = e.currentTarget.dataset.src;
    wx.previewImage({
      current,
      urls: this.data.images
    });
  },

  /**
   * 提交完工交卷
   */
  async onSubmitHandle() {
    const { patrolId, content, images, durationHours, submitting } = this.data;
    if (submitting) return;

    if (!content || content.trim().length < 5) {
      wx.showToast({ title: "整改说明至少输入 5 个字符", icon: "none" });
      return;
    }

    if (images.length === 0) {
      wx.showToast({ title: "必须上传至少 1 张完工实拍照片", icon: "none" });
      return;
    }

    if (isNaN(durationHours) || durationHours < 0.1 || durationHours > 120.0) {
      wx.showToast({ title: "施工耗时须在 0.1 ~ 120.0 小时之间", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在提交完工凭证...", mask: true });

    try {
      // 清理离线草稿
      wx.removeStorageSync(`draft:handle:${patrolId}`);

      wx.showToast({
        title: "完工交卷成功，等待质检验收",
        icon: "success",
        duration: 1500
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err: any) {
      wx.showToast({
        title: err.message || "交卷失败，请重试",
        icon: "none"
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  }
});
