/**
 * 高校后勤巡查e速办 v4.0 - M47 小程序专属 AI 流式问答工作台
 * 文件路径: miniprogram/pages/ai-copilot/index.ts
 * 核心职责: 小程序工作台全屏交互、阻尼打字机平滑出队调度、Thinking 胶囊秒表、
 *           以及视口智能滚底防打扰控制。
 */

import { MiniProgramSSEClient } from './utils/sseClient';
import { ICopilotMessageItem } from './contracts/copilotTypes';

/**
 * 算法 2: 基于动态阻尼因子的打字机流式平滑插值步长计算
 * S(t) = clamp(floor(Q(t) / 8) + 1, 1, 6)
 */
export function calculateTypewriterStep(queueLength: number): number {
  if (queueLength <= 0) return 0;
  return Math.min(Math.max(Math.floor(queueLength / 8) + 1, 1), 6);
}

/**
 * 算法 3: 视口触底锁定与反向滑动探测
 */
export function evaluateViewportLock(
  distanceToBottom: number,
  threshold: number = 40
): { isLocked: boolean; showBtn: boolean } {
  if (distanceToBottom > threshold) {
    return { isLocked: false, showBtn: true };
  }
  return { isLocked: true, showBtn: false };
}

/**
 * 算法 4: 思考耗时秒表高精度格式化
 */
export function formatElapsedSeconds(startTimeMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max((nowMs - startTimeMs) / 1000, 0);
  return `${diffSec.toFixed(1)}s`;
}

