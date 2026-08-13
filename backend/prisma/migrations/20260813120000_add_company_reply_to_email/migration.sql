-- AlterTable: per-company Reply-To address for outgoing mail. Nullable with no
-- default, so existing companies keep today's behaviour (no Reply-To header,
-- unless the MAIL_REPLY_TO environment variable is set) until an address is
-- entered in Settings > Company.
ALTER TABLE "Company" ADD COLUMN     "replyToEmail" TEXT;
