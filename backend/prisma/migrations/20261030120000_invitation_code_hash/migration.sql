-- Invitation codes become digests at rest: `codeHash` is what the app searches, `codePrefix` is the
-- non-secret preview the settings screen already showed. `code` stays nullable for the boot-time
-- backfill (`invitation-code-backfill.ts`) that digests rows written before this migration; new rows
-- leave it null. A later migration can drop the column once every deployment has booted once.

-- AlterTable
ALTER TABLE "invitation_code" ADD COLUMN "codeHash" TEXT;
ALTER TABLE "invitation_code" ADD COLUMN "codePrefix" TEXT;
ALTER TABLE "invitation_code" ALTER COLUMN "code" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "invitation_code_codeHash_key" ON "invitation_code"("codeHash");
