-- DropTable
-- CronLock (added in 20260629163204_add_cron_lock) is no longer needed: BullMQ dedups
-- poll/timer jobs by their deterministic jobId and repeatable jobs by their repeat key
-- across the whole cluster, replacing the distributed lease this table backed
-- (QUEUE_IMPL_PLAN.md §5.8 / Décision 3 — ComplianceCron + CronLockService removed).
DROP TABLE "CronLock";
