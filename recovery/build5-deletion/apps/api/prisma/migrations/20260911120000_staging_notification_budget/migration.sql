CREATE TABLE "StagingNotificationBudget" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StagingNotificationBudget_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "StagingNotificationBudget_count_check" CHECK ("count" >= 0)
);
