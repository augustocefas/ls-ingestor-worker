-- CreateTable
CREATE TABLE `job_logs` (
    `id` VARCHAR(191) NOT NULL,
    `job_id` VARCHAR(191) NOT NULL,
    `nserie` VARCHAR(32) NOT NULL,
    `tenant_id` VARCHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL,
    `rows_total` INTEGER NOT NULL DEFAULT 0,
    `rows_ok` INTEGER NOT NULL DEFAULT 0,
    `rows_err` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    INDEX `job_logs_job_id_idx`(`job_id`),
    INDEX `job_logs_nserie_idx`(`nserie`),
    INDEX `job_logs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
