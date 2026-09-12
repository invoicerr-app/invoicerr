-- Splits the whole-array "emailDomains" + "domainsVerifiedAt" columns on "CompanySsoProvider" into a
-- proper per-domain table, "CompanySsoDomain" — see that model's own comment in schema.prisma for why a
-- single timestamp covering an array can never correctly express "this domain is proven, that other one
-- (added later) is not".
--
-- "domainsVerifiedAt" was never written by any code path in this codebase (the feature shipped with no
-- verification challenge at all — see sso-policy.ts's own historical comment), so every existing claim
-- is, by construction, unverified. Nothing is therefore lost by carrying every element of the old
-- "emailDomains" array over as an UNVERIFIED row with a freshly minted token: a company that already
-- typed a domain in still sees it listed and can verify it for real, it just was never "verified"
-- before this table existed either.

-- CreateTable
CREATE TABLE "CompanySsoDomain" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySsoDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- Deliberately scoped to (providerId, domain), never a bare unique index on "domain" alone — see the
-- Prisma model's own comment for why a global uniqueness constraint here would let a squatter block a
-- legitimate company from ever claiming its own domain, and would leak (via the constraint violation
-- itself) the fact that some other tenant had already typed that domain in. The actual "only one
-- company may end up verified for a given domain" property is enforced at verification time, in
-- application code, inside a transaction — never by a database constraint on this column.
CREATE UNIQUE INDEX "CompanySsoDomain_providerId_domain_key" ON "CompanySsoDomain"("providerId", "domain");

-- AddForeignKey
ALTER TABLE "CompanySsoDomain" ADD CONSTRAINT "CompanySsoDomain_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "CompanySsoProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one UNVERIFIED row per element of the old "emailDomains" array.
--
-- `gen_random_uuid()::text` for the row id — the same convention already used by this repo's other
-- hand-written data-backfill migration (20260705120100_backfill_multi_company_data) for a table whose
-- Prisma-side default is `cuid()`, a generator only the application runtime has access to; a
-- random-but-unique id here is exactly as good, since nothing keys off its shape.
--
-- `md5(random()::text || clock_timestamp()::text)` for the token — acceptable ONLY because every row
-- created here is unverified by definition: nobody has published this value in DNS yet, and the very
-- first thing an owner does with a re-added claim is re-mint it (`sso.controller.ts`'s POST
-- /company/sso/domains re-mints rather than erroring on an existing unverified domain).
--
-- `lower(trim(...))` defensively re-normalises each element even though every element was already
-- written through `normalizeDomains` (`lib/sso-policy.ts`) at claim time — cheap insurance against any
-- row written before that normaliser existed, and harmless for rows that were already clean.
-- `ON CONFLICT DO NOTHING` guards the new (providerId, domain) unique index against two array elements
-- that only differed by case (and would otherwise collide once re-normalised) or a source array that
-- somehow already contained a literal duplicate.
INSERT INTO "CompanySsoDomain" ("id", "providerId", "domain", "token", "verifiedAt", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    p."id",
    lower(trim(d.domain)),
    md5(random()::text || clock_timestamp()::text),
    NULL,
    now(),
    now()
FROM "CompanySsoProvider" p
CROSS JOIN LATERAL unnest(p."emailDomains") AS d(domain)
WHERE p."emailDomains" IS NOT NULL AND array_length(p."emailDomains", 1) > 0
ON CONFLICT ("providerId", "domain") DO NOTHING;

-- DropColumn
--
-- Both columns are superseded by "CompanySsoDomain" above. "domainsVerifiedAt" carries no data to lose
-- (see the file header); "emailDomains" has already been copied out, row for row, by the backfill above.
ALTER TABLE "CompanySsoProvider" DROP COLUMN "emailDomains";
ALTER TABLE "CompanySsoProvider" DROP COLUMN "domainsVerifiedAt";
