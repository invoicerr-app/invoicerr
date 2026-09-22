-- Self-service full data export (`companies.service.ts#exportCompanyData`) — stamps the last time a
-- company pulled its own full export, so the route's own anti-abuse cooldown has something to compare
-- against. Nullable and additive: every existing company gets NULL, which reads as "never exported
-- yet" and is never treated as a rate-limit hit.
ALTER TABLE "Company" ADD COLUMN "lastSelfServiceExportAt" TIMESTAMP(3);
