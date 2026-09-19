-- Adds the `InstanceResetOtp` table — see schema.prisma's own header on this model for the "why"
-- (the same CSPRNG/hash/timing-safe-compare/lifetime-lock hardening `DangerOtp` already has, keyed by
-- the requesting OPERATOR's e-mail instead of a companyId, so one operator's lockout never blocks a
-- different one).
-- CreateTable
CREATE TABLE "InstanceResetOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceResetOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstanceResetOtp_email_key" ON "InstanceResetOtp"("email");
