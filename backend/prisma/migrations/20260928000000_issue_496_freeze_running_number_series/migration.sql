-- Issue #496: document number formats are defined per country and document type
-- (backend/src/modules/documents/country-policy/data/xx.json, `numberFormats`) and no company can
-- change them any more. `Company.numberFormats` stops being a settings column and becomes the list of
-- the company's RUNNING SERIES: the format each series it already started is running under, which
-- keeps being used after this change because continuity of an issued series is a legal obligation in
-- every country this product covers (each country file's `numberFormats.runningSeries` says why).
--
-- For every company, this ONE statement rewrites `numberFormats` to exactly one entry per document
-- type the company has already numbered at least one document of (a `DocumentNumberSequence` row
-- whose counter moved: `bumpSequence` inserts 2 on first use, so `nextNumber > 1` means "at least
-- one number was committed"), holding the pattern that series was running under:
--   - the company's own entry for that type, when it had a non-empty string there (a custom format,
--     or the legacy value `20260913120000_migrate_legacy_number_formats` copied in);
--   - otherwise the pre-#496 shared default, `UPPER(typeId) || '-{year}-{number:4}'`, exactly what
--     the removed `format-number.ts#defaultNumberFormatFor` produced for it.
-- Every other entry is dropped: a format chosen for a type the company never numbered anything of
-- has no series to continue, and the country format applies from its first number. A company that
-- never numbered anything ends with NULL.
--
-- Nothing else is touched. No `DocumentInstance.number`/`displayNumber` (issued numbers are frozen
-- strings, never re-rendered), and no `DocumentNumberSequence` row: every counter goes on from where
-- it stands, so no number is skipped or handed out twice. Idempotent: a second run computes the same
-- value from the same rows and writes nothing (`IS DISTINCT FROM`).
--
-- Proven on real data shapes by backend/src/modules/documents/numbering/running-series.migration.spec.ts,
-- which runs this very file.
UPDATE "Company" AS c
SET "numberFormats" = frozen.formats
FROM (
  SELECT
    company.id,
    (
      SELECT jsonb_object_agg(
        s."typeId",
        CASE
          WHEN jsonb_typeof(company."numberFormats" -> s."typeId") = 'string'
            AND length(company."numberFormats" ->> s."typeId") > 0
            THEN company."numberFormats" -> s."typeId"
          ELSE to_jsonb(upper(s."typeId") || '-{year}-{number:4}')
        END
      )
      FROM "DocumentNumberSequence" AS s
      WHERE s."companyId" = company.id AND s."nextNumber" > 1
    ) AS formats
  FROM "Company" AS company
) AS frozen
WHERE frozen.id = c.id
  AND c."numberFormats"::jsonb IS DISTINCT FROM frozen.formats;
