/**
 * 高校后勤巡查e速办 v4.0 - M31: 师生诉求提报页面控制器
 * (Confidential Appeal Create Page Controller)
 */

import { ICreateAppealPageState } from "./types.js";
import { VaultManager } from "../../utils/vaultManager.js";

import { API_BASE } from "../../../../../config/env.js";
const DRAFT_KEY = "quickpatrol_feedback_appeal_draft";

Page<ICreateAppealPageState, any>({
  data: {
    title: "",
    content: "",
    categoryIndex: 0,
    categories: [
      { key: "canteen", name: "🍱 食堂餐饮与卫生" },
      { key: "dorm", name: "🏢 宿舍管理与水电" },
      { key: "traffic", name: "🚲 校园交通与班车" },
      { key: "service", name: "👔 后勤服务与作风" },
      { key: "other", name: "💡 其它生活建言" }
    ],
    isAnonymous: true, // 默认开启绝对匿名隐私保护
    allowPublicDisplay: true,
    imageUrls: [],
    isSubmitting: false,
    hasDraft: false
  },

  draftTimer: null as any,

  onLoad() {
    this.checkAndRestoreDraft();
    this.startAutoDraftTimer();
  },

  onUnload() {
    this.stopAutoDraftTimer();
  },

  /**
   * 分类选择变更
   */
  onCategoryChange(e: any) {
    this.setData({
      categoryIndex: Number(e.detail.value)
    });
  },

  /**
   * 标题输入
   */
  onTitleInput(e: any) {
    this.setData({
      title: e.detail.value || ""
    });
  },

  /**
   * 正文输入
   */
  onContentInput(e: any) {
    this.setData({
      content: e.detail.value || ""
    });
  },

  /**
   * 切换匿名状态
   */
  onToggleAnonymous(e: any) {
    const isAnonymous = e.detail.value;
    this.setData({ isAnonymous });
    if (isAnonymous) {
      wx.showToast({
        title: "已开启绝对匿名，真实身份将物理抹零",
        icon: "none",
        duration: 2500
      });
    }
  },

  /**
   * 切换公开广场授权
   */
  onTogglePublic(e: any) {
    this.setData({
      allowPublicDisplay: e.detail.value
    });
  },

  /**
   * 上传现场照片
   */
  onChoosePhoto() {
    const remaining = 4 - this.data.imageUrls.length;
    if (remaining <= 0) return;

    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res: any) => {
        const tempPaths = res.tempFiles.map((f: any) => f.tempFilePath);
        this.setData({
          imageUrls: [...this.data.imageUrls, ...tempPaths]
        });
      }
    });
  },

  /**
   * 删除现场照片
   */
  onDeletePhoto(e: any) {
    const index = Number(e.currentTarget.dataset.index);
    const urls = [...this.data.imageUrls];
    urls.splice(index, 1);
    this.setData({ imageUrls: urls });
  },

  /**
   * 提交诉求
   */
  async onSubmit() {
    const { title, content, isAnonymous, allowPublicDisplay, categories, categoryIndex, imageUrls } = this.data;

    if (!title.trim() || title.trim().length < 5) {
      wx.showToast({ title: "建言标题至少输入5个字", icon: "none" });
      return;
    }

    if (!content.trim() || content.trim().length < 10) {
      wx.showToast({ title: "详细建言至少输入10个字", icon: "none" });
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: isAnonymous ? "加密投递中..." : "正在提交..." });

    const token = wx.getStorageSync("token") || "";

    wx.request({
      url: `${API_BASE}/api/v4/feedback/appeals`,
      method: "POST",
      header: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      data: {
        title: title.trim(),
        content: content.trim(),
        categoryType: categories[categoryIndex].key,
        isAnonymous,
        allowPublicDisplay,
        imageUrls
      },
      success: (res: any) => {
        wx.hideLoading();
        this.setData({ isSubmitting: false });

        if (res.data?.status === 1 && res.data?.data) {
          const { appealId, vaultToken } = res.data.data;

          // 若开启绝对匿名且服务端签发了私钥凭证卡，保存至本地 Storage
          if (isAnonymous && vaultToken) {
            VaultManager.saveVaultToken({
              postId: appealId,
              schoolId: 1,
              token: vaultToken,
              title: title.trim(),
              createdAt: Date.now()
            });
          }

          this.clearDraft();

          wx.showModal({
            title: isAnonymous ? "🔒 匿名保险箱投递成功" : "✅ 提交成功",
            content: isAnonymous
              ? "您的真实学号与姓名已被物理级彻底抹零，免密追溯凭证已安全保存在本地【我的凭证卡】中！"
              : "感谢您的建言，后勤责任科室将尽快正式答复。",
            showCancel: false,
            success: () => {
              wx.navigateBack();
            }
          });
        } else {
          wx.showModal({
            title: "提交被拦截",
            content: res.data?.content || "请检查输入内容",
            showCancel: false
          });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ isSubmitting: false });
        wx.showToast({ title: "网络连接异常，草稿已保存在本地", icon: "none" });
      }
    });
  },

  /**
   * 自动草稿定时器 (每 3 秒同步一次 Storage)
   */
  startAutoDraftTimer() {
    this.draftTimer = setInterval(() => {
      const { title, content, isAnonymous, categoryIndex } = this.data;
      if (title.trim() || content.trim()) {
        wx.setStorageSync(DRAFT_KEY, {
          title,
          content,
          isAnonymous,
          categoryIndex,
          savedAt: Date.now()
        });
      }
    }, 3000);
  },

  stopAutoDraftTimer() {
    if (this.draftTimer) {
      clearInterval(this.draftTimer);
      this.draftTimer = null;
    }
  },

  checkAndRestoreDraft() {
    const draft = wx.getStorageSync(DRAFT_KEY);
    if (draft && (draft.title || draft.content)) {
      this.setData({
        title: draft.title || "",
        content: draft.content || "",
        isAnonymous: draft.isAnonymous !== undefined ? draft.isAnonymous : true,
        categoryIndex: draft.categoryIndex || 0,
        hasDraft: true
      });
    }
  },

  onClearDraft() {
    this.clearDraft();
    this.setData({
      title: "",
      content: "",
      hasDraft: false
    });
    wx.showToast({ title: "已清除草稿", icon: "none" });
  },

  clearDraft() {
    wx.removeStorageSync(DRAFT_KEY);
    this.setData({ hasDraft: false });
  }
});
