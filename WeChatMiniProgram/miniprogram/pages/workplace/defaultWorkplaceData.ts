import { IWorkplaceCategoryGroup } from "./contracts/workplaceTypes";

export const defaultWorkplaceGroups: IWorkplaceCategoryGroup[] = [
  {
    categoryKey: "emergency",
    categoryTitle: "应急保障",
    subtitle: "特级抢修与险情应急通道",
    icon: "⚡",
    apps: [
      {
        id: 1,
        appCode: "app-patrol",
        name: "隐患抢修",
        icon: "⚡",
        category: "emergency",
        entryRoute: "/packages/apps/app-patrol/pages/create/index",
        accessStatus: "ACTIVE",
        badgeCount: 2,
        isPinned: true,
        sortOrder: 10
      },
      {
        id: 2,
        appCode: "app-emergency-chat",
        name: "突发险情",
        icon: "🚨",
        category: "emergency",
        entryRoute: "/packages/apps/app-chat/pages/group-room/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 11
      },
      {
        id: 3,
        appCode: "app-emergency-broadcast",
        name: "应急广播",
        icon: "📢",
        category: "emergency",
        entryRoute: "/packages/apps/app-space/pages/feed-stream/index?filter=emergency",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 12
      }
    ]
  },
  {
    categoryKey: "service",
    categoryTitle: "师生服务",
    subtitle: "校园生活报修与便民服务",
    icon: "💬",
    apps: [
      {
        id: 4,
        appCode: "app-feedback",
        name: "服务反馈",
        icon: "📝",
        category: "service",
        entryRoute: "/packages/apps/app-feedback/pages/create/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: true,
        sortOrder: 20
      },
      {
        id: 5,
        appCode: "app-space",
        name: "校园空间",
        icon: "💬",
        category: "service",
        entryRoute: "/packages/apps/app-space/pages/feed-stream/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 21
      },
      {
        id: 6,
        appCode: "app-lost-found",
        name: "失物招领",
        icon: "🔍",
        category: "service",
        entryRoute: "/packages/apps/app-space/pages/feed-stream/index?category=lost_found",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 22
      },
      {
        id: 7,
        appCode: "app-ai-assistant",
        name: "后勤指南",
        icon: "💡",
        category: "service",
        entryRoute: "/pages/ai-copilot/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 23
      }
    ]
  },
  {
    categoryKey: "daily",
    categoryTitle: "日常办公",
    subtitle: "巡查打卡与施工整改核验",
    icon: "🛠️",
    apps: [
      {
        id: 8,
        appCode: "app-inspection",
        name: "巡查打卡",
        icon: "📍",
        category: "daily",
        entryRoute: "/packages/apps/app-inspection/pages/scan-point/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: true,
        sortOrder: 30
      },
      {
        id: 9,
        appCode: "app-calendar",
        name: "智慧日历",
        icon: "📅",
        category: "daily",
        entryRoute: "/packages/apps/calendar/pages/calendar-view/index",
        accessStatus: "ACTIVE",
        badgeCount: 1,
        isPinned: false,
        sortOrder: 31
      },
      {
        id: 10,
        appCode: "app-master-desk",
        name: "施工交卷",
        icon: "🛠️",
        category: "daily",
        entryRoute: "/packages/apps/app-master-desk/pages/handle-submit/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 32
      },
      {
        id: 11,
        appCode: "app-patrol-review",
        name: "质检验收",
        icon: "📋",
        category: "daily",
        entryRoute: "/packages/apps/app-admin/pages/patrol-review/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 33
      },
      {
        id: 12,
        appCode: "app-attendance",
        name: "师傅考勤",
        icon: "⏱️",
        category: "daily",
        entryRoute: "/packages/apps/attendance/pages/punch/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 34
      }
    ]
  },
  {
    categoryKey: "management",
    categoryTitle: "管理驾驶",
    subtitle: "宏观大盘与人员多级审批",
    icon: "📊",
    apps: [
      {
        id: 13,
        appCode: "app-cockpit",
        name: "数据驾驶舱",
        icon: "📊",
        category: "management",
        entryRoute: "/packages/apps/dashboard/pages/macro-cockpit/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 40
      },
      {
        id: 14,
        appCode: "app-dispatch-center",
        name: "调度中台",
        icon: "👥",
        category: "management",
        entryRoute: "/packages/apps/app-admin/pages/patrol-review/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 41
      },
      {
        id: 15,
        appCode: "app-delay-audit",
        name: "延期审批",
        icon: "⏳",
        category: "management",
        entryRoute: "/packages/apps/app-patrol/pages/delay-apply/index",
        accessStatus: "ACTIVE",
        badgeCount: 0,
        isPinned: false,
        sortOrder: 42
      }
    ]
  }
];
