-- The retention citation as a translatable `{ key, params }` message, written alongside the
-- verbatim English `retentionBasis`. No backfill: a row written before this column keeps NULL and
-- the UI renders its stored text as it always did.
ALTER TABLE "DocumentArchive" ADD COLUMN "retentionBasisMessage" JSONB;
