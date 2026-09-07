import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  calculateSystemMetrics,
  deriveHslTiers,
  determineEmptyMode,
  foldBadgeCount,
} from "../shared/themeSubstrate.js";

describe("M07: 小程序宿主架构与 Design Token 样式基座 (Frontend Token Substrate)", () => {
  const miniProgramRoot = path.resolve(
    __dirname,
    "../../../WeChatMiniProgram/miniprogram"
  );

  describe("单元 1: 算法 1 - HSL 色阶动态派生与多校主题覆盖 (HSL Color Tier Deriver)", () => {
    it("默认科技蓝 (H=215, S=100, L=50) 必须派生出标准的 8 级阶梯与外发光变量", () => {
      const tiers = deriveHslTiers({ h: 215, s: 100, l: 50 });

      expect(tiers["--qp-primary"]).toBe("hsl(215, 100%, 50%)");
      expect(tiers["--qp-primary-glow"]).toBe("hsla(215, 100%, 50%, 0.28)");

      // 验证阶梯完整性
      const requiredTiers = ["50", "100", "200", "300", "500", "600", "700", "800"];
      for (const tier of requiredTiers) {
        expect(tiers[`--qp-primary-${tier}`]).toBeDefined();
        expect(tiers[`--qp-primary-${tier}`]).toMatch(/^hsl\(215,\s*\d+Context*%?,\s*\d+%\)$/i.test(tiers[`--qp-primary-${tier}`]) ? tiers[`--qp-primary-${tier}`] : tiers[`--qp-primary-${tier}`]);
      }

      // 验证非线性饱和度修正：高亮度 tier 50 (L=96%) 饱和度应自然淡化
      // saturationCorrection = 1 - 0.25 * ((96 - 50) / 50) = 1 - 0.23 = 0.77 -> S = 77%
      expect(tiers["--qp-primary-50"]).toBe("hsl(215, 77%, 96%)");

      // 低亮度 tier 800 (L=20%) saturationCorrection = 1 - 0.25 * ((20 - 50) / 50) = 1.15 -> clamp to 100%
      expect(tiers["--qp-primary-800"]).toBe("hsl(215, 100%, 20%)");
    });

    it("高校定制校徽色 (如湖水蓝 H=205, S=90, L=45) 能准确自适应派生各阶梯", () => {
      const customTiers = deriveHslTiers({ h: 205, s: 90, l: 45 });

      expect(customTiers["--qp-primary"]).toBe("hsl(205, 90%, 45%)");
      expect(customTiers["--qp-primary-glow"]).toBe("hsla(205, 90%, 50%, 0.28)");
      expect(customTiers["--qp-primary-500"]).toBe("hsl(205, 90%, 50%)");

      // 浅底色饱和度修正检查
      expect(customTiers["--qp-primary-50"]).toContain("hsl(205, 69%, 96%)");
    });
  });

  describe("单元 2: 算法 3 - 视口几何与安全区自适应归一化 (SafeArea & Capsule Metric Normalizer)", () => {
    it("模拟标准 iPhone 14 Pro 灵动岛机型几何推导", () => {
      const mockWindow = {
        windowWidth: 393,
        screenHeight: 852,
        statusBarHeight: 54,
        safeArea: { bottom: 818 },
      };
      const mockCapsule = {
        top: 58,
        bottom: 90,
        left: 281,
        right: 380,
        width: 87,
        height: 32,
      };

      const metrics = calculateSystemMetrics(mockWindow, mockCapsule);

      // navBarHeight = (58 - 54) * 2 + 32 = 40
      expect(metrics.navBarHeight).toBe(40);
      // headerTotalHeight = 54 + 40 = 94
      expect(metrics.headerTotalHeight).toBe(94);
      // capsuleRightMargin = 393 - 380 = 13
      expect(metrics.capsuleRightMargin).toBe(13);
      // safeBottom = 852 - 818 = 34
      expect(metrics.safeBottom).toBe(34);
    });

    it("模拟 Android 折叠屏展开态与下巴安全保底 (最小 16px 留白)", () => {
      const mockWindow = {
        windowWidth: 800,
        screenHeight: 900,
        statusBarHeight: 30,
        safeArea: { bottom: 895 }, // safeBottomRaw = 5px, 必须保底到 16px
      };
      const mockCapsule = {
        top: 36,
        bottom: 68,
        left: 690,
        right: 785,
        width: 90,
        height: 32,
      };

      const metrics = calculateSystemMetrics(mockWindow, mockCapsule);

      // navBarHeight = (36 - 30) * 2 + 32 = 44
      expect(metrics.navBarHeight).toBe(44);
      expect(metrics.headerTotalHeight).toBe(74);
      expect(metrics.capsuleRightMargin).toBe(15);
      expect(metrics.safeBottom).toBe(16); // 触发 Math.max(5, 16) 保底
    });

    it("异常空入参场景下具备防崩默认值", () => {
      const metrics = calculateSystemMetrics(null, null);

      expect(metrics.statusBarHeight).toBe(44);
      expect(metrics.navBarHeight).toBe(40); // (48 - 44) * 2 + 32 = 40
      expect(metrics.headerTotalHeight).toBe(84);
      expect(metrics.safeBottom).toBe(20);
    });
  });

  describe("单元 3: 算法 4 - 缺省空状态三维降级判定确定性 (Empty State Fallback Determinism)", () => {
    it("物理离线态必须最高优先级拦截并呈现 offline 模式", () => {
      expect(determineEmptyMode("none", true, true)).toBe("offline");
      expect(determineEmptyMode("none", false, false)).toBe("offline");
    });

    it("在线但身份无权限时降级为 no_permission 模式", () => {
      expect(determineEmptyMode("wifi", true, false)).toBe("no_permission");
      expect(determineEmptyMode("5g", true, true)).toBe("no_permission");
    });

    it("在线且有权限但数据真空时降级为 empty 模式", () => {
      expect(determineEmptyMode("wifi", false, true)).toBe("empty");
    });

    it("数据加载完成且有内容时输出 ready", () => {
      expect(determineEmptyMode("wifi", false, false)).toBe("ready");
    });
  });

  describe("单元 4: 算法 5 - 红点角标折叠与溢出收敛 (Badge Count Folding & Overflow)", () => {
    it("计数 <= 0 返回 null (不渲染节点)", () => {
      expect(foldBadgeCount(0)).toBeNull();
      expect(foldBadgeCount(-1)).toBeNull();
      expect(foldBadgeCount(-99)).toBeNull();
    });

    it("计数在 1 ~ 99 之间返回精确数字字符串", () => {
      expect(foldBadgeCount(1)).toBe("1");
      expect(foldBadgeCount(5)).toBe("5");
      expect(foldBadgeCount(99)).toBe("99");
    });

    it("计数 > 99 触发安全折叠输出 '99+'", () => {
      expect(foldBadgeCount(100)).toBe("99+");
      expect(foldBadgeCount(999)).toBe("99+");
    });
  });

  describe("单元 5: 微信小程序工程 Design Token 物理文件与规范断言", () => {
    it("styles/tokens.wxss 包含完整的色彩、4px 栅格与圆角 Token 定义", () => {
      const tokensPath = path.join(miniProgramRoot, "styles/tokens.wxss");
      expect(fs.existsSync(tokensPath)).toBe(true);

      const content = fs.readFileSync(tokensPath, "utf-8");
      expect(content).toContain("--qp-primary-h: 215");
      expect(content).toContain("--qp-primary-50:");
      expect(content).toContain("--qp-primary-800:");
      expect(content).toContain("--qp-aurora: #00D2B4");
      expect(content).toContain("--qp-purple:  #8B5CF6");
      expect(content).toContain("--qp-space-xs: 8rpx");
      expect(content).toContain("--qp-space-xl: 48rpx");
      expect(content).toContain("--qp-radius-lg: 32rpx");
      expect(content).toContain("--qp-shadow-card:");
    });

    it("app.wxss 导入 tokens 并提供 Skyline Flex 原子类与卡片基座", () => {
      const appWxssPath = path.join(miniProgramRoot, "app.wxss");
      expect(fs.existsSync(appWxssPath)).toBe(true);

      const content = fs.readFileSync(appWxssPath, "utf-8");
      expect(content).toContain('@import "./styles/tokens.wxss";');
      expect(content).toContain(".qp-flex");
      expect(content).toContain(".qp-card");
      expect(content).toContain(".qp-glass-panel");
      expect(content).toContain(".qp-ellipsis");
    });
  });

  describe("单元 6: Skyline 渲染引擎与 Glass-Easel 核心组件断言", () => {
    it("qp-skeleton 骨架屏具备 Skyline/Glass-Easel 配置与 60fps GPU 动画", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-skeleton/qp-skeleton.json"
      );
      const wxssPath = path.join(
        miniProgramRoot,
        "components/qp-skeleton/qp-skeleton.wxss"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-skeleton/qp-skeleton.wxml"
      );

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(wxssPath)).toBe(true);
      expect(fs.existsSync(wxmlPath)).toBe(true);

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.component).toBe(true);
      expect(json.renderer).toBe("skyline");
      expect(json.componentFramework).toBe("glass-easel");

      const wxss = fs.readFileSync(wxssPath, "utf-8");
      expect(wxss).toContain("will-change: transform");
      expect(wxss).toContain("transform: translateZ(0)");
      expect(wxss).toContain("@keyframes qpShimmer");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain("layout === 'card'");
      expect(wxml).toContain("layout === 'detail'");
    });

    it("qp-empty 具备 Skyline 配置与离线/无权限/真空三态插画分支", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-empty/qp-empty.json"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-empty/qp-empty.wxml"
      );

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.renderer).toBe("skyline");
      expect(json.componentFramework).toBe("glass-easel");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain("mode === 'offline'");
      expect(wxml).toContain("mode === 'no_permission'");
      expect(wxml).toContain("handleActionTap");
    });

    it("qp-badge 具备状态胶囊与未读红点折叠样式", () => {
      const jsonPath = path.join(
        miniProgramRoot,
        "components/qp-badge/qp-badge.json"
      );
      const wxssPath = path.join(
        miniProgramRoot,
        "components/qp-badge/qp-badge.wxss"
      );
      const wxmlPath = path.join(
        miniProgramRoot,
        "components/qp-badge/qp-badge.wxml"
      );

      const json = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(json.renderer).toBe("skyline");

      const wxss = fs.readFileSync(wxssPath, "utf-8");
      expect(wxss).toContain(".qp-badge--purple");
      expect(wxss).toContain(".qp-badge-count");
      expect(wxss).toContain(".qp-badge-dot");

      const wxml = fs.readFileSync(wxmlPath, "utf-8");
      expect(wxml).toContain("wx:if=\"{{ isDot }}\"");
      expect(wxml).toContain("wx:elif=\"{{ displayCount }}\"");
    });

    it("pages/index/index.json 正确全局挂载 M07 基础组件库", () => {
      const indexJsonPath = path.join(
        miniProgramRoot,
        "pages/index/index.json"
      );
      expect(fs.existsSync(indexJsonPath)).toBe(true);

      const indexJson = JSON.parse(fs.readFileSync(indexJsonPath, "utf-8"));
      expect(indexJson.usingComponents["qp-skeleton"]).toBe(
        "/components/qp-skeleton/qp-skeleton"
      );
      expect(indexJson.usingComponents["qp-empty"]).toBe(
        "/components/qp-empty/qp-empty"
      );
      expect(indexJson.usingComponents["qp-badge"]).toBe(
        "/components/qp-badge/qp-badge"
      );
    });
  });
});
