/**
 * The explicit list of every APPLICATION table this instance owns — every model in `schema.prisma`
 * except `_prisma_migrations` itself (Prisma Migrate's own migration-history table, which
 * `instance-reset.service.ts` must NEVER touch: truncating it would desync `prisma migrate deploy`'s
 * bookkeeping from the schema that is actually live on disk — the exact failure `sync-schema.ts`'s
 * own frozen baseline-migration list works so hard to avoid). Kept as a plain, reviewable array
 * rather than an `information_schema.tables` scan: a dynamic scan would ALSO catch
 * `_prisma_migrations` unless carefully filtered, and "carefully filtered" is precisely the kind of
 * clever code a reset this destructive should never depend on.
 *
 * `TRUNCATE ... CASCADE` (rather than a hand-ordered `DELETE` per table) is deliberate: with ~50
 * models and several optional/self-referencing FKs, a hand-maintained delete ORDER is exactly the
 * kind of thing that silently rots the next time a model is added — CASCADE reads the FK graph from
 * the live schema itself, every time, so this list only ever needs to name every table, never order
 * them.
 *
 * Table names are the Prisma model name UNLESS the model declares its own `@@map` — copied verbatim
 * from `schema.prisma`; a typo here is caught immediately at run time (Postgres refuses an unknown
 * relation), never silently skipped. `reset-tables.spec.ts` also cross-checks this list against
 * `schema.prisma` itself so a new model added later fails a test instead of silently surviving a
 * "reset the instance" call.
 */
export const INSTANCE_RESET_TABLES: readonly string[] = [
  'Company',
  'company_subscription',
  'polar_webhook_event',
  'CurrencyRate',
  'user_company',
  'Client',
  'PartyIdentifier',
  'MailTemplate',
  'Article',
  'Project',
  'TimeEntry',
  'Webhook',
  'invitation_code',
  'company_ownership_transfer',
  'user',
  'legal_acceptance',
  'legal_document_release',
  'legal_document_release_notification',
  'api_key',
  'session',
  'account',
  'verification',
  'Log',
  'DocumentInstance',
  'DocumentSchedule',
  'DocumentPayment',
  'PaymentCheckoutSession',
  'BankStatement',
  'BankStatementLine',
  'DocumentReminder',
  'DocumentArchive',
  'DocumentAuthorityEvent',
  'DocumentDownloadToken',
  'Signature',
  'DangerOtp',
  'ClientPortalToken',
  'DocumentNumberSequence',
  'PecFilenameSequence',
  'DocumentCountryActionRule',
  'CountryIdentifierRequirement',
  'B2gRoutingRule',
  'CompanyChannelConfig',
  'CompanyPaymentMethodConfig',
  'CompanyCustomField',
  'ExpenseCategory',
  'CompanySsoProvider',
  'CompanySsoDomain',
  'CompanySigningCertificate',
  'CompanyAtcudSeries',
  'BackupRun',
  'InstanceResetOtp',
  'PendingStorageErasure',
];
