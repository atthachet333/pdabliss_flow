-- EP02 consolidated (2026-11-28): recurring series, bills, per-workspace member colours.
-- Additive only: new nullable/defaulted columns, two enum values appended, one new table,
-- one unique key and three foreign keys. No existing row is rewritten or deleted.
-- Prisma's replay-only JSON alias statements for the three existing JSON columns are
-- intentionally omitted (they are no-ops on MariaDB; see docs/EP02.1-REMEDIATION-REPORT.md F01).

-- AlterTable
ALTER TABLE `appointment_events` MODIFY `type` ENUM('CREATED', 'UPDATED', 'RESCHEDULED', 'CANCELLED', 'REMINDERS_CHANGED', 'VISIBILITY_CHANGED', 'DESTINATIONS_CHANGED', 'PAYMENT_CHANGED') NOT NULL;

-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `amount` DECIMAL(14, 2) NULL,
    ADD COLUMN `currency` CHAR(3) NULL,
    ADD COLUMN `isException` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `kind` ENUM('EVENT', 'BILL') NOT NULL DEFAULT 'EVENT',
    ADD COLUMN `occurrenceDate` DATE NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paidByUserId` CHAR(36) NULL,
    ADD COLUMN `paymentStatus` ENUM('UNPAID', 'PAID') NULL,
    ADD COLUMN `seriesId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `reminder_rules` MODIFY `status` ENUM('SCHEDULED', 'PAST', 'DISABLED', 'DUPLICATE', 'CANCELLED', 'SUPPRESSED') NOT NULL;

-- AlterTable
ALTER TABLE `workspace_members` ADD COLUMN `colorToken` VARCHAR(16) NULL;

-- CreateTable
CREATE TABLE `appointment_series` (
    `id` CHAR(36) NOT NULL,
    `workspaceId` CHAR(36) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `kind` ENUM('EVENT', 'BILL') NOT NULL DEFAULT 'EVENT',
    `frequency` ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') NOT NULL,
    `interval` INTEGER NOT NULL DEFAULT 1,
    `monthDay` INTEGER NULL,
    `missingDayPolicy` ENUM('LAST_DAY', 'SKIP') NOT NULL DEFAULT 'LAST_DAY',
    `endType` ENUM('NEVER', 'UNTIL', 'COUNT') NOT NULL DEFAULT 'NEVER',
    `untilDate` DATE NULL,
    `occurrenceCount` INTEGER NULL,
    `startDate` DATE NOT NULL,
    `template` JSON NULL,
    `generatedThrough` DATE NULL,
    `status` ENUM('ACTIVE', 'ENDED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `appointment_series_status_generatedThrough_idx`(`status`, `generatedThrough`),
    INDEX `appointment_series_workspaceId_idx`(`workspaceId`),
    INDEX `appointment_series_createdByUserId_idx`(`createdByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `appointments_seriesId_occurrenceDate_key` ON `appointments`(`seriesId`, `occurrenceDate`);

-- AddForeignKey
ALTER TABLE `appointment_series` ADD CONSTRAINT `appointment_series_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment_series` ADD CONSTRAINT `appointment_series_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `appointment_series`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

