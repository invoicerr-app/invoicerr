-- An explicit, optional language on
-- the client (authoritative when set — see Client.language's own schema.prisma comment) with the
-- company's own default as the fallback layer (Company.language). Both free-text, like the existing
-- `country`/`countryCode` columns on these same tables: an unsupported or garbage value is never
-- rejected here, only never picked by the resolver
-- (documents/rendering/language/resolve-recipient-language.ts), which falls through to the next layer
-- and ultimately to 'en'.
ALTER TABLE "Client" ADD COLUMN "language" TEXT;
ALTER TABLE "Company" ADD COLUMN "language" TEXT;
