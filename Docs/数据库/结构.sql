-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: 120.26.139.197    Database: xc
-- ------------------------------------------------------
-- Server version	8.0.41

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Temporary view structure for view `admins_view`
--

DROP TABLE IF EXISTS `admins_view`;
/*!50001 DROP VIEW IF EXISTS `admins_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `admins_view` AS SELECT 
 1 AS `用户ID`,
 1 AS `用户名`,
 1 AS `手机号`,
 1 AS `是否管理员`,
 1 AS `是否超级管理员`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `campuses`
--

DROP TABLE IF EXISTS `campuses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `campuses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isDeleted` int DEFAULT '0',
  `scanCodeCount` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isDeleted` int DEFAULT '0',
  `scanCodeCount` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chatMessages`
--

DROP TABLE IF EXISTS `chatMessages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatMessages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `chatRoomId` int DEFAULT NULL,
  `isHandleUser` int DEFAULT NULL,
  `type` int DEFAULT NULL,
  `content` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1621 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chatRooms`
--

DROP TABLE IF EXISTS `chatRooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatRooms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userOpenId` longtext,
  `handleUserId` int DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `handleUserLastChatAt` datetime DEFAULT NULL,
  `closed` int DEFAULT NULL,
  `userUnread` int DEFAULT '0',
  `handleUserUnread` int DEFAULT '0',
  `lastChatAt` datetime DEFAULT NULL,
  `userNotAlert` int DEFAULT '0',
  `handleUserNote` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=96 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `departments`
--

DROP TABLE IF EXISTS `departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `category` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `feedbacks`
--

DROP TABLE IF EXISTS `feedbacks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `feedbacks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `content` longtext,
  `role` varchar(45) DEFAULT NULL,
  `campusId` int DEFAULT NULL,
  `categoryId` int DEFAULT NULL,
  `location1` varchar(45) DEFAULT NULL,
  `location2` varchar(45) DEFAULT NULL,
  `image` varchar(256) DEFAULT NULL,
  `name` varchar(45) DEFAULT NULL,
  `phone` varchar(45) DEFAULT NULL,
  `departmentId` int DEFAULT NULL,
  `className` varchar(45) DEFAULT NULL,
  `answerContent` longtext,
  `answerUserId` int DEFAULT NULL,
  `answerTime` datetime DEFAULT NULL,
  `openId` longtext,
  `isDeleted` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=330 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `handlers_view`
--

DROP TABLE IF EXISTS `handlers_view`;
/*!50001 DROP VIEW IF EXISTS `handlers_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `handlers_view` AS SELECT 
 1 AS `用户ID`,
 1 AS `用户名`,
 1 AS `手机号`,
 1 AS `校区名称`,
 1 AS `分类名称`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `content` longtext,
  `isRead` int DEFAULT NULL,
  `sender` longtext,
  `readTime` datetime DEFAULT NULL,
  `link` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=36116 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `openIds`
--

DROP TABLE IF EXISTS `openIds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `openIds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `value` longtext,
  `loginTime` int DEFAULT '0',
  `lastLoginTime` datetime DEFAULT NULL,
  `isBan` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2752 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patrols`
--

DROP TABLE IF EXISTS `patrols`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patrols` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `desc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image1` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image2` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image3` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image4` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image5` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `location1` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location2` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `campusId` int DEFAULT NULL,
  `categoryId` int DEFAULT NULL,
  `status` int DEFAULT NULL,
  `endTime` datetime DEFAULT NULL,
  `endTime1` datetime DEFAULT NULL,
  `endTime2` datetime DEFAULT NULL,
  `endTime3` datetime DEFAULT NULL,
  `delay1UserId` int DEFAULT NULL,
  `delay2UserId` int DEFAULT NULL,
  `delay3UserId` int DEFAULT NULL,
  `priorityTime` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13713 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `patrols_analysis_view`
--

DROP TABLE IF EXISTS `patrols_analysis_view`;
/*!50001 DROP VIEW IF EXISTS `patrols_analysis_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `patrols_analysis_view` AS SELECT 
 1 AS `巡查ID`,
 1 AS `创建时间`,
 1 AS `状态代码`,
 1 AS `状态`,
 1 AS `校区名称`,
 1 AS `类别名称`,
 1 AS `负责人姓名`,
 1 AS `处理得分`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `patrols_comment`
--

DROP TABLE IF EXISTS `patrols_comment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patrols_comment` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `patrolId` int DEFAULT NULL,
  `desc` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patrols_feedback`
--

DROP TABLE IF EXISTS `patrols_feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patrols_feedback` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `patrolId` int DEFAULT NULL,
  `rating` int DEFAULT NULL,
  `desc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12251 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patrols_handle`
--

DROP TABLE IF EXISTS `patrols_handle`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patrols_handle` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `patrolId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `desc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image1` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image2` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image3` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image4` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image5` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `reject` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12687 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patrols_like`
--

DROP TABLE IF EXISTS `patrols_like`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patrols_like` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `patrolId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `patrols_review`
--

DROP TABLE IF EXISTS `patrols_review`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `patrols_review` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `patrolId` int DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `desc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=122 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `permissions`
--

DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `userId` int DEFAULT NULL,
  `type` int DEFAULT NULL,
  `campusId` int DEFAULT NULL,
  `categoryId` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=242 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `qrcodes`
--

DROP TABLE IF EXISTS `qrcodes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `qrcodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `operation` varchar(45) DEFAULT NULL,
  `data` longtext,
  `canScan` int DEFAULT NULL,
  `explain` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `reviewers_view`
--

DROP TABLE IF EXISTS `reviewers_view`;
/*!50001 DROP VIEW IF EXISTS `reviewers_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `reviewers_view` AS SELECT 
 1 AS `用户ID`,
 1 AS `用户名`,
 1 AS `手机号`,
 1 AS `校区名称`,
 1 AS `分类名称`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `explain` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=406 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `userReadRecord`
--

DROP TABLE IF EXISTS `userReadRecord`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `userReadRecord` (
  `id` int NOT NULL AUTO_INCREMENT,
  `isPatrol` int DEFAULT '0',
  `isFeedBack` int DEFAULT '0',
  `userId` int DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `itemId` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10401 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary view structure for view `user_notifications_view`
--

DROP TABLE IF EXISTS `user_notifications_view`;
/*!50001 DROP VIEW IF EXISTS `user_notifications_view`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `user_notifications_view` AS SELECT 
 1 AS `用户ID`,
 1 AS `用户名`,
 1 AS `手机号`,
 1 AS `角色`,
 1 AS `账号`,
 1 AS `是否管理员`,
 1 AS `是否超级管理员`,
 1 AS `巡查次数`,
 1 AS `最后巡查时间`,
 1 AS `通知ID`,
 1 AS `通知内容`,
 1 AS `发送者`,
 1 AS `发送时间`,
 1 AS `是否已读`,
 1 AS `阅读时间`,
 1 AS `相关链接`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `username` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `openId` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isDeleted` int DEFAULT NULL,
  `isDisabled` int DEFAULT NULL,
  `isAdmin` int DEFAULT NULL,
  `token` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `departmentId` int DEFAULT NULL,
  `account` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isSAdmin` int DEFAULT '0',
  `patrolCount` int DEFAULT '0',
  `lastPatrolCreatedAt` datetime DEFAULT NULL,
  `limitNumOfPatrol` int DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=138 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Final view structure for view `admins_view`
--

/*!50001 DROP VIEW IF EXISTS `admins_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `admins_view` AS select `u`.`id` AS `用户ID`,`u`.`username` AS `用户名`,`u`.`phone` AS `手机号`,(case when (`u`.`isAdmin` = 1) then '是' else '否' end) AS `是否管理员`,(case when (`u`.`isSAdmin` = 1) then '是' else '否' end) AS `是否超级管理员` from `users` `u` where ((`u`.`isAdmin` = 1) or (`u`.`isSAdmin` = 1)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `handlers_view`
--

/*!50001 DROP VIEW IF EXISTS `handlers_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `handlers_view` AS select `u`.`id` AS `用户ID`,`u`.`username` AS `用户名`,`u`.`phone` AS `手机号`,`c`.`name` AS `校区名称`,`cat`.`name` AS `分类名称` from (((`users` `u` join `permissions` `p` on((`u`.`id` = `p`.`userId`))) join `campuses` `c` on((`p`.`campusId` = `c`.`id`))) join `categories` `cat` on((`p`.`categoryId` = `cat`.`id`))) where (`p`.`type` = 1) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `patrols_analysis_view`
--

/*!50001 DROP VIEW IF EXISTS `patrols_analysis_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `patrols_analysis_view` AS select `p`.`id` AS `巡查ID`,`p`.`createdAt` AS `创建时间`,`p`.`status` AS `状态代码`,(case when (`p`.`status` = 1) then '等待' when (`p`.`status` = 2) then '延期' when (`p`.`status` = 3) then '满意度调查中' when (`p`.`status` = 4) then '完成' when (`p`.`status` = 5) then '拒绝' else '未知状态' end) AS `状态`,`c`.`name` AS `校区名称`,`cat`.`name` AS `类别名称`,`u`.`username` AS `负责人姓名`,`f`.`rating` AS `处理得分` from (((((`patrols` `p` left join `campuses` `c` on((`p`.`campusId` = `c`.`id`))) left join `categories` `cat` on((`p`.`categoryId` = `cat`.`id`))) left join `patrols_handle` `ph` on((`p`.`id` = `ph`.`patrolId`))) left join `users` `u` on((`ph`.`userId` = `u`.`id`))) left join `patrols_feedback` `f` on((`p`.`id` = `f`.`patrolId`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `reviewers_view`
--

/*!50001 DROP VIEW IF EXISTS `reviewers_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `reviewers_view` AS select `u`.`id` AS `用户ID`,`u`.`username` AS `用户名`,`u`.`phone` AS `手机号`,`c`.`name` AS `校区名称`,`cat`.`name` AS `分类名称` from (((`users` `u` join `permissions` `p` on((`u`.`id` = `p`.`userId`))) join `campuses` `c` on((`p`.`campusId` = `c`.`id`))) join `categories` `cat` on((`p`.`categoryId` = `cat`.`id`))) where (`p`.`type` = 2) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `user_notifications_view`
--

/*!50001 DROP VIEW IF EXISTS `user_notifications_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `user_notifications_view` AS select `u`.`id` AS `用户ID`,`u`.`username` AS `用户名`,`u`.`phone` AS `手机号`,`u`.`role` AS `角色`,`u`.`account` AS `账号`,(case when (`u`.`isAdmin` = 1) then '是' else '否' end) AS `是否管理员`,(case when (`u`.`isSAdmin` = 1) then '是' else '否' end) AS `是否超级管理员`,`u`.`patrolCount` AS `巡查次数`,`u`.`lastPatrolCreatedAt` AS `最后巡查时间`,`n`.`id` AS `通知ID`,`n`.`content` AS `通知内容`,`n`.`sender` AS `发送者`,`n`.`createdAt` AS `发送时间`,(case when (`n`.`isRead` = 1) then '是' else '否' end) AS `是否已读`,`n`.`readTime` AS `阅读时间`,`n`.`link` AS `相关链接` from (`users` `u` left join `notifications` `n` on((`u`.`id` = `n`.`userId`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-05 12:33:07
