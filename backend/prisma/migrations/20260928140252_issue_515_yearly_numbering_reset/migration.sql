-- Issue #515: a country's numberFormats may declare `reset: "yearly"` for a numbered type
-- (backend/src/modules/documents/country-policy/data/xx.json). When it does, the counter must be
-- keyed by the CALENDAR YEAR of the document's own issue date, never the server clock, so two
-- documents dated in different years can never collide and a document dated in December but
-- numbered in January still continues the OLD year's counter — see
-- numbering/company-number-format.ts#periodKeyFor for the full rule this column exists to support.
--
-- `year` defaults to `0`, the sentinel every existing row now carries: the ONE continuous counter a
-- `reset: "never"` format (or an unconstrained type) always uses, and the same counter a
-- `reset: "yearly"` format still uses for any document dated before
-- `YEARLY_RESET_STARTS_FROM_YEAR` (2027) - so this migration changes NOTHING about a number already
-- issued, or about which row a company's counter reads from today: every row that existed before
-- this migration keeps its `nextNumber` exactly where it stood, now qualified by `year = 0`, and a
-- fresh `year > 0` row is only ever created the first time a `reset: "yearly"` document dated on or
-- after the cutover is actually numbered.
--
-- Warnings:
-- - The primary key for the `DocumentNumberSequence` table will be changed. If it partially fails, the table could be left without primary key constraint.
-- AlterTable
ALTER TABLE "DocumentNumberSequence" DROP CONSTRAINT "DocumentNumberSequence_pkey",
ADD COLUMN     "year" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "DocumentNumberSequence_pkey" PRIMARY KEY ("companyId", "typeId", "year");
