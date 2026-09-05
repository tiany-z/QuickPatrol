-- ==============================================================================
-- 高校后勤巡查e速办 v4.0 全新多租户数据库结构设计方案 (DDL Script)
-- 
-- 架构版本: v4.0 Multi-Tenant Enterprise SaaS Edition (含付费级别/配额与类QQ聊天体系)
-- 数据库引擎: MySQL 8.x (InnoDB, utf8mb4_unicode_ci)
-- 核心设计准则:
--   1. 租户隔离: 全表强制携带 `schoolId` (学校ID)，区分学校与校区 (campusId)。
--   2. 付费 SaaS 级别与到期管控: `schools` 表包含付费版本 (planLevel)、配额模式 (planType: limited/unlimited)、
--      月工单上限 (maxMonthlyPatrols) 及付费到期时间 (planExpireAt)。
--   3. 物理零外键 (Zero Foreign Keys): 绝对不使用物理外键 (FOREIGN KEY)，最多仅有自增主键 (PRIMARY KEY)，
--      各表之间完全通过逻辑字段关联，彻底消除外键引发的级联死锁与性能开销。
--   4. 数据库级原生约束 (DB-Level Constraints): 数据的完整性与合法性主要通过 MySQL 8.x 的
--      `NOT NULL`、`DEFAULT`、`UNIQUE KEY` 以及原生 `CHECK` 约束深度固化。
--   5. 分层权限体系: 系统管理员 (role=9) -> 学校管理员 (role=4) -> 校内职能角色 (permissions 表调度) -> 普通师生。
--   6. 类 QQ 专业工单协同聊天体系 (汲取 city_system 精髓): 支持消息撤回 (isWithDraw)、消息引用回复 (answerMessageId)、
--      多类型消息 (文本/图片/系统通知)、责任人主动发起沟通机制 (initiatedByHandler) 与未读数实时消除。
--   7. 多租户自适应大模型与专属高校后勤 AI Agent (智能助手中台): 学校管理员自主配置 OpenAI API Key / Base URL / Model，
--      提供专属 AI 问答工作台，内置 7 大带租户隔离的数据检索工具 (Tools / Function Calling)，智能解答全校后勤动态。
-- ==============================================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------------------------
-- 0. 创建并指定数据库
-- ------------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS `xc` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `xc`;

