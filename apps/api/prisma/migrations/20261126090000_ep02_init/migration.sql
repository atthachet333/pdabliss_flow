-- EP02 initial schema (MariaDB 10.6+, InnoDB, utf8mb4).
-- Identifier/token columns use utf8mb4_bin or BINARY so case can never make two values equal.

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `displayName` VARCHAR(100) NOT NULL,
    `status` ENUM('NEW', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'REVOKED') NOT NULL DEFAULT 'NEW',
    `globalRole` ENUM('OWNER', 'ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `authzVersion` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `statusChangedAt` DATETIME(3) NULL,
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `line_identities` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `lineUserId` VARCHAR(33) COLLATE utf8mb4_bin NOT NULL,
    `loginChannelId` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `lastVerifiedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `line_identities_userId_key`(`userId`),
    UNIQUE INDEX `line_identities_lineUserId_key`(`lineUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `keyHash` BINARY(32) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `endReason` ENUM('LOGGED_OUT', 'REVOKED', 'EXPIRED', 'REPLACED') NULL,
    UNIQUE INDEX `sessions_keyHash_key`(`keyHash`),
    INDEX `sessions_userId_endedAt_idx`(`userId`, `endedAt`),
    INDEX `sessions_absoluteExpiresAt_idx`(`absoluteExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limit_buckets` (
    `keyHash` BINARY(32) NOT NULL,
    `count` INTEGER NOT NULL,
    `windowEnd` DATETIME(3) NOT NULL,
    INDEX `rate_limit_buckets_windowEnd_idx`(`windowEnd`),
    PRIMARY KEY (`keyHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_requests` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `openKey` CHAR(36) NULL,
    `message` VARCHAR(200) NULL,
    `invitationId` CHAR(36) NULL,
    `targetWorkspaceId` CHAR(36) NULL,
    `targetRole` ENUM('ADMIN', 'MEMBER', 'VIEWER') NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedByUserId` CHAR(36) NULL,
    UNIQUE INDEX `access_requests_openKey_key`(`openKey`),
    INDEX `access_requests_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `access_requests_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitations` (
    `id` CHAR(36) NOT NULL,
    `tokenHash` BINARY(32) NOT NULL,
    `workspaceId` CHAR(36) NOT NULL,
    `role` ENUM('ADMIN', 'MEMBER', 'VIEWER') NOT NULL,
    `status` ENUM('ACTIVE', 'REDEEMED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `note` VARCHAR(80) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `redeemedByUserId` CHAR(36) NULL,
    `redeemedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    UNIQUE INDEX `invitations_tokenHash_key`(`tokenHash`),
    INDEX `invitations_workspaceId_status_idx`(`workspaceId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspaces` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `kind` ENUM('PERSONAL', 'FAMILY', 'COMPANY', 'CUSTOM') NOT NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `personalOwnerId` CHAR(36) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    UNIQUE INDEX `workspaces_personalOwnerId_key`(`personalOwnerId`),
    INDEX `workspaces_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_members` (
    `id` CHAR(36) NOT NULL,
    `workspaceId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `role` ENUM('ADMIN', 'MEMBER', 'VIEWER') NOT NULL,
    `status` ENUM('ACTIVE', 'REMOVED', 'LEFT') NOT NULL DEFAULT 'ACTIVE',
    `addedByUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `workspace_members_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `workspace_members_workspaceId_userId_key`(`workspaceId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `line_destinations` (
    `id` CHAR(36) NOT NULL,
    `kind` ENUM('PRIVATE_USER', 'GROUP') NOT NULL,
    `lineTargetId` VARCHAR(33) COLLATE utf8mb4_bin NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'DISABLED', 'REMOVED') NOT NULL,
    `workspaceId` CHAR(36) NULL,
    `userId` CHAR(36) NULL,
    `audienceSize` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `lastEventAt` DATETIME(3) NULL,
    UNIQUE INDEX `line_destinations_lineTargetId_key`(`lineTargetId`),
    UNIQUE INDEX `line_destinations_userId_key`(`userId`),
    INDEX `line_destinations_status_kind_idx`(`status`, `kind`),
    INDEX `line_destinations_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `destination_grants` (
    `id` CHAR(36) NOT NULL,
    `destinationId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `grantedByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `destination_grants_destinationId_userId_key`(`destinationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointments` (
    `id` CHAR(36) NOT NULL,
    `workspaceId` CHAR(36) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `allDay` BOOLEAN NOT NULL,
    `timeZone` VARCHAR(40) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `location` VARCHAR(160) NULL,
    `notes` TEXT NULL,
    `visibility` ENUM('PRIVATE', 'WORKSPACE', 'SELECTED') NOT NULL DEFAULT 'PRIVATE',
    `status` ENUM('SCHEDULED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledByUserId` CHAR(36) NULL,
    INDEX `appointments_workspaceId_startDate_idx`(`workspaceId`, `startDate`),
    INDEX `appointments_workspaceId_endDate_idx`(`workspaceId`, `endDate`),
    INDEX `appointments_createdByUserId_startDate_idx`(`createdByUserId`, `startDate`),
    INDEX `appointments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_access` (
    `id` CHAR(36) NOT NULL,
    `appointmentId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    INDEX `appointment_access_userId_idx`(`userId`),
    UNIQUE INDEX `appointment_access_appointmentId_userId_key`(`appointmentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_destinations` (
    `id` CHAR(36) NOT NULL,
    `appointmentId` CHAR(36) NOT NULL,
    `destinationId` CHAR(36) NOT NULL,
    `contentPolicy` ENUM('FULL', 'PRIVACY_SAFE') NOT NULL DEFAULT 'PRIVACY_SAFE',
    `createdAt` DATETIME(3) NOT NULL,
    INDEX `appointment_destinations_destinationId_idx`(`destinationId`),
    UNIQUE INDEX `appointment_destinations_appointmentId_destinationId_key`(`appointmentId`, `destinationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reminder_rules` (
    `id` CHAR(36) NOT NULL,
    `appointmentId` CHAR(36) NOT NULL,
    `ruleVersion` INTEGER NOT NULL DEFAULT 1,
    `kind` ENUM('RELATIVE', 'CALENDAR') NOT NULL,
    `offsetMinutes` INTEGER NULL,
    `dayOffset` INTEGER NULL,
    `localTime` CHAR(5) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL,
    `fireAt` DATETIME(3) NULL,
    `status` ENUM('SCHEDULED', 'PAST', 'DISABLED', 'DUPLICATE', 'CANCELLED') NOT NULL,
    `calculatedAt` DATETIME(3) NOT NULL,
    INDEX `reminder_rules_appointmentId_idx`(`appointmentId`),
    INDEX `reminder_rules_status_fireAt_idx`(`status`, `fireAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment_events` (
    `id` CHAR(36) NOT NULL,
    `appointmentId` CHAR(36) NOT NULL,
    `actorUserId` CHAR(36) NULL,
    `type` ENUM('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELLED', 'REMINDERS_CHANGED', 'VISIBILITY_CHANGED', 'DESTINATIONS_CHANGED') NOT NULL,
    `fields` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL,
    INDEX `appointment_events_appointmentId_createdAt_idx`(`appointmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `eventId` VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `sourceType` VARCHAR(16) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    INDEX `webhook_events_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`eventId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_preferences` (
    `userId` CHAR(36) NOT NULL,
    `defaultWorkspaceId` CHAR(36) NULL,
    `defaultReminders` JSON NULL,
    `defaultVisibility` ENUM('PRIVATE', 'WORKSPACE', 'SELECTED') NOT NULL DEFAULT 'PRIVATE',
    `defaultContentPolicy` ENUM('FULL', 'PRIVACY_SAFE') NOT NULL DEFAULT 'PRIVACY_SAFE',
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_records` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `scope` VARCHAR(40) NOT NULL,
    `key` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    `resultId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    INDEX `idempotency_records_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `idempotency_records_userId_scope_key_key`(`userId`, `scope`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actorUserId` CHAR(36) NULL,
    `action` VARCHAR(60) NOT NULL,
    `resourceType` VARCHAR(40) NOT NULL,
    `resourceId` CHAR(36) NULL,
    `workspaceId` CHAR(36) NULL,
    `metadata` JSON NULL,
    `correlationId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL,
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    INDEX `audit_logs_workspaceId_createdAt_idx`(`workspaceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `line_identities` ADD CONSTRAINT `line_identities_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_requests` ADD CONSTRAINT `access_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_requests` ADD CONSTRAINT `access_requests_decidedByUserId_fkey` FOREIGN KEY (`decidedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_requests` ADD CONSTRAINT `access_requests_invitationId_fkey` FOREIGN KEY (`invitationId`) REFERENCES `invitations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_requests` ADD CONSTRAINT `access_requests_targetWorkspaceId_fkey` FOREIGN KEY (`targetWorkspaceId`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_redeemedByUserId_fkey` FOREIGN KEY (`redeemedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_personalOwnerId_fkey` FOREIGN KEY (`personalOwnerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `line_destinations` ADD CONSTRAINT `line_destinations_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `line_destinations` ADD CONSTRAINT `line_destinations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `destination_grants` ADD CONSTRAINT `destination_grants_destinationId_fkey` FOREIGN KEY (`destinationId`) REFERENCES `line_destinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `destination_grants` ADD CONSTRAINT `destination_grants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_access` ADD CONSTRAINT `appointment_access_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_access` ADD CONSTRAINT `appointment_access_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_destinations` ADD CONSTRAINT `appointment_destinations_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_destinations` ADD CONSTRAINT `appointment_destinations_destinationId_fkey` FOREIGN KEY (`destinationId`) REFERENCES `line_destinations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_rules` ADD CONSTRAINT `reminder_rules_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_events` ADD CONSTRAINT `appointment_events_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_events` ADD CONSTRAINT `appointment_events_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_preferences` ADD CONSTRAINT `user_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idempotency_records` ADD CONSTRAINT `idempotency_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
