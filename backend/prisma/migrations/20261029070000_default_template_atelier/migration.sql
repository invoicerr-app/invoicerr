-- Every company that existed before the template feature saw its PDFs render
-- classic; the owner decided (2026-10-29) that Atelier is the product default,
-- so existing companies move to it too. Classic stays available in Settings.
UPDATE "Company" SET "brandingTemplate" = 'atelier' WHERE "brandingTemplate" IS NULL;
