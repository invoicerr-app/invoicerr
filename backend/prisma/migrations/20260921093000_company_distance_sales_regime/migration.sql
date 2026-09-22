-- Where a seller's intra-Community distance sales to consumers are taxed: "ORIGIN" (the seller's own
-- member state, Directive 2006/112/EC art. 32 once art. 59c(1) disapplies art. 33(a) below the EUR
-- 10 000 per-calendar-year, EU-wide threshold) or "DESTINATION" (the buyer's member state, art. 33(a),
-- whether because the threshold was crossed or because the seller opted in under art. 59c(3)).
-- Nullable and additive: every existing company gets NULL, which reads as "never declared" and is
-- deliberately NOT treated as either regime — sending an invoice that actually depends on the answer
-- (a cross-border B2C sale of goods inside the EU) is refused by name until the company declares one
-- (documents/tax/resolve-invoice-tax.ts#UndeclaredDistanceSalesRegimeError). No backfill: the
-- threshold counts sales this database has never seen, so there is nothing here to compute it from.
ALTER TABLE "Company" ADD COLUMN "distanceSalesRegime" TEXT;