-- ==============================================================================
-- 1. 租户与付费 SaaS 基础设施领域 (Schools & Dicts)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 1: schools (学校租户核心主表 - 含付费级别与配额到期控制)
-- 说明: 顶层租户实体，由【系统管理员】开通、配额分配与到期续费管理
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `schools`;
CREATE TABLE `schools` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '学校租户唯一ID (schoolId 主键)',
  `code` VARCHAR(64) NOT NULL COMMENT '学校唯一英文代号/租户标识 (如: lcu, pku, thu, sdu)',
  `name` VARCHAR(128) NOT NULL COMMENT '学校官方全称 (如: 聊城大学)',
  `shortName` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '学校常用简称 (如: 聊大)',
  `logo` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '学校官方校徽 Logo 图片 URL',
  `domain` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '该高校绑定的专属二级域名 (如: lcu.xcesb.cn)',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '租户状态: 1正常启用, 0已冻结/暂停, -1已退订/到期锁定',
  `planLevel` TINYINT NOT NULL DEFAULT 0 COMMENT '付费版本级别: 0免费体验版(有限), 1基础专业版(有限配额), 2旗舰尊享版(无限配额)',
  `planType` VARCHAR(32) NOT NULL DEFAULT 'limited' COMMENT '配额模式: limited(有限配额), unlimited(无限配额)',
  `maxMonthlyPatrols` INT NOT NULL DEFAULT 100 COMMENT '每月允许提报工单总配额: -1为无限制, >0为具体额度上限',
  `storageQuotaMb` INT NOT NULL DEFAULT 1024 COMMENT '专属 OSS 存储容量上限配额 (单位: MB, -1为无限)',
  `planExpireAt` DATETIME NOT NULL COMMENT '付费服务有效到期时间',
  `configJson` JSON DEFAULT NULL COMMENT '学校个性化扩展配置 (微信 appId/secret, OSS 路径, 提示文案等)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入驻创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_code` (`code`),
  INDEX `idx_school_status` (`status`, `isDeleted`),
  INDEX `idx_school_expire` (`planExpireAt`, `status`),
  CONSTRAINT `chk_school_status` CHECK (`status` IN (-1, 0, 1)),
  CONSTRAINT `chk_school_plan` CHECK (`planLevel` IN (0, 1, 2)),
  CONSTRAINT `chk_school_plantype` CHECK (`planType` IN ('limited', 'unlimited')),
  CONSTRAINT `chk_school_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学校租户核心主表 (含付费级别与到期管控, 无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 2: campuses (校区字典表)
-- 说明: 依附于具体学校的物理校区 (由【学校管理员】维护)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `campuses`;
CREATE TABLE `campuses` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '校区ID (campusId 主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `name` VARCHAR(128) NOT NULL COMMENT '校区名称 (如: 东校区, 西校区)',
  `address` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '校区详细物理地址',
  `sortOrder` INT NOT NULL DEFAULT 0 COMMENT '展示排序序号 (数值越小越靠前)',
  `scanCodeCount` INT NOT NULL DEFAULT 0 COMMENT '累计巡查点位扫码打卡次数',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_campus` (`schoolId`, `isDeleted`, `sortOrder`),
  CONSTRAINT `chk_campus_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='高校下属校区字典表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 3: departments (职能部门表)
-- 说明: 学校下辖后勤科室 (如后勤保障处、动力能源科，由【学校管理员】维护)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `departments`;
CREATE TABLE `departments` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '部门ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `parentId` INT DEFAULT NULL COMMENT '父部门ID (为null表示组织架构顶级根部门)',
  `path` VARCHAR(512) NOT NULL DEFAULT '/' COMMENT '树状层级路径编码 (如 /1/ 或 /1/3/)',
  `name` VARCHAR(128) NOT NULL COMMENT '部门全称 (如: 后勤保障处, 动力中心, 水电科)',
  `category` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '部门业务属性分类',
  `contactPhone` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '值班/联系对外电话',
  `leaderId` INT DEFAULT NULL COMMENT '部门主管用户ID (逻辑关联 users.id)',
  `sortOrder` INT NOT NULL DEFAULT 0 COMMENT '展示排序权重',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_dept` (`schoolId`, `isDeleted`, `sortOrder`),
  INDEX `idx_school_dept_parent` (`schoolId`, `parentId`, `isDeleted`),
  INDEX `idx_school_dept_path` (`schoolId`, `path`),
  CONSTRAINT `chk_dept_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学校后勤树状职能部门表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 4: categories (故障巡查类别表)
-- 说明: 报修故障门类 (如水电暖、绿化保洁、道路破损，由【学校管理员】维护)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '分类ID (categoryId 主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `name` VARCHAR(128) NOT NULL COMMENT '分类名称 (如: 水电暖维修, 绿化环卫)',
  `icon` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '分类图标或 URL 资源',
  `defaultDays` INT NOT NULL DEFAULT 3 COMMENT '工单默认整改考核时限 (单位: 天)',
  `sortOrder` INT NOT NULL DEFAULT 0 COMMENT '展示排序权重',
  `scanCodeCount` INT NOT NULL DEFAULT 0 COMMENT '关联扫码总频次',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_category` (`schoolId`, `isDeleted`, `sortOrder`),
  CONSTRAINT `chk_category_days` CHECK (`defaultDays` > 0),
  CONSTRAINT `chk_category_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故障巡查类别字典表 (无物理外键)';

-- ==============================================================================
-- 2. 用户与多层级权限调度领域 (Users & Multi-Tier RBAC)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 5: users (师生与各级管理员主表)
-- 说明: 融合四级权限架构:
--   role = 9: 系统管理员 (Platform Super Admin, 平台级超管, 可跨校纳管与配置)
--   role = 4: 学校管理员 (School Admin, 校级超管, 统领本校全部校区与管理员)
--   role = 3: 原版校内业务管理员 (科室负责人/调度角色)
--   role = 2: 维修外协师傅 / 现场工程人员
--   role = 1: 教职员工
--   role = 0: 普通在校学生
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '用户主键ID (userId)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 系统管理员可为 0)',
  `openId` VARCHAR(128) NOT NULL COMMENT '微信小程序 openId',
  `unionId` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '微信开放平台统一 unionId',
  `realName` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '真实姓名 / 职工姓名',
  `nickName` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '微信昵称',
  `avatarUrl` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '用户头像 URL',
  `phone` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '手机联系电话',
  `jobNo` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '学号 / 工号 (高校统一身份认证)',
  `role` TINYINT NOT NULL DEFAULT 0 COMMENT '层级身份角色: 0学生, 1教职工, 2维修人员, 3科室管理员, 4学校管理员, 9系统管理员',
  `departmentId` INT NOT NULL DEFAULT 0 COMMENT '所属部门ID (逻辑关联 departments.id)',
  `isBan` TINYINT NOT NULL DEFAULT 0 COMMENT '账号状态: 0正常, 1已封禁禁止使用',
  `loginTime` INT NOT NULL DEFAULT 0 COMMENT '累计登录次数',
  `lastLoginTime` DATETIME DEFAULT NULL COMMENT '最后一次登录时间',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_openid` (`schoolId`, `openId`),
  INDEX `idx_school_role` (`schoolId`, `role`, `isDeleted`),
  INDEX `idx_school_phone` (`schoolId`, `phone`),
  INDEX `idx_school_jobno` (`schoolId`, `jobNo`),
  CONSTRAINT `chk_user_role` CHECK (`role` IN (0, 1, 2, 3, 4, 9)),
  CONSTRAINT `chk_user_ban` CHECK (`isBan` IN (0, 1)),
  CONSTRAINT `chk_user_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户主表 (四级权限架构, 无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 6: permissions (四维业务权限与派单调度表)
-- 说明: 映射关系: schoolId × userId × campusId × categoryId × type
--   由【学校管理员】配置具体某个用户在某个校区负责某类问题的权限:
--   type = 1: 工单责任人 / 维修处理人 (整改施工接单、主动发起聊天)
--   type = 2: 验收复核人 / 质检验收人 (到场核验通过与驳回)
--   type = 3: 业务监督人 / 抄送报表查看人
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `permissions`;
CREATE TABLE `permissions` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '权限记录自增ID',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `userId` INT NOT NULL DEFAULT 0 COMMENT '被指派的用户ID (逻辑关联 users.id, 0 代表按岗位标签调度)',
  `tagId` INT DEFAULT NULL COMMENT '关联岗位标签ID (逻辑关联 tags.id, 支撑权限随岗不随人解耦模式)',
  `campusId` INT NOT NULL DEFAULT 0 COMMENT '关联校区ID (逻辑关联 campuses.id, 0 代表本校所有校区通配)',
  `categoryId` INT NOT NULL DEFAULT 0 COMMENT '关联分类ID (逻辑关联 categories.id, 0 代表所有分类通配)',
  `type` TINYINT NOT NULL COMMENT '业务权限类型: 1工单处理人, 2验收复核人, 3报表抄送人',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_user` (`schoolId`, `userId`),
  INDEX `idx_school_tag` (`schoolId`, `tagId`),
  INDEX `idx_school_dispatch` (`schoolId`, `campusId`, `categoryId`, `type`),
  CONSTRAINT `chk_perm_type` CHECK (`type` IN (1, 2, 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='四维业务权限派单调度表 (支持人员与标签双模, 无物理外键)';

-- ==============================================================================
-- 3. 核心工单状态机与流转领域 (Patrol Work Orders)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 7: patrols (巡查工单核心主表)
-- 说明: 核心工单状态机，记录全生命周期状态
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `patrols`;
CREATE TABLE `patrols` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '工单主键ID (patrolId)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `campusId` INT NOT NULL COMMENT '发生校区ID (逻辑关联 campuses.id)',
  `categoryId` INT NOT NULL COMMENT '故障分类ID (逻辑关联 categories.id)',
  `orderNo` VARCHAR(64) NOT NULL COMMENT '工单业务编号 (如: LCU-20260905-0001)',
  `creatorId` INT NOT NULL COMMENT '提报人用户ID (逻辑关联 users.id)',
  `title` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '问题简要标题',
  `desc` LONGTEXT NOT NULL COMMENT '故障详细文字描述',
  `imagesJson` JSON DEFAULT NULL COMMENT '现场勘验照片 URL 列表 (JSON 数组, 取代旧版 image1~5 硬编码)',
  `location1` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '一级区域地点 (如: 11号教学楼)',
  `location2` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '二级精准点位 (如: 3楼西侧男卫生间)',
  `latitude` DECIMAL(10, 7) DEFAULT NULL COMMENT '提报 GPS 纬度',
  `longitude` DECIMAL(10, 7) DEFAULT NULL COMMENT '提报 GPS 经度',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '工单状态: 0待处理, 1处理中, 2已整改待复核, 3已办结, 4已评价结案, 5复核驳回重新施工',
  `currentHandlerId` INT NOT NULL DEFAULT 0 COMMENT '当前责任处理人ID (逻辑关联 users.id)',
  `currentReviewerId` INT NOT NULL DEFAULT 0 COMMENT '当前复核人ID (逻辑关联 users.id)',
  `deadline` DATETIME DEFAULT NULL COMMENT '处理截止时限',
  `priorityLevel` TINYINT NOT NULL DEFAULT 1 COMMENT '优先级: 0普通, 1中等, 2加急(特急)',
  `isPublic` TINYINT NOT NULL DEFAULT 1 COMMENT '是否公开至校园广场: 1公开透明(未登录可查评), 0仅内部可见',
  `completedAt` DATETIME DEFAULT NULL COMMENT '最终验收复核办结时间',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上报时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_orderno` (`schoolId`, `orderNo`),
  INDEX `idx_school_status_created` (`schoolId`, `status`, `createdAt`),
  INDEX `idx_school_campus_cat` (`schoolId`, `campusId`, `categoryId`, `status`),
  INDEX `idx_school_creator` (`schoolId`, `creatorId`, `status`),
  INDEX `idx_school_handler` (`schoolId`, `currentHandlerId`, `status`),
  INDEX `idx_school_deadline` (`schoolId`, `status`, `deadline`),
  CONSTRAINT `chk_patrol_status` CHECK (`status` BETWEEN 0 AND 5),
  CONSTRAINT `chk_patrol_priority` CHECK (`priorityLevel` IN (0, 1, 2)),
  CONSTRAINT `chk_patrol_public` CHECK (`isPublic` IN (0, 1)),
  CONSTRAINT `chk_patrol_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='巡查工单核心主表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 8: patrols_handle (整改处理记录表)
-- 说明: 责任人完工整改后提交的凭证记录
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `patrols_handle`;
CREATE TABLE `patrols_handle` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '整改记录ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `patrolId` INT NOT NULL COMMENT '关联工单ID (逻辑关联 patrols.id)',
  `handlerId` INT NOT NULL COMMENT '实际施工人用户ID (逻辑关联 users.id)',
  `content` LONGTEXT NOT NULL COMMENT '整改措施及处理过程说明',
  `imagesJson` JSON DEFAULT NULL COMMENT '整改完工现场照片 URL 列表 (JSON Array)',
  `durationHours` DECIMAL(6, 2) NOT NULL DEFAULT 0.00 COMMENT '施工实际耗时 (单位: 小时)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '提交整改时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_patrol` (`schoolId`, `patrolId`),
  INDEX `idx_school_handler` (`schoolId`, `handlerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='巡查工单整改处理记录表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 9: patrols_review (复核验收记录表)
-- 说明: 审核人对整改效果进行现场复核与评定
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `patrols_review`;
CREATE TABLE `patrols_review` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '复核记录ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `patrolId` INT NOT NULL COMMENT '关联工单ID (逻辑关联 patrols.id)',
  `reviewerId` INT NOT NULL COMMENT '复核人用户ID (逻辑关联 users.id)',
  `isPassed` TINYINT NOT NULL COMMENT '复核结果: 1合格办结, 0不合格驳回重新整改',
  `remark` LONGTEXT NOT NULL COMMENT '复核评估意见或驳回原因',
  `imagesJson` JSON DEFAULT NULL COMMENT '复核现场补充照片 (JSON Array)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '复核时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_patrol` (`schoolId`, `patrolId`),
  INDEX `idx_school_reviewer` (`schoolId`, `reviewerId`),
  CONSTRAINT `chk_review_passed` CHECK (`isPassed` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单复核验收审批记录表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 10: feedbacks (工单满意度评价表)
-- 说明: 师生对办结工单服务质量的打分与评价
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `feedbacks`;
CREATE TABLE `feedbacks` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '评价ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `patrolId` INT NOT NULL COMMENT '关联工单ID (逻辑关联 patrols.id)',
  `userId` INT NOT NULL COMMENT '评价人用户ID (逻辑关联 users.id)',
  `score` TINYINT NOT NULL DEFAULT 5 COMMENT '综合评分 (1~5 星)',
  `speedScore` TINYINT NOT NULL DEFAULT 5 COMMENT '响应时效评分 (1~5 星)',
  `qualityScore` TINYINT NOT NULL DEFAULT 5 COMMENT '施工质量评分 (1~5 星)',
  `attitudeScore` TINYINT NOT NULL DEFAULT 5 COMMENT '服务态度评分 (1~5 星)',
  `comment` LONGTEXT NOT NULL COMMENT '用户详细心得评语',
  `tagsJson` JSON DEFAULT NULL COMMENT '满意度标签数组 (JSON Array)',
  `isAutoPassed` TINYINT NOT NULL DEFAULT 0 COMMENT '是否为超时未评系统自动默认好评: 0自主评价, 1系统自动',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '评价时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_patrol` (`schoolId`, `patrolId`),
  INDEX `idx_school_user` (`schoolId`, `userId`),
  INDEX `idx_school_score` (`schoolId`, `score`),
  CONSTRAINT `chk_feedback_score` CHECK (`score` BETWEEN 1 AND 5),
  CONSTRAINT `chk_feedback_speed` CHECK (`speedScore` BETWEEN 1 AND 5),
  CONSTRAINT `chk_feedback_quality` CHECK (`qualityScore` BETWEEN 1 AND 5),
  CONSTRAINT `chk_feedback_attitude` CHECK (`attitudeScore` BETWEEN 1 AND 5),
  CONSTRAINT `chk_feedback_auto` CHECK (`isAutoPassed` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单满意度服务评价表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 11: patrol_delay_records (工单延期申请与审批记录表)
-- 说明: 支持多次延期由【学校管理员】线上审批
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `patrol_delay_records`;
CREATE TABLE `patrol_delay_records` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '延期申请ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `patrolId` INT NOT NULL COMMENT '关联工单ID (逻辑关联 patrols.id)',
  `applicantId` INT NOT NULL COMMENT '申请责任人ID (逻辑关联 users.id)',
  `reason` LONGTEXT NOT NULL COMMENT '申请延期客观详细原因',
  `delayHours` INT NOT NULL COMMENT '申请延期时长 (单位: 小时)',
  `oldDeadline` DATETIME NOT NULL COMMENT '原处理截止时限',
  `newDeadline` DATETIME NOT NULL COMMENT '申请目标截止时限',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '审批状态: 0待审核, 1已同意延期, 2已驳回申请',
  `reviewerId` INT NOT NULL DEFAULT 0 COMMENT '审批人ID (学校管理员 users.id)',
  `reviewRemark` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '审批意见批注',
  `reviewedAt` DATETIME DEFAULT NULL COMMENT '审批时间',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '申请发起时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_patrol` (`schoolId`, `patrolId`),
  INDEX `idx_school_status` (`schoolId`, `status`),
  CONSTRAINT `chk_delay_status` CHECK (`status` IN (0, 1, 2)),
  CONSTRAINT `chk_delay_hours` CHECK (`delayHours` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单延期申请审批表 (无物理外键)';

-- ==============================================================================
-- 4. 类 QQ 专业工单协同聊天体系 (参考 city_system 架构重构)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 12: chat_rooms (工单协同聊天室会话表)
-- 说明: 核心协同控制机制:
--   1. 责任人主动发起机制: 初始工单由提报人提交后处于静默态，由【负责处理的人员】点击“主动联络提报人”后激活 (initiatedByHandler = 1)。
--   2. 支持后勤人员置顶会话 (isPinned)、会话归档。
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `chat_rooms`;
CREATE TABLE `chat_rooms` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '会话室ID (chatRoomId 主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `roomType` VARCHAR(16) NOT NULL DEFAULT 'patrol' COMMENT '会话场景类型: patrol工单协同, direct单聊, group科室/突发抢险群聊',
  `title` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '群聊名称或会话专属标题 (可选)',
  `patrolId` INT DEFAULT NULL COMMENT '关联工单ID (逻辑关联 patrols.id, patrol类型必填, direct/group类型为NULL)',
  `creatorId` INT NOT NULL COMMENT '工单提报人/私聊发起人ID (师生 users.id)',
  `handlerId` INT NOT NULL DEFAULT 0 COMMENT '承接责任人/单聊对象ID (维修师傅 users.id)',
  `initiatedByHandler` TINYINT NOT NULL DEFAULT 0 COMMENT '责任人是否已主动发起聊天: 0未激活(静默防骚扰), 1已由处理人主动激活开启',
  `isClosed` TINYINT NOT NULL DEFAULT 0 COMMENT '会话状态: 0开启中, 1工单结案归档关闭',
  `isPinned` TINYINT NOT NULL DEFAULT 0 COMMENT '后勤师傅端是否置顶此会话: 1置顶, 0普通',
  `creatorUnreadCount` INT NOT NULL DEFAULT 0 COMMENT '师生端积攒未读消息数',
  `handlerUnreadCount` INT NOT NULL DEFAULT 0 COMMENT '后勤师傅端积攒未读消息数',
  `lastMessage` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '最新一条消息摘要 (用于类QQ会话列表预览)',
  `lastMessageAt` DATETIME DEFAULT NULL COMMENT '最后活跃时间 (用于会话列表倒序排序)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_patrol` (`schoolId`, `patrolId`),
  INDEX `idx_school_room_type` (`schoolId`, `roomType`, `isClosed`),
  INDEX `idx_school_handler_active` (`schoolId`, `handlerId`, `isPinned`, `lastMessageAt`),
  INDEX `idx_school_creator_active` (`schoolId`, `creatorId`, `lastMessageAt`),
  CONSTRAINT `chk_room_type` CHECK (`roomType` IN ('patrol', 'direct', 'group')),
  CONSTRAINT `chk_room_init` CHECK (`initiatedByHandler` IN (0, 1)),
  CONSTRAINT `chk_room_closed` CHECK (`isClosed` IN (0, 1)),
  CONSTRAINT `chk_room_pinned` CHECK (`isPinned` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='企业级多场景即时协同会话室表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 13: chat_messages (工单协同聊天消息明细流水表 - 深度参考 city_system)
-- 说明: 支持全套专业 IM 能力:
--   - 消息类型: 0文本, 1图片, 2工单进度卡片, 3系统通知
--   - 消息撤回机制 (isWithDraw = 1): 2分钟内可撤回，内容不外发，前端展示“消息已撤回”
--   - 消息引用回复 (answerMessageId): 针对某条消息发起引用讨论，若被引用消息撤回，前端优雅降级
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `chat_messages`;
CREATE TABLE `chat_messages` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '消息自增ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `chatRoomId` INT NOT NULL COMMENT '关联会话室ID (逻辑关联 chat_rooms.id)',
  `senderId` INT NOT NULL COMMENT '发送人ID (逻辑关联 users.id, 0代表系统)',
  `senderRole` TINYINT NOT NULL DEFAULT 0 COMMENT '发送身份: 0师生, 1责任人师傅, 2审核人, 4学校管理员, 9系统广播',
  `type` TINYINT NOT NULL DEFAULT 0 COMMENT '消息类型: 0文本, 1图片直链, 2工单卡片, 3系统通知(居中灰色药丸)',
  `content` LONGTEXT NOT NULL COMMENT '消息正文内容 (或 OSS 图片直链/卡片 JSON)',
  `answerMessageId` INT NOT NULL DEFAULT 0 COMMENT '引用的前序消息ID (0为无引用, >0为所引用的 chat_messages.id)',
  `isWithDraw` TINYINT NOT NULL DEFAULT 0 COMMENT '是否已被撤回: 0正常显示, 1已撤回 (内容屏蔽)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '消息发送时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_room_msg` (`schoolId`, `chatRoomId`, `id`),
  INDEX `idx_school_answer` (`schoolId`, `answerMessageId`),
  CONSTRAINT `chk_msg_type` CHECK (`type` IN (0, 1, 2, 3)),
  CONSTRAINT `chk_msg_withdraw` CHECK (`isWithDraw` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单协同聊天消息明细表 (支持引用与撤回, 无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 14: messages (站内通知与离线智能穿透流水表)
-- 说明: 汇聚全微应用事件通知，结合用户在线感知执行防骚扰或外部离线穿透
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '消息通知ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `receiverId` INT NOT NULL COMMENT '接收人ID (逻辑关联 users.id)',
  `appId` VARCHAR(32) NOT NULL DEFAULT 'app-patrol' COMMENT '来源微应用: app-patrol, app-feedback, app-inspection, system',
  `patrolId` INT NOT NULL DEFAULT 0 COMMENT '关联工单ID (可选)',
  `title` VARCHAR(128) NOT NULL COMMENT '通知标题',
  `content` LONGTEXT NOT NULL COMMENT '通知正文内容',
  `cardPayloadJson` JSON DEFAULT NULL COMMENT '富交互结构化卡片载荷数据 (包含卡片头/状态/键值对/交互按钮组/原地变更状态)',
  `linkUrl` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '小程序内跳路径',
  `priority` VARCHAR(16) NOT NULL DEFAULT 'normal' COMMENT '优先级: low, normal, urgent',
  `isRead` TINYINT NOT NULL DEFAULT 0 COMMENT '阅读状态: 0未读, 1已读',
  `readAt` DATETIME DEFAULT NULL COMMENT '阅读时间',
  `externalPushStatus` VARCHAR(16) NOT NULL DEFAULT 'none' COMMENT '外部穿透状态: none(仅站内), wx_sent(微信模板), sms_sent(短信降级), failed',
  `smsSent` TINYINT NOT NULL DEFAULT 0 COMMENT '是否发送短信: 0否, 1是',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_receiver_read` (`schoolId`, `receiverId`, `isRead`, `createdAt`),
  INDEX `idx_school_app_time` (`schoolId`, `appId`, `createdAt`),
  CONSTRAINT `chk_msg_read` CHECK (`isRead` IN (0, 1)),
  CONSTRAINT `chk_msg_sms` CHECK (`smsSent` IN (0, 1)),
  CONSTRAINT `chk_msg_priority` CHECK (`priority` IN ('low', 'normal', 'urgent')),
  CONSTRAINT `chk_msg_push` CHECK (`externalPushStatus` IN ('none', 'wx_sent', 'sms_sent', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内通知与离线智能穿透流水表 (无物理外键)';

-- ==============================================================================
-- 5. 校园公开广场（双轨合一：未登录公开浏览与评论）社交互动领域
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 15: posts (校园广场公开动态瀑布流表)
-- 说明: 未登录访客可在小程序公开浏览全校报修对比，公开透明监督
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `posts`;
CREATE TABLE `posts` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '动态ID (postId 主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `creatorId` INT NOT NULL COMMENT '发布人用户ID (逻辑关联 users.id)',
  `patrolId` INT NOT NULL DEFAULT 0 COMMENT '关联巡查工单ID (由工单联动转广场则绑定)',
  `title` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '动态标题/主题',
  `content` LONGTEXT NOT NULL COMMENT '动态内容正文',
  `imagesJson` JSON DEFAULT NULL COMMENT '展示相册图片列表 (JSON Array)',
  `likeCount` INT NOT NULL DEFAULT 0 COMMENT '点赞总频次 (冗余字段提升极速读性能)',
  `commentCount` INT NOT NULL DEFAULT 0 COMMENT '评论总频次 (冗余字段)',
  `viewCount` INT NOT NULL DEFAULT 0 COMMENT '浏览浏览量',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '发布状态: 1正常展示, 0待审核, -1违规下架',
  `isTop` TINYINT NOT NULL DEFAULT 0 COMMENT '是否置顶: 1置顶, 0普通',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_feed` (`schoolId`, `status`, `isDeleted`, `isTop`, `createdAt`),
  INDEX `idx_school_creator` (`schoolId`, `creatorId`),
  CONSTRAINT `chk_post_status` CHECK (`status` IN (-1, 0, 1)),
  CONSTRAINT `chk_post_top` CHECK (`isTop` IN (0, 1)),
  CONSTRAINT `chk_post_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='校园广场公开动态瀑布流表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 16: post_comments (广场动态评论表 - 支持未登录/访客微信快捷评论)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `post_comments`;
CREATE TABLE `post_comments` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '评论自增ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `postId` INT NOT NULL COMMENT '关联动态ID (逻辑关联 posts.id)',
  `userId` INT NOT NULL COMMENT '评论发表人ID (已登录关联 users.id, 0为访客身份)',
  `guestNick` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '访客微信临时昵称 (未登录用户发表)',
  `guestAvatar` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '访客微信临时头像 (未登录用户发表)',
  `replyCommentId` INT NOT NULL DEFAULT 0 COMMENT '回复上级评论ID (0为根评论)',
  `content` LONGTEXT NOT NULL COMMENT '评论文字内容',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '评论时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_post_comment` (`schoolId`, `postId`, `isDeleted`, `createdAt`),
  CONSTRAINT `chk_comment_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='校园广场动态评论表 (支持公开监督评论, 无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 17: post_likes (广场动态点赞记录表)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `post_likes`;
CREATE TABLE `post_likes` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '点赞自增ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `postId` INT NOT NULL COMMENT '关联动态ID (逻辑关联 posts.id)',
  `userId` INT NOT NULL COMMENT '点赞用户ID (逻辑关联 users.id)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '点赞时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_post_user` (`schoolId`, `postId`, `userId`),
  INDEX `idx_school_user` (`schoolId`, `userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='校园广场动态点赞记录表 (无物理外键)';

-- ==============================================================================
-- 6. 配置中心、审计日志与线下巡检点位领域 (Config & Infrastructure)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- ------------------------------------------------------------------------------
-- 表 18: school_settings (学校多租户自定义参数与 OpenAI 大模型配置表)
-- 说明: 各高校独立维护其系统参数及专属 OpenAI API 配置 (API Key, Base URL, Model, Prompt)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `school_settings`;
CREATE TABLE `school_settings` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '配置自增ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `key` VARCHAR(64) NOT NULL COMMENT '配置参数 Key (如: ai_api_key, ai_base_url, ai_model, auto_pass_days, service_phone)',
  `value` LONGTEXT NOT NULL COMMENT '配置参数具体内容 (API Key 等敏感数据支持 AES-256 加密密文存储)',
  `desc` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '参数中文说明',
  `isEncrypted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否敏感加密存储: 0明文, 1密文',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_key` (`schoolId`, `key`),
  CONSTRAINT `chk_setting_encrypted` CHECK (`isEncrypted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学校自定义参数与大模型AI配置表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 19: operation_logs (多租户关键操作与审计追踪日志表)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `operation_logs`;
CREATE TABLE `operation_logs` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '日志ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `userId` INT NOT NULL COMMENT '操作人用户ID (逻辑关联 users.id)',
  `action` VARCHAR(64) NOT NULL COMMENT '动作类型 (如: REASSIGN, BAN_USER, APPROVE_DELAY, WITHDRAW_MSG)',
  `module` VARCHAR(64) NOT NULL COMMENT '模块名称 (如: Patrol, User, Permission, Chat, AI)',
  `ip` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '客户端公网 IP 地址',
  `payloadJson` JSON DEFAULT NULL COMMENT '参数变更前后核心快照',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_action_time` (`schoolId`, `module`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='多租户审计操作日志表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 20: patrol_qrcode_points (线下固定巡检资产点位二维码表)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `patrol_qrcode_points`;
CREATE TABLE `patrol_qrcode_points` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '点位自增ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `campusId` INT NOT NULL COMMENT '所属校区ID (逻辑关联 campuses.id)',
  `name` VARCHAR(128) NOT NULL COMMENT '点位名称 (如: 西校区1号高压配电房)',
  `code` VARCHAR(64) NOT NULL COMMENT '点位唯一识别编号',
  `location` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '具体物理空间定位',
  `categoryId` INT NOT NULL DEFAULT 0 COMMENT '默认推荐故障分类ID (逻辑关联 categories.id)',
  `qrcodeUrl` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '微信小程序码图片直链',
  `scanCount` INT NOT NULL DEFAULT 0 COMMENT '累计巡查打卡扫码次数',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '布设时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_code` (`schoolId`, `code`),
  INDEX `idx_school_campus` (`schoolId`, `campusId`, `isDeleted`),
  CONSTRAINT `chk_point_deleted` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线下巡检点位二维码表 (无物理外键)';

-- ==============================================================================
-- 7. 高校专属 AI Agent 智能助手问答领域 (AI Copilot & Tool Calling)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 21: ai_agent_sessions (AI 智能助手多轮会话表)
-- 说明: 记录师生/管理员与学校 AI Agent 交互的多轮会话上下文
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `ai_agent_sessions`;
CREATE TABLE `ai_agent_sessions` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '会话ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `userId` INT NOT NULL COMMENT '发起提问用户ID (逻辑关联 users.id)',
  `title` VARCHAR(128) NOT NULL DEFAULT '新后勤咨询会话' COMMENT '会话标题/摘要',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_user_ai` (`schoolId`, `userId`, `isDeleted`, `updatedAt`),
  CONSTRAINT `chk_ai_session_del` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI助手多轮问答会话表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 22: ai_agent_messages (AI 智能助手对话流与工具调用审计表)
-- 说明: 记录对话历史及 Agent 触发的 Tool-Calling (查询工单、统计、部门等) 详情
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `ai_agent_messages`;
CREATE TABLE `ai_agent_messages` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '消息明细ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `sessionId` INT NOT NULL COMMENT '所属会话ID (逻辑关联 ai_agent_sessions.id)',
  `role` VARCHAR(32) NOT NULL COMMENT '消息角色: user, assistant, tool, system',
  `content` LONGTEXT NOT NULL COMMENT '消息内容正文 (支持 Markdown 渲染与卡片交互)',
  `toolCallsJson` JSON DEFAULT NULL COMMENT '模型发起的工具调用列表 (工具名与入参 JSON)',
  `toolResultsJson` JSON DEFAULT NULL COMMENT '后端带租户隔离执行工具返回的数据快照 (JSON)',
  `tokensUsed` INT NOT NULL DEFAULT 0 COMMENT '单次推断消耗 Token 总量',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '消息产生时间',
  PRIMARY KEY (`id`),
  INDEX `idx_school_session_msg` (`schoolId`, `sessionId`, `id`),
  CONSTRAINT `chk_ai_msg_role` CHECK (`role` IN ('user', 'assistant', 'tool', 'system'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI助手消息流水与工具调用审计表 (无物理外键)';

-- ==============================================================================
-- 8. 递点组织中台与全场景协同领域 (Tags, Tag Members & Group IM)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 23: tags (组织职能岗位标签表)
-- 说明: 支撑“权限随岗而不随人 (Decoupling Logic)”，解耦业务流与具体人员
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `tags`;
CREATE TABLE `tags` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '标签ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `name` VARCHAR(64) NOT NULL COMMENT '标签名称 (如: 水电抢修负责人, 质检复核组长, 防汛紧急联络人)',
  `color` VARCHAR(32) NOT NULL DEFAULT '#0078D7' COMMENT '视觉标识色 (Windows Metro UI 调色板 HEX)',
  `desc` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '职能职责描述',
  `sortOrder` INT NOT NULL DEFAULT 0 COMMENT '展示排序权重',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_tag` (`schoolId`, `name`),
  INDEX `idx_school_tag_del` (`schoolId`, `isDeleted`, `sortOrder`),
  CONSTRAINT `chk_tag_del` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织职能岗位标签表 (权限随岗不随人, 无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 24: tag_members (标签成员动态映射表)
-- 说明: 人员流动轮岗时，仅需在此表转移标签记录，工单派单网关与通知目标即时无缝平移
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `tag_members`;
CREATE TABLE `tag_members` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '映射ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `tagId` INT NOT NULL COMMENT '关联标签ID (逻辑关联 tags.id)',
  `userId` INT NOT NULL COMMENT '关联用户ID (逻辑关联 users.id)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '绑定时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_tag_user` (`schoolId`, `tagId`, `userId`),
  INDEX `idx_school_user_tag` (`schoolId`, `userId`),
  INDEX `idx_school_tag_mem` (`schoolId`, `tagId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标签成员动态映射表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 25: chat_group_members (群聊成员关系档案表)
-- 说明: 支撑科室协同工作群与突发抢险应急群聊成员档案与角色
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `chat_group_members`;
CREATE TABLE `chat_group_members` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '群成员记录ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `chatRoomId` INT NOT NULL COMMENT '关联群聊会话ID (逻辑关联 chat_rooms.id)',
  `userId` INT NOT NULL COMMENT '群成员用户ID (逻辑关联 users.id)',
  `role` TINYINT NOT NULL DEFAULT 0 COMMENT '群内角色: 0普通成员, 1群管理员, 2群主',
  `nickInGroup` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '群内专属昵称 (可选)',
  `joinedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入群时间',
  `lastReadMessageId` INT NOT NULL DEFAULT 0 COMMENT '已读消息最后游标ID',
  `isMuted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否免打扰: 0接收并提醒, 1免打扰',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_user` (`schoolId`, `chatRoomId`, `userId`),
  INDEX `idx_school_user_group` (`schoolId`, `userId`),
  INDEX `idx_school_room_mem` (`schoolId`, `chatRoomId`),
  CONSTRAINT `chk_group_role` CHECK (`role` IN (0, 1, 2)),
  CONSTRAINT `chk_group_muted` CHECK (`isMuted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群聊成员关系档案表 (无物理外键)';

-- ==============================================================================
-- 9. 飞书式工作台微应用注册与全景日历日程领域 (Workplace Apps & Schedules)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 表 26: apps (飞书式工作台微应用元数据注册表)
-- 说明: 支撑子功能像飞书微应用一样独立解耦注册、权限门禁与宫格聚合
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `apps`;
CREATE TABLE `apps` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '微应用注册ID (主键)',
  `schoolId` INT NOT NULL DEFAULT 0 COMMENT '所属学校ID (0: 全平台通用应用, >0: 租户专属定制微应用)',
  `appCode` VARCHAR(64) NOT NULL COMMENT '微应用唯一标识代码 (如: app-patrol, app-feedback, app-inspection, app-calendar, app-space, app-cockpit)',
  `name` VARCHAR(64) NOT NULL COMMENT '应用显示名称 (如: 后勤巡查, 问题反馈, 空间服务, 智慧日历)',
  `icon` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '微应用图标路径/URL/矢量图标代号',
  `category` VARCHAR(32) NOT NULL DEFAULT 'daily' COMMENT '分类分组: daily(日常办公), service(师生服务), emergency(应急抢修), management(管理驾驶)',
  `entryRoute` VARCHAR(256) NOT NULL COMMENT '微应用在小程序分包中的入口路径 (如: /packages/apps/patrol/index)',
  `minRole` TINYINT NOT NULL DEFAULT 0 COMMENT '最低访问权限级别: 0师生(免登浏览), 1认证师生, 2维修工, 3科室主管, 4校管, 9超管',
  `requiredTags` JSON DEFAULT NULL COMMENT '准入必须绑定的岗位标签ID数组 (如: [1, 2], NULL表示仅按角色门禁)',
  `badgeApi` VARCHAR(256) NOT NULL DEFAULT '' COMMENT '动态角标与未读待办计数拉取 API 路径',
  `sortOrder` INT NOT NULL DEFAULT 0 COMMENT '工作台宫格展示排序权重 (越小越靠前)',
  `isPublic` TINYINT NOT NULL DEFAULT 1 COMMENT '是否对全校师生公开显示: 0否, 1是',
  `isEnabled` TINYINT NOT NULL DEFAULT 1 COMMENT '微应用启停状态: 0停用下线, 1正常启用',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_school_app_code` (`schoolId`, `appCode`),
  INDEX `idx_school_role_sort` (`schoolId`, `isEnabled`, `isDeleted`, `sortOrder`),
  CONSTRAINT `chk_app_category` CHECK (`category` IN ('daily', 'service', 'emergency', 'management')),
  CONSTRAINT `chk_app_min_role` CHECK (`minRole` IN (0, 1, 2, 3, 4, 9)),
  CONSTRAINT `chk_app_public` CHECK (`isPublic` IN (0, 1)),
  CONSTRAINT `chk_app_enabled` CHECK (`isEnabled` IN (0, 1)),
  CONSTRAINT `chk_app_del` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='飞书式工作台微应用元数据注册表 (无物理外键)';

-- ------------------------------------------------------------------------------
-- 表 27: schedules (全景日历日程与排班事件表)
-- 说明: 支撑飞书式日历日程、工单 SLA 履约倒计时、值班排班表与设备维保大事件
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS `schedules`;
CREATE TABLE `schedules` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '日程事件ID (主键)',
  `schoolId` INT NOT NULL COMMENT '所属学校ID (逻辑关联 schools.id, 租户隔离)',
  `userId` INT NOT NULL COMMENT '日程归属/指派用户ID (逻辑关联 users.id)',
  `title` VARCHAR(128) NOT NULL COMMENT '日程事件标题 (如: 西校区暖气管网加压质检, 东校区配电房值班, 工单 #LCU-2026-0001 SLA到期)',
  `type` VARCHAR(32) NOT NULL DEFAULT 'custom' COMMENT '日程类型: custom(自定义日程), sla_deadline(工单SLA履约截止), duty(排班值班), maintenance(重大设备维保)',
  `relatedAppCode` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '关联合并的微应用标识 (如: app-patrol, app-feedback)',
  `relatedEntityId` INT NOT NULL DEFAULT 0 COMMENT '关联实体主键ID (如: patrols.id, feedbacks.id)',
  `startTime` DATETIME NOT NULL COMMENT '日程开始时间',
  `endTime` DATETIME NOT NULL COMMENT '日程截止/结束时间',
  `priority` VARCHAR(16) NOT NULL DEFAULT 'medium' COMMENT '优先级: low(低), medium(中), high(高), urgent(紧急)',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '日程状态: 0待办/进行中, 1已完成, 2已取消/已关闭',
  `dutyPhone` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '值班/联络电话 (支撑全景日历一键快速拨号呼叫)',
  `location` VARCHAR(128) NOT NULL DEFAULT '' COMMENT '事件地点 (如: 西校区动力一区配电室)',
  `remark` TEXT DEFAULT NULL COMMENT '详细备注文档或指引说明',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDeleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记: 0正常, 1已删除',
  PRIMARY KEY (`id`),
  INDEX `idx_school_user_time` (`schoolId`, `userId`, `startTime`, `endTime`),
  INDEX `idx_school_app_entity` (`schoolId`, `relatedAppCode`, `relatedEntityId`),
  CONSTRAINT `chk_schedule_type` CHECK (`type` IN ('custom', 'sla_deadline', 'duty', 'maintenance')),
  CONSTRAINT `chk_schedule_priority` CHECK (`priority` IN ('low', 'medium', 'high', 'urgent')),
  CONSTRAINT `chk_schedule_status` CHECK (`status` IN (0, 1, 2)),
  CONSTRAINT `chk_schedule_del` CHECK (`isDeleted` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全景日历日程与排班事件表 (无物理外键)';

-- ==============================================================================
-- 10. 多租户全景业务视图体系 (Multi-Tenant Views)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 视图 1: v_patrol_details (多租户巡查工单综合宽表视图)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_patrol_details`;
CREATE VIEW `v_patrol_details` AS
SELECT 
  p.`id` AS `patrolId`,
  p.`orderNo` AS `orderNo`,
  p.`schoolId` AS `schoolId`,
  s.`name` AS `schoolName`,
  s.`code` AS `schoolCode`,
  p.`campusId` AS `campusId`,
  c.`name` AS `campusName`,
  p.`categoryId` AS `categoryId`,
  cat.`name` AS `categoryName`,
  p.`creatorId` AS `creatorId`,
  u_creator.`realName` AS `creatorRealName`,
  u_creator.`phone` AS `creatorPhone`,
  p.`currentHandlerId` AS `currentHandlerId`,
  u_handler.`realName` AS `handlerRealName`,
  u_handler.`phone` AS `handlerPhone`,
  p.`title` AS `title`,
  p.`desc` AS `desc`,
  p.`location1` AS `location1`,
  p.`location2` AS `location2`,
  p.`status` AS `status`,
  p.`priorityLevel` AS `priorityLevel`,
  p.`isPublic` AS `isPublic`,
  p.`deadline` AS `deadline`,
  p.`createdAt` AS `createdAt`,
  p.`updatedAt` AS `updatedAt`
FROM `patrols` p
LEFT JOIN `schools` s ON p.`schoolId` = s.`id`
LEFT JOIN `campuses` c ON p.`campusId` = c.`id`
LEFT JOIN `categories` cat ON p.`categoryId` = cat.`id`
LEFT JOIN `users` u_creator ON p.`creatorId` = u_creator.`id`
LEFT JOIN `users` u_handler ON p.`currentHandlerId` = u_handler.`id`
WHERE p.`isDeleted` = 0;

-- ------------------------------------------------------------------------------
-- 视图 2: v_handlers_matrix (四维责任人调度矩阵视图)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_handlers_matrix`;
CREATE VIEW `v_handlers_matrix` AS
SELECT 
  perm.`id` AS `permissionId`,
  perm.`schoolId` AS `schoolId`,
  s.`name` AS `schoolName`,
  perm.`userId` AS `userId`,
  u.`realName` AS `userName`,
  u.`phone` AS `userPhone`,
  perm.`campusId` AS `campusId`,
  IFNULL(c.`name`, '全校通配') AS `campusName`,
  perm.`categoryId` AS `categoryId`,
  IFNULL(cat.`name`, '全分类通配') AS `categoryName`,
  perm.`type` AS `type`,
  CASE perm.`type`
    WHEN 1 THEN '工单责任处理人'
    WHEN 2 THEN '验收复核审核人'
    WHEN 3 THEN '业务监督抄送人'
    ELSE '未知类型'
  END AS `roleDesc`
FROM `permissions` perm
JOIN `schools` s ON perm.`schoolId` = s.`id`
JOIN `users` u ON perm.`userId` = u.`id`
LEFT JOIN `campuses` c ON perm.`campusId` = c.`id`
LEFT JOIN `categories` cat ON perm.`categoryId` = cat.`id`
WHERE u.`isDeleted` = 0;

-- ------------------------------------------------------------------------------
-- 视图 3: v_tenant_overview (各高校后勤大屏、付费级别与运营能效大盘视图)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_tenant_overview`;
CREATE VIEW `v_tenant_overview` AS
SELECT 
  s.`id` AS `schoolId`,
  s.`name` AS `schoolName`,
  s.`code` AS `schoolCode`,
  s.`planLevel` AS `planLevel`,
  s.`planType` AS `planType`,
  s.`maxMonthlyPatrols` AS `maxMonthlyPatrols`,
  s.`planExpireAt` AS `planExpireAt`,
  CASE 
    WHEN s.`planExpireAt` < NOW() THEN '已过期'
    ELSE '服务中'
  END AS `expireStatus`,
  COUNT(DISTINCT p.`id`) AS `totalPatrols`,
  SUM(CASE WHEN p.`status` IN (3, 4) THEN 1 ELSE 0 END) AS `resolvedPatrols`,
  SUM(CASE WHEN p.`status` = 0 THEN 1 ELSE 0 END) AS `pendingPatrols`,
  ROUND(SUM(CASE WHEN p.`status` IN (3, 4) THEN 1 ELSE 0 END) / NULLIF(COUNT(p.`id`), 0) * 100, 2) AS `completionRatePercent`,
  COUNT(DISTINCT u.`id`) AS `registeredUsers`,
  COUNT(DISTINCT c.`id`) AS `campusCount`
FROM `schools` s
LEFT JOIN `campuses` c ON s.`id` = c.`schoolId` AND c.`isDeleted` = 0
LEFT JOIN `users` u ON s.`id` = u.`schoolId` AND u.`isDeleted` = 0
LEFT JOIN `patrols` p ON s.`id` = p.`schoolId` AND p.`isDeleted` = 0
WHERE s.`isDeleted` = 0
GROUP BY s.`id`, s.`name`, s.`code`, s.`planLevel`, s.`planType`, s.`maxMonthlyPatrols`, s.`planExpireAt`;

-- ------------------------------------------------------------------------------
-- 视图 4: v_post_feeds (校园广场公开动态信息流视图 - 未登录公开可见)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_post_feeds`;
CREATE VIEW `v_post_feeds` AS
SELECT 
  post.`id` AS `postId`,
  post.`schoolId` AS `schoolId`,
  s.`name` AS `schoolName`,
  post.`creatorId` AS `creatorId`,
  u.`nickName` AS `nickName`,
  u.`avatarUrl` AS `avatarUrl`,
  post.`patrolId` AS `patrolId`,
  post.`title` AS `title`,
  post.`content` AS `content`,
  post.`imagesJson` AS `imagesJson`,
  post.`likeCount` AS `likeCount`,
  post.`commentCount` AS `commentCount`,
  post.`viewCount` AS `viewCount`,
  post.`isTop` AS `isTop`,
  post.`createdAt` AS `createdAt`
FROM `posts` post
JOIN `schools` s ON post.`schoolId` = s.`id`
JOIN `users` u ON post.`creatorId` = u.`id`
WHERE post.`status` = 1 AND post.`isDeleted` = 0;

-- ------------------------------------------------------------------------------
-- 视图 5: v_chat_sessions (后勤管理人员类QQ会话列表视图)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_chat_sessions`;
CREATE VIEW `v_chat_sessions` AS
SELECT 
  cr.`id` AS `chatRoomId`,
  cr.`schoolId` AS `schoolId`,
  cr.`patrolId` AS `patrolId`,
  p.`orderNo` AS `orderNo`,
  p.`title` AS `patrolTitle`,
  cat.`name` AS `categoryName`,
  cr.`creatorId` AS `creatorUserId`,
  u_creator.`nickName` AS `creatorNickName`,
  u_creator.`realName` AS `creatorRealName`,
  u_creator.`avatarUrl` AS `creatorAvatarUrl`,
  cr.`handlerId` AS `handlerUserId`,
  u_handler.`realName` AS `handlerRealName`,
  cr.`initiatedByHandler` AS `initiatedByHandler`,
  cr.`isClosed` AS `isClosed`,
  cr.`isPinned` AS `isPinned`,
  cr.`handlerUnreadCount` AS `handlerUnreadCount`,
  cr.`creatorUnreadCount` AS `creatorUnreadCount`,
  cr.`lastMessage` AS `lastMessage`,
  cr.`lastMessageAt` AS `lastMessageAt`
FROM `chat_rooms` cr
JOIN `patrols` p ON cr.`patrolId` = p.`id`
LEFT JOIN `categories` cat ON p.`categoryId` = cat.`id`
LEFT JOIN `users` u_creator ON cr.`creatorId` = u_creator.`id`
LEFT JOIN `users` u_handler ON cr.`handlerId` = u_handler.`id`;

-- ------------------------------------------------------------------------------
-- 视图 6: v_school_admins (各高校校级超级管理员名录视图)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_school_admins`;
CREATE VIEW `v_school_admins` AS
SELECT 
  u.`id` AS `userId`,
  u.`schoolId` AS `schoolId`,
  s.`name` AS `schoolName`,
  s.`code` AS `schoolCode`,
  u.`realName` AS `adminName`,
  u.`phone` AS `adminPhone`,
  u.`jobNo` AS `jobNo`,
  u.`email` AS `email`,
  u.`status` AS `userStatus`,
  u.`createdAt` AS `registeredAt`,
  u.`lastLoginAt` AS `lastLoginAt`
FROM `users` u
JOIN `schools` s ON u.`schoolId` = s.`id`
WHERE u.`role` = 4 AND u.`isDeleted` = 0 AND s.`isDeleted` = 0;

-- ------------------------------------------------------------------------------
-- 视图 7: v_tag_assignments (岗位职能标签成员与调度矩阵全景视图)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS `v_tag_assignments`;
CREATE VIEW `v_tag_assignments` AS
SELECT 
  tm.`id` AS `assignmentId`,
  tm.`schoolId` AS `schoolId`,
  s.`name` AS `schoolName`,
  t.`id` AS `tagId`,
  t.`name` AS `tagName`,
  t.`color` AS `tagColor`,
  t.`desc` AS `tagDesc`,
  u.`id` AS `userId`,
  u.`realName` AS `userName`,
  u.`phone` AS `userPhone`,
  u.`jobNo` AS `jobNo`,
  tm.`createdAt` AS `assignedAt`
FROM `tag_members` tm
JOIN `schools` s ON tm.`schoolId` = s.`id`
JOIN `tags` t ON tm.`tagId` = t.`id`
JOIN `users` u ON tm.`userId` = u.`id`
WHERE t.`isDeleted` = 0 AND u.`isDeleted` = 0;

-- ==============================================================================
-- 11. 演示与生产基线种子数据 (Seed Baseline Data)
-- ==============================================================================

-- 插入默认租户 1: 聊城大学 (首发标杆高校, 旗舰无限版)
INSERT INTO `schools` (
  `id`, `code`, `name`, `shortName`, `status`, `planLevel`, `planType`, `maxMonthlyPatrols`, `storageQuotaMb`, `planExpireAt`, `configJson`
) VALUES (
  1, 
  'lcu', 
  '聊城大学', 
  '聊大', 
  1, 
  2, -- 2: 旗舰尊享版 (无限)
  'unlimited', 
  -1, 
  -1, 
  '2030-12-31 23:59:59', 
  JSON_OBJECT(
    'appId', 'wx28f8047915598ba9', 
    'appName', '后勤巡查e速办', 
    'ossBucket', 'ldhq-xcesb-wx-miniprogram', 
    'ossPrefix', 'school_1/'
  )
) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 插入默认租户 2: 示范大学 (演示高校, 有限专业版)
INSERT INTO `schools` (
  `id`, `code`, `name`, `shortName`, `status`, `planLevel`, `planType`, `maxMonthlyPatrols`, `storageQuotaMb`, `planExpireAt`, `configJson`
) VALUES (
  2, 
  'demo_univ', 
  '示范重点大学', 
  '示大', 
  1, 
  1, -- 1: 基础专业版 (有限配额: 每月 500 单)
  'limited', 
  500, 
  5120, 
  '2027-06-30 23:59:59', 
  JSON_OBJECT(
    'appId', 'wx_demo_placeholder', 
    'appName', '智慧校园后勤巡查', 
    'ossBucket', 'ldhq-xcesb-wx-miniprogram', 
    'ossPrefix', 'school_2/'
  )
) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 插入聊城大学校区
INSERT INTO `campuses` (`id`, `schoolId`, `name`, `sortOrder`) VALUES
(1, 1, '东校区', 1),
(2, 1, '西校区', 2)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 插入示范大学校区
INSERT INTO `campuses` (`id`, `schoolId`, `name`, `sortOrder`) VALUES
(3, 2, '本校区', 1),
(4, 2, '海滨校区', 2)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 插入默认巡查分类
INSERT INTO `categories` (`id`, `schoolId`, `name`, `defaultDays`, `sortOrder`) VALUES
(1, 1, '水电暖维修', 2, 1),
(2, 1, '绿化环卫保洁', 3, 2),
(3, 1, '道路设施损坏', 5, 3),
(4, 1, '路灯与照明设施', 2, 4),
(5, 1, '消防设施隐患', 1, 5),
(6, 1, '教学多媒体设备', 2, 6)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 插入默认职能科室
INSERT INTO `departments` (`id`, `schoolId`, `name`, `sortOrder`) VALUES
(1, 1, '后勤保障处', 1),
(2, 1, '物业管理中心', 2),
(3, 1, '能源动力中心', 3),
(4, 1, '保卫处消防科', 4)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 插入平台系统管理员账号 (role = 9, Platform Super Admin)
INSERT INTO `users` (`id`, `schoolId`, `openId`, `realName`, `nickName`, `phone`, `role`) VALUES
(999, 0, 'seed_platform_root', '平台总管理员', '系统总控', '18888888888', 9)
ON DUPLICATE KEY UPDATE `realName` = VALUES(`realName`);

-- 插入聊城大学学校管理员账号 (role = 4, School Admin)
INSERT INTO `users` (`id`, `schoolId`, `openId`, `realName`, `nickName`, `phone`, `role`) VALUES
(1, 1, 'seed_admin_lcu_root', '聊大后勤总管', '聊大校管', '13800000000', 4)
ON DUPLICATE KEY UPDATE `realName` = VALUES(`realName`);

-- 插入示范大学学校管理员账号 (role = 4, School Admin)
INSERT INTO `users` (`id`, `schoolId`, `openId`, `realName`, `nickName`, `phone`, `role`) VALUES
(2, 2, 'seed_admin_demo_root', '示大后勤总管', '示大校管', '13900000000', 4)
ON DUPLICATE KEY UPDATE `realName` = VALUES(`realName`);

-- 9. 插入各学校自定义参数与专属 OpenAI 大模型配置 (school_settings)
INSERT INTO `school_settings` (`schoolId`, `key`, `value`, `desc`, `isEncrypted`) VALUES
-- 聊城大学个性化设置
(1, 'auto_pass_days', '7', '工单完工后提报人未评价自动好评天数', 0),
(1, 'emergency_phone', '0635-8238110', '后勤24小时紧急报修直通热线', 0),
(1, 'is_public_wall_enabled', '1', '是否开放全校公开广场瀑布流(1开启, 0关闭)', 0),
(1, 'chat_spam_seconds', '5', '聊天消息防刷频时间窗口(秒)', 0),
(1, 'chat_withdraw_seconds', '120', '聊天消息允许撤回的最大时限(秒, 默认2分钟)', 0),
-- 聊城大学专属 OpenAI API 与 AI Agent 配置
(1, 'ai_enabled', '1', '是否开启本校 AI Agent 智能后勤助手(1开启, 0关闭)', 0),
(1, 'ai_api_key', 'sk-proj-lcu-encrypted-demo-key-placeholder', '本校 OpenAI 接口 API Key (生产环境 AES 密文存储)', 1),
(1, 'ai_base_url', 'https://api.openai.com/v1', '本校 OpenAI / 兼容大模型请求 Base URL', 0),
(1, 'ai_model', 'gpt-4o', '本校调用的基座大模型名称 (如: gpt-4o, deepseek-chat, qwen-max)', 0),
(1, 'ai_temperature', '0.3', 'AI Agent 推理采样温度 (0.0~1.0, 越低越严谨)', 0),
(1, 'ai_system_prompt', '你是由聊城大学后勤保障处打造的【聊大后勤智能巡查e速办 AI Copilot】。你拥有实时访问聊城大学各校区后勤工单、统计大盘、责任部门与联络电话的专属工具集 (Tools)。回答师生提问时请务必礼貌、严谨，遇到未解决的问题主动引导其通过工单流转跟进。', '本校定制 System Prompt 人设设定', 0),

-- 示范大学设置
(2, 'auto_pass_days', '5', '自动好评天数', 0),
(2, 'emergency_phone', '010-88889999', '24小时后勤热线', 0),
(2, 'ai_enabled', '1', '是否开启AI助手', 0),
(2, 'ai_api_key', 'sk-proj-demo-encrypted-key-placeholder', 'OpenAI API Key', 1),
(2, 'ai_base_url', 'https://api.openai.com/v1', 'OpenAI Base URL', 0),
(2, 'ai_model', 'gpt-4o-mini', '模型名称', 0)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

-- 10. 插入递点组织职能岗位标签与成员映射种子数据 (tags & tag_members)
INSERT INTO `tags` (`id`, `schoolId`, `name`, `color`, `desc`, `sortOrder`) VALUES
(1, 1, '西校区水电抢修组长', '#0078D7', '负责西校区所有突发水暖、供电与消防管道抢修与现场接单', 1),
(2, 1, '宿管修缮质检验收员', '#E81123', '负责全校公寓宿舍完工工单的现场质量复核验收', 2),
(3, 1, '防汛应急突击队员', '#FF8C00', '极端恶劣天气、暴雨排涝防汛应急响应第一责任人', 3)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `tag_members` (`id`, `schoolId`, `tagId`, `userId`) VALUES
(1, 1, 1, 1), -- 校管兼任组长演示
(2, 1, 2, 1),
(3, 1, 3, 1)
ON DUPLICATE KEY UPDATE `userId` = VALUES(`userId`);

-- 11. 插入飞书式工作台微应用注册中心种子数据 (apps)
INSERT INTO `apps` (`id`, `schoolId`, `appCode`, `name`, `icon`, `category`, `entryRoute`, `minRole`, `requiredTags`, `badgeApi`, `sortOrder`, `isPublic`, `isEnabled`) VALUES
(1, 1, 'app-patrol', '后勤巡查', 'icon-patrol', 'emergency', '/packages/apps/patrol/index', 2, NULL, '/api/apps/patrol/badge', 1, 1, 1),
(2, 1, 'app-feedback', '问题反馈', 'icon-feedback', 'service', '/packages/apps/feedback/index', 0, NULL, '/api/apps/feedback/badge', 2, 1, 1),
(3, 1, 'app-inspection', '专项质检', 'icon-inspection', 'daily', '/packages/apps/inspection/index', 3, NULL, '/api/apps/inspection/badge', 3, 1, 1),
(4, 1, 'app-calendar', '智慧日历', 'icon-calendar', 'daily', '/packages/apps/calendar/index', 0, NULL, '/api/apps/calendar/badge', 4, 1, 1),
(5, 1, 'app-space', '校园空间', 'icon-space', 'service', '/packages/apps/space/index', 0, NULL, '', 5, 1, 1),
(6, 1, 'app-cockpit', '管理驾驶舱', 'icon-cockpit', 'management', '/packages/apps/cockpit/index', 4, NULL, '', 6, 0, 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 12. 插入全景日历日程种子数据 (schedules)
INSERT INTO `schedules` (`id`, `schoolId`, `userId`, `title`, `type`, `relatedAppCode`, `relatedEntityId`, `startTime`, `endTime`, `priority`, `status`, `dutyPhone`, `location`, `remark`) VALUES
(1, 1, 1, '西校区动力一区配电室例行巡查与加压测温', 'maintenance', 'app-patrol', 1, '2026-09-06 08:30:00', '2026-09-06 11:30:00', 'high', 0, '0635-8238110', '西校区配电一号楼', '检查高低压配电柜运行参数，红外热成像测温'),
(2, 1, 1, '聊城大学周末后勤保卫值班总调度', 'duty', 'app-calendar', 0, '2026-09-06 00:00:00', '2026-09-06 23:59:59', 'urgent', 0, '13800000000', '后勤保障处应急指挥中心', '负责突发水电报修与恶劣天气防汛应急统一指挥调度'),
(3, 1, 1, '工单 #LCU-2026-0001 SLA 截止履约提醒', 'sla_deadline', 'app-patrol', 1, '2026-09-07 18:00:00', '2026-09-07 18:00:00', 'urgent', 0, '', '东校区三号教学楼201', '教学投影仪紧急抢修工单 24 小时 SLA 到期临界线')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

-- ==============================================================================
-- 脚本执行完成：已全面支持 27 张物理表 + 7 大全景视图！
-- 涵盖: 多租户隔离、SaaS 付费级别/配额到期控制、类 QQ 工单即时通讯、各校专属 OpenAI AI Agent 智能助手中台、
-- 递点（类飞书）无限级组织树、岗位标签权限解耦与高可靠全场景群聊中枢、
-- 以及飞书式工作台微应用矩阵平台 (apps) 与全景日历日程调度中枢 (schedules)！
-- ==============================================================================
