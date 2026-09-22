-- Personal display + mail-language preference (`User.locale`). Nullable and additive: every
-- existing row gets NULL, which already resolves to the same behavior as today (falls through to
-- `Company.language`, then 'en' — see `resolve-user-language.ts`). No CHECK/enum constraint, same
-- posture as `Client.language`/`Company.language` — see `schema.prisma`'s own comment on the column.
ALTER TABLE "user" ADD COLUMN "locale" TEXT;
