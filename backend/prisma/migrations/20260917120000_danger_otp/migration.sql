-- Adds the `DangerOtp` table — see schema.prisma's own header on this model for the "why" (the
-- process-wide, cross-tenant in-memory OTP singleton this replaces) and `danger-otp.persistence.ts`
-- for how the hardening it enables (CSPRNG code, hashed storage, timing-safe compare, a lifetime
-- failed-attempt lock) is wired up.
-- CreateTable
CREATE TABLE "DangerOtp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DangerOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DangerOtp_companyId_key" ON "DangerOtp"("companyId");

-- AddForeignKey
ALTER TABLE "DangerOtp" ADD CONSTRAINT "DangerOtp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
