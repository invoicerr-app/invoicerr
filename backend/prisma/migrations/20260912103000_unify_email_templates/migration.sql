/*
  Unifies every email this application sends onto ONE interpolation engine
  (backend/src/modules/documents/actions/email-template.ts): single-brace `{placeholder}` tokens, an
  unknown placeholder left exactly as written and warned about rather than thrown, an html part plus a
  text one. The two SYSTEM families (signature request, verification code) were the last holdouts — they
  ran on a separate double-brace `{{VAR}}` interpolator whose unknown tokens silently became empty
  strings.

  Three things happen here, in this order:

  1. EXISTING ROWS ARE REWRITTEN, NEVER RESET. A self-hoster may have customised the wording of their
     signature-request or verification-code email; that text is theirs and must survive. Only the
     placeholder TOKENS change, by substring replacement on both `subject` and `body`:
       {{SIGNATURE_NUMBER}} -> {signatureNumber}   {{SIGNATURE_ID}}  -> {signatureId}
       {{SIGNATURE_URL}}    -> {signatureUrl}      {{APP_URL}}       -> {appUrl}
       {{OTP_CODE}}         -> {otpCode}
     All five replacements are applied to both live families rather than per-family, because a
     customised row may legitimately mention any of them (an OTP email that also links the app, say).
     A row mentioning a token this list does not cover (e.g. a hand-added {{CLIENT_NAME}}) keeps it
     verbatim and the engine reports it as an unknown placeholder on the one send that hits it — the
     deliberate "degrade honestly, stay visible" contract, never a silently blank email and never a
     blocked delivery.

  2. THE THREE DEAD FAMILIES GO. INVOICE / PAYMENT / RECEIPT rows were seeded for every company and
     read by nothing: a document's email has come from its own descriptor default or from
     `Company.documentEmailTemplates` (keyed by document type, which is what a pluggable type registry
     needs) since that mechanism shipped. Their rows are deleted before the enum can drop the values.

  3. THE ENUM IS REBUILT. Postgres cannot ALTER TYPE ... DROP VALUE, so the only way to remove a member
     is the same rebuild dance 20260903200000_purge_dead_webhook_events and
     20251127192241_remove_unexisting_plugins_types already use: CREATE the new type, cast the column
     across, rename, drop the old one. The value list below carries every LIVE member at the moment this
     migration runs, which on a FRESH database means the moment its timestamp places it — last, since
     nothing in this repository is timestamped after it and nothing adds a MailTemplateType value except
     20250906170944_initial_migration (SIGNATURE_REQUEST, VERIFICATION_CODE, INVOICE, RECEIPT) and
     20260624130000_rename_receipt_to_payment (PAYMENT), both of which sort before it. That ordering
     hazard is exactly what 20260903170000_restore_document_settled_after_enum_rebuild's own header
     documents, and what src/prisma/migration-fresh-schema.spec.ts now guards automatically.

  Every WHERE below compares `"type"::text`, not the enum value, deliberately: a legacy instance
  baselined at v1.4.4a (src/prisma/sync-schema.ts) replays migrations forward from an enum that did not
  yet contain PAYMENT, and a literal 'PAYMENT' coerced to the enum type would abort the statement
  outright on any database where that member is not present. Comparing text is indifferent to which
  members exist.
*/

-- Etape 1 : reecrit le vocabulaire des gabarits EXISTANTS (les deux familles vivantes), sans toucher a
-- la prose que l'instance a pu personnaliser.
UPDATE "MailTemplate"
SET
  "subject" = replace(
    replace(
      replace(
        replace(replace("subject", '{{SIGNATURE_NUMBER}}', '{signatureNumber}'), '{{SIGNATURE_ID}}', '{signatureId}'),
        '{{SIGNATURE_URL}}',
        '{signatureUrl}'
      ),
      '{{APP_URL}}',
      '{appUrl}'
    ),
    '{{OTP_CODE}}',
    '{otpCode}'
  ),
  "body" = replace(
    replace(
      replace(
        replace(replace("body", '{{SIGNATURE_NUMBER}}', '{signatureNumber}'), '{{SIGNATURE_ID}}', '{signatureId}'),
        '{{SIGNATURE_URL}}',
        '{signatureUrl}'
      ),
      '{{APP_URL}}',
      '{appUrl}'
    ),
    '{{OTP_CODE}}',
    '{otpCode}'
  )
WHERE "type"::text IN ('SIGNATURE_REQUEST', 'VERIFICATION_CODE');

-- Etape 2 : supprime les lignes des trois familles mortes, avant que l'enum ne perde leurs valeurs.
DELETE FROM "MailTemplate" WHERE "type"::text IN ('INVOICE', 'PAYMENT', 'RECEIPT');

-- Etape 3 : reconstruit l'enum sans les trois valeurs purgees.
BEGIN;
CREATE TYPE "MailTemplateType_new" AS ENUM ('SIGNATURE_REQUEST', 'VERIFICATION_CODE');
ALTER TABLE "MailTemplate" ALTER COLUMN "type" TYPE "MailTemplateType_new" USING ("type"::text::"MailTemplateType_new");
ALTER TYPE "MailTemplateType" RENAME TO "MailTemplateType_old";
ALTER TYPE "MailTemplateType_new" RENAME TO "MailTemplateType";
DROP TYPE "MailTemplateType_old";
COMMIT;