Component({
  data: {
    messages: [] as ICopilotMessageItem[],
    inputText: '',
    isGenerating: false,
    scrollIntoViewId: '',
    isLockedToBottom: true,
    showScrollBottomBtn: false,
    isHistoryDrawerOpen: false,
    currentSessionUuid: '',
    statusBarHeight: 44,
    navBarHeight: 44,
    headerTotalHeight: 88,
    capsulePaddingRight: 96,
    canBack: false
  },

  lifetimes: {
    attached() {
      (this as any)._typewriterQueue = [];
      (this as any)._sseClient = null;
      (this as any)._tickerTimer = null;
      (this as any)._thinkSecondsTimer = null;

      let statusBarHeight = 44;
      let navBarHeight = 44;
      let headerTotalHeight = 88;
      let capsulePaddingRight = 96;

      const app = typeof getApp === "function" ? getApp<{ globalData: { systemMetrics: any } }>() : null;
      if (app?.globalData?.systemMetrics?.headerTotalHeight) {
        const m = app.globalData.systemMetrics;
        statusBarHeight = m.statusBarHeight || 44;
        navBarHeight = m.navBarHeight || 44;
        headerTotalHeight = m.headerTotalHeight || 88;
        capsulePaddingRight = m.capsule ? m.capsule.width + (m.capsuleRightMargin || 10) : 96;
      } else {
        const wxAny = wx as any;
        const windowInfo = wxAny.getWindowInfo ? wxAny.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
        if (windowInfo.statusBarHeight) statusBarHeight = windowInfo.statusBarHeight;
        if (wx.getMenuButtonBoundingClientRect) {
          const cap = wx.getMenuButtonBoundingClientRect();
          if (cap?.top && cap?.height) {
            navBarHeight = (cap.top - statusBarHeight) * 2 + cap.height;
            const winWidth = windowInfo.windowWidth || 375;
            capsulePaddingRight = winWidth - cap.left + 8;
          }
        }
        headerTotalHeight = statusBarHeight + navBarHeight;
      }

      const pages = getCurrentPages ? getCurrentPages() : [];
      const canBack = pages.length > 1;

      this.setData({
        statusBarHeight,
        navBarHeight,
        headerTotalHeight,
        capsulePaddingRight,
        canBack
      });

      (this as any).initWelcomeMessage();
      (this as any).startTypewriterTicker();
    },
    detached() {
      (this as any).stopTypewriterTicker();
      (this as any).stopThinkingTimer();
      if ((this as any)._sseClient) {
        ((this as any)._sseClient as MiniProgramSSEClient).abort();
      }
    }
  },

  pageLifetimes: {
    hide() {
      // 页面切入后台时安全中断，杜绝算力偷跑
      if (this.data.isGenerating && (this as any)._sseClient) {
        ((this as any)._sseClient as MiniProgramSSEClient).abort();
        this.setData({ isGenerating: false });
      }
    }
  },

  methods: {
    handleBack() {
      try {
        if (typeof wx !== "undefined" && wx.vibrateShort) {
          wx.vibrateShort({ type: "light" });
        }
      } catch {}
      const pages = getCurrentPages ? getCurrentPages() : [];
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.reLaunch({ url: "/pages/workplace/index" });
      }
    },

    /**
     * 初始化首条全校欢迎语
     */
    initWelcomeMessage() {
      const welcome: ICopilotMessageItem = {
        id: 'msg_welcome',
        role: 'assistant',
        renderedContent:
          '同学们、老师们好！我是高校后勤巡查 AI 智能小助手 🤖\n关于宿舍水电急修、公用设施损坏报修、工单施工进度或后勤服务规范，您可以随时向我咨询！',
        thinkingPill: null,
        isStreaming: false,
        suggestions: ['西校区12号楼供水故障处理进展', '如何申报夜间紧急抢修？', '查看后勤服务规章'],
        timeText: '刚刚'
      };
      this.setData({ messages: [welcome] });
    },

    /**
     * 启动打字机恒频定时器 (每 20ms 执行一次阻尼步长出队)
     */
    startTypewriterTicker() {
      if ((this as any)._tickerTimer) return;
      (this as any)._tickerTimer = setInterval(() => {
        const queue: string[] = (this as any)._typewriterQueue || [];
        if (queue.length === 0) return;

        // 核心算法 2: 自适应步长
        const step = calculateTypewriterStep(queue.length);
        const charsToEmit = queue.splice(0, step).join('');

        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        const lastMsg = msgs[lastIndex];

        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.renderedContent += charsToEmit;
          this.setData({
            [`messages[${lastIndex}].renderedContent`]: lastMsg.renderedContent
          });

          // 若处于触底锁定状态，保持紧随视野
          if (this.data.isLockedToBottom) {
            this.setData({ scrollIntoViewId: 'scroll-anchor-bottom' });
          }
        }
      }, 20);
    },

    stopTypewriterTicker() {
      if ((this as any)._tickerTimer) {
        clearInterval((this as any)._tickerTimer);
        (this as any)._tickerTimer = null;
      }
    },

    onInputChange(e: any) {
      this.setData({ inputText: e.detail.value });
    },

    /**
     * 用户点击发送按钮
     */
    handleSend() {
      const text = this.data.inputText.trim();
      if (!text || this.data.isGenerating) return;

      const userMsg: ICopilotMessageItem = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        renderedContent: text,
        thinkingPill: null,
        isStreaming: false,
        timeText: '刚刚'
      };

      const aiMsg: ICopilotMessageItem = {
        id: `msg_ai_${Date.now()}`,
        role: 'assistant',
        renderedContent: '',
        thinkingPill: {
          status: 'THINKING',
          title: '正在深度思考后勤处置规范...',
          thinkContent: '',
          toolLogs: [],
          startTimeMs: Date.now(),
          elapsedSecondsText: '0.1s',
          isExpanded: false
        },
        isStreaming: true,
        timeText: '刚刚'
      };

      this.setData({
        messages: [...this.data.messages, userMsg, aiMsg],
        inputText: '',
        isGenerating: true,
        isLockedToBottom: true,
        scrollIntoViewId: 'scroll-anchor-bottom'
      });

      (this as any).startThinkingTimer();
      (this as any).initiateStreamConnection(text);
    },

    /**
     * 发起 SSE 长连接
     */
    initiateStreamConnection(prompt: string) {
      const sseClient = new MiniProgramSSEClient();
      (this as any)._sseClient = sseClient;
      const token = wx.getStorageSync('token') || '';

      // 监听思考流增量
      sseClient.on('think_delta', (data: any) => {
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        const lastMsg = msgs[lastIndex];
        if (lastMsg?.thinkingPill) {
          if (data.title) {
            lastMsg.thinkingPill.title = data.title;
          }
          if (data.delta) {
            lastMsg.thinkingPill.thinkContent += data.delta;
          }
          this.setData({
            [`messages[${lastIndex}].thinkingPill`]: lastMsg.thinkingPill
          });
        }
      });

      // 监听工具调用开始
      sseClient.on('tool_start', (data: any) => {
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        const lastMsg = msgs[lastIndex];
        if (lastMsg?.thinkingPill) {
          lastMsg.thinkingPill.status = 'TOOL_CALLING';
          lastMsg.thinkingPill.title =
            data.toolInfo?.pillTitle || data.title || '正在查询后勤实时事实数据...';
          this.setData({
            [`messages[${lastIndex}].thinkingPill`]: lastMsg.thinkingPill
          });
        }
      });

      // 监听工具调用结束
      sseClient.on('tool_end', (data: any) => {
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        const lastMsg = msgs[lastIndex];
        if (lastMsg?.thinkingPill && data.toolInfo) {
          lastMsg.thinkingPill.toolLogs.push({
            toolName: data.toolInfo.toolName,
            pillTitle: data.toolInfo.pillTitle,
            durationMs: data.toolInfo.durationMs || 100,
            success: data.toolInfo.success !== false
          });
          this.setData({
            [`messages[${lastIndex}].thinkingPill`]: lastMsg.thinkingPill
          });
        }
      });

      // 监听正式正文打字字符
      sseClient.on('text_delta', (data: any) => {
        if (data.delta) {
          const msgs = this.data.messages;
          const lastIndex = msgs.length - 1;
          const lastMsg = msgs[lastIndex];

          if (lastMsg?.thinkingPill && lastMsg.thinkingPill.status !== 'FINISHED') {
            lastMsg.thinkingPill.status = 'FINISHED';
            lastMsg.thinkingPill.title = `深度思考完毕 (历时 ${lastMsg.thinkingPill.elapsedSecondsText})`;
            (this as any).stopThinkingTimer();
            this.setData({
              [`messages[${lastIndex}].thinkingPill`]: lastMsg.thinkingPill
            });
          }

          // 将字符逐字压入打字机缓冲队列
          const queue: string[] = (this as any)._typewriterQueue || [];
          for (let i = 0; i < data.delta.length; i++) {
            queue.push(data.delta[i]);
          }
          (this as any)._typewriterQueue = queue;
        }
      });

      // 监听推荐气泡
      sseClient.on('suggestions', (data: any) => {
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        this.setData({
          [`messages[${lastIndex}].suggestions`]: data.suggestions
        });
      });

      // 监听 M49 智能工单直达卡片
      sseClient.on('action_cards', (data: any) => {
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        if (data.cards && Array.isArray(data.cards)) {
          this.setData({
            [`messages[${lastIndex}].actionCards`]: data.cards
          });
        }
      });

      // 监听完成
      sseClient.on('done', (data: any) => {
        (this as any).stopThinkingTimer();
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        const updates: any = {
          isGenerating: false,
          [`messages[${lastIndex}].isStreaming`]: false
        };
        if (data?.sessionUuid) {
          updates.currentSessionUuid = data.sessionUuid;
        }
        this.setData(updates);
      });

      // 监听异常报错
      sseClient.on('error', (err: any) => {
        (this as any).stopThinkingTimer();
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        this.setData({
          isGenerating: false,
          [`messages[${lastIndex}].isStreaming`]: false,
          [`messages[${lastIndex}].errorMessage`]: err.message || 'AI 思考遇到波动，已保留已生成内容'
        });
      });

      // 监听用户主动中止
      sseClient.on('aborted', () => {
        (this as any).stopThinkingTimer();
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        this.setData({
          isGenerating: false,
          [`messages[${lastIndex}].isStreaming`]: false
        });
      });

      // 建立连接
      sseClient.connect('/api/v1/ai/chat', { prompt, history: [], sessionUuid: this.data.currentSessionUuid || undefined }, token);
    },

    /**
     * 停止生成
     */
    handleStopGeneration() {
      if ((this as any)._sseClient) {
        ((this as any)._sseClient as MiniProgramSSEClient).abort();
      }
      (this as any)._typewriterQueue = [];
      (this as any).stopThinkingTimer();
      const msgs = this.data.messages;
      const lastIndex = msgs.length - 1;
      this.setData({
        isGenerating: false,
        [`messages[${lastIndex}].isStreaming`]: false
      });
    },

    /**
     * 思考秒表递增
     */
    startThinkingTimer() {
      (this as any).stopThinkingTimer();
      (this as any)._thinkSecondsTimer = setInterval(() => {
        const msgs = this.data.messages;
        const lastIndex = msgs.length - 1;
        const lastMsg = msgs[lastIndex];
        if (lastMsg?.thinkingPill && lastMsg.thinkingPill.status !== 'FINISHED') {
          const text = formatElapsedSeconds(lastMsg.thinkingPill.startTimeMs);
          lastMsg.thinkingPill.elapsedSecondsText = text;
          this.setData({
            [`messages[${lastIndex}].thinkingPill.elapsedSecondsText`]: text
          });
        }
      }, 100);
    },

    stopThinkingTimer() {
      if ((this as any)._thinkSecondsTimer) {
        clearInterval((this as any)._thinkSecondsTimer);
        (this as any)._thinkSecondsTimer = null;
      }
    },

    /**
     * 切换 Thinking Pill 折叠/展开态
     */
    togglePillExpand(e: any) {
      const index = Number(e.currentTarget.dataset.index);
      const msgs = this.data.messages;
      const pill = msgs[index]?.thinkingPill;
      if (pill) {
        pill.isExpanded = !pill.isExpanded;
        this.setData({ [`messages[${index}].thinkingPill.isExpanded`]: pill.isExpanded });
      }
    },

    /**
     * 点击快捷追问气泡
     */
    handleSelectSuggestion(e: any) {
      const chip = e.currentTarget.dataset.chip;
      if (!chip || this.data.isGenerating) return;
      this.setData({ inputText: chip }, () => {
        (this as any).handleSend();
      });
    },

    /**
     * 滚动事件监听：探测用户是否主动反向阅读
     */
    onScroll(e: any) {
      const { scrollTop, scrollHeight } = e.detail;
      const query = this.createSelectorQuery();
      query
        .select('.chat-scroll-container')
        .boundingClientRect((rect: any) => {
          if (!rect) return;
          const distanceToBottom = scrollHeight - (scrollTop + rect.height);
          const { isLocked, showBtn } = evaluateViewportLock(distanceToBottom, 40);
          if (
            this.data.isLockedToBottom !== isLocked ||
            this.data.showScrollBottomBtn !== showBtn
          ) {
            this.setData({
              isLockedToBottom: isLocked,
              showScrollBottomBtn: showBtn
            });
          }
        })
        .exec();
    },

    scrollToBottom() {
      this.setData({
        isLockedToBottom: true,
        showScrollBottomBtn: false,
        scrollIntoViewId: 'scroll-anchor-bottom'
      });
    },

    /**
     * M49: 历史会话抽屉开关与会话切换
     */
    openHistoryDrawer() {
      this.setData({ isHistoryDrawerOpen: true });
    },

    closeHistoryDrawer() {
      this.setData({ isHistoryDrawerOpen: false });
    },

    async handleSelectHistoricalSession(e: any) {
      const sessionUuid = e.detail?.sessionUuid;
      if (!sessionUuid) return;

      const token = wx.getStorageSync('token') || '';
      try {
        const res = await new Promise<any>((resolve, reject) => {
          wx.request({
            url: `https://patrol.university.edu.cn/api/v1/ai/sessions?uuid=${encodeURIComponent(sessionUuid)}`,
            header: { Authorization: `Bearer ${token}` },
            success: (r) => resolve(r.data),
            fail: reject
          });
        });

        if (res && res.code === 200 && res.data) {
          const detail = res.data;
          const restoredMessages: ICopilotMessageItem[] = (detail.messages || []).map((m: any) => ({
            id: m.id,
            role: m.role,
            renderedContent: m.content,
            thinkingPill: null,
            isStreaming: false,
            actionCards: m.actionCards,
            timeText: m.timeText || ''
          }));

          this.setData({
            messages: restoredMessages,
            currentSessionUuid: sessionUuid
          }, () => {
            (this as any).scrollToBottom();
          });
        }
      } catch {
        wx.showToast({ title: '加载历史会话失败', icon: 'none' });
      }
    }
  }
});
