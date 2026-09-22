-- DropIndex
DROP INDEX "legal_acceptance_userId_documentSlug_version_key";

-- AlterTable
ALTER TABLE "legal_acceptance" ADD COLUMN     "contentHash" TEXT;

-- CreateTable
CREATE TABLE "legal_document_release" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_release_notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_release_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_document_release_slug_idx" ON "legal_document_release"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_release_slug_contentHash_key" ON "legal_document_release"("slug", "contentHash");

-- CreateIndex
CREATE INDEX "legal_document_release_notification_userId_idx" ON "legal_document_release_notification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_release_notification_userId_slug_contentHash_key" ON "legal_document_release_notification"("userId", "slug", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptance_userId_documentSlug_contentHash_key" ON "legal_acceptance"("userId", "documentSlug", "contentHash");

-- AddForeignKey
ALTER TABLE "legal_document_release_notification" ADD CONSTRAINT "legal_document_release_notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
