/**
 * Migration data-preservation tripwire for #415 ("Support multiple contacts per client").
 *
 * Modeled directly on `migration-fresh-schema.spec.ts` (read that file's own header first - this one
 * reuses its throwaway-database discipline verbatim: a dedicated `invoicerr_migration_client_contacts_
 * <pid>` database, an admin connection derived from `DATABASE_URL` by swapping the path to
 * `/postgres`, `assertThrowawayName` guarding every CREATE/DROP, gated on the SAME
 * `MIGRATION_FRESH_TESTS=1` flag). What THIS file proves is different: not "does a fresh `migrate
 * deploy` match the generated client's enums", but "does the `20260926173754_client_contacts`
 * migration carry every EXISTING client's contact data forward byte-identical, before it drops the
 * four legacy columns".
 *
 * ## Method
 *
 * 1. Copy `prisma/` into a scratch directory, MINUS the `client_contacts` migration folder itself.
 * 2. `prisma migrate deploy` against that copy - the throwaway database ends up in the EXACT
 *    pre-#415 shape (`Client.contactFirstname`/`contactLastname`/`contactEmail`/`contactPhone` still
 *    columns, no `ClientContact` table at all) - proven by inserting rows with a raw `pg` client
 *    using those very columns; the generated Prisma Client in this worktree already reflects the
 *    NEW (post-migration) schema, so it cannot write to a database still in the OLD shape.
 * 3. `prisma migrate deploy` again, this time against the REAL `prisma/migrations` directory (the one
 *    with `client_contacts` included) - Prisma's own `_prisma_migrations` bookkeeping table (written
 *    by step 2) means only the one new migration actually runs.
 * 4. Read back with raw SQL (again: no generated client pointed at a second, ad hoc `DATABASE_URL`)
 *    and assert every inserted row's contact data survived exactly, and that a client with nothing
 *    filled in gets no contact row at all (the design's own explicit choice - see the migration's own
 *    header).
 *
 * Run locally:
 *   cd backend && MIGRATION_FRESH_TESTS=1 npx vitest run src/prisma/migration-client-contacts.spec.ts
 */

import { vi } from 'vitest';

import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from 'pg';

const migrationFreshTestsEnabled = process.env.MIGRATION_FRESH_TESTS === '1';
const describeGated = migrationFreshTestsEnabled ? describe : describe.skip;

// Two `migrate deploy` runs against a cold database, each ~10-20s - the same generous headroom
// `migration-fresh-schema.spec.ts` gives itself for the identical reason.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const BACKEND_ROOT = join(__dirname, '..', '..');
const MIGRATION_UNDER_TEST = '20260926173754_client_contacts';

const THROWAWAY_DB_PREFIX = 'invoicerr_migration_client_contacts_';

function assertThrowawayName(name: string): asserts name is string {
  if (!name.startsWith(THROWAWAY_DB_PREFIX) || !/^[a-z0-9_]+$/i.test(name)) {
    throw new Error(
      `refusing to operate on database "${name}": it does not carry the required ` +
        `"${THROWAWAY_DB_PREFIX}" throwaway prefix.`,
    );
  }
}

function withDatabase(base: URL, database: string): string {
  const url = new URL(base.toString());
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

describeGated('client-contacts migration - data preserved, byte-identical (#415)', () => {
  const dbName = `${THROWAWAY_DB_PREFIX}${process.pid}`;
  assertThrowawayName(dbName);

  let adminClient: Client | undefined;
  let throwawayUrl: string;
  let scratchDir: string | undefined;
  let scratchConfigPath: string | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('MIGRATION_FRESH_TESTS=1 requires DATABASE_URL.');
    }
    const baseUrl = new URL(process.env.DATABASE_URL);

    adminClient = new Client({ connectionString: withDatabase(baseUrl, 'postgres') });
    await adminClient.connect();

    assertThrowawayName(dbName);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
    throwawayUrl = withDatabase(baseUrl, dbName);

    // Step 1: a scratch copy of prisma/ with the migration under test REMOVED, so `migrate deploy`
    // against it lands the database in the exact pre-#415 shape. `prisma.config.ts` at BACKEND_ROOT
    // hardcodes `schema: 'prisma/schema.prisma'` / `migrations.path: 'prisma/migrations'`, and Prisma 7
    // prefers a discovered config file over a bare `--schema` CLI flag - running with `cwd:
    // BACKEND_ROOT` and only `--schema` pointed at the scratch copy would silently keep using the REAL
    // migrations directory (this migration included). `--config` DOES override which config Prisma
    // loads, so this writes its own minimal one pointing at the scratch copy - but the config file
    // itself has to live UNDER `BACKEND_ROOT` (never under the scratch dir, which sits outside this
    // project's own directory tree in `/tmp`): Prisma loads it as a real TS module and resolves its
    // own `import 'prisma/config'` by walking UP from the config file's own location looking for a
    // `node_modules` - a scratch dir under `/tmp` has none to find, a file under `BACKEND_ROOT` finds
    // this project's own straight away. Removed again in `afterAll`.
    scratchDir = mkdtempSync(join(tmpdir(), 'invoicerr-client-contacts-migration-'));
    cpSync(join(BACKEND_ROOT, 'prisma'), scratchDir, { recursive: true });
    rmSync(join(scratchDir, 'migrations', MIGRATION_UNDER_TEST), { recursive: true, force: true });
    scratchConfigPath = join(BACKEND_ROOT, `.migration-client-contacts-scratch-config-${process.pid}.ts`);
    writeFileSync(
      scratchConfigPath,
      [
        "import { defineConfig, env } from 'prisma/config';",
        'export default defineConfig({',
        `  schema: '${join(scratchDir, 'schema.prisma')}',`,
        `  migrations: { path: '${join(scratchDir, 'migrations')}' },`,
        "  datasource: { url: env('DATABASE_URL') },",
        '});',
        '',
      ].join('\n'),
    );

    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--config', scratchConfigPath], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: throwawayUrl },
      stdio: 'inherit',
    });
  });

  afterAll(async () => {
    try {
      if (adminClient) {
        assertThrowawayName(dbName);
        await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      }
    } finally {
      await adminClient?.end();
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
      if (scratchConfigPath) rmSync(scratchConfigPath, { force: true });
    }
  });

  it('carries every realistic pre-existing client contact shape forward exactly, then drops the legacy columns', async () => {
    const pre = new Client({ connectionString: throwawayUrl });
    await pre.connect();

    let companyAId: string;
    let companyBId: string;
    const clientIds: Record<string, string> = {};

    try {
      // Two companies - the migration must never mix contacts across tenants, and inserting from two
      // is what would surface it if it somehow did (it copies 1:1 by `Client.id`, so this is mostly
      // "insert realistic data", but worth having on file per the task's own worked-example list).
      const companyA = await pre.query<{ id: string }>(
        `INSERT INTO "Company" (id, name, "foundedAt", address, "postalCode", city, country, phone, email)
         VALUES ('mig-co-a', 'Migration Co A', now(), '1 Rue Test', '75000', 'Paris', 'France',
                 '+33100000000', 'co-a@example.com') RETURNING id`,
      );
      companyAId = companyA.rows[0].id;
      const companyB = await pre.query<{ id: string }>(
        `INSERT INTO "Company" (id, name, "foundedAt", address, "postalCode", city, country, phone, email)
         VALUES ('mig-co-b', 'Migration Co B', now(), '2 Rue Test', '75000', 'Paris', 'France',
                 '+33100000001', 'co-b@example.com') RETURNING id`,
      );
      companyBId = companyB.rows[0].id;

      async function insertClient(
        id: string,
        companyId: string,
        name: string,
        contact: {
          firstname: string | null;
          lastname: string | null;
          email: string | null;
          phone: string | null;
        },
      ) {
        await pre.query(
          `INSERT INTO "Client"
             (id, "companyId", name, "contactFirstname", "contactLastname", "contactEmail", "contactPhone",
              address, "postalCode", city, country, currency, type, kind, "isSupplier", salutation, sex,
              title, "isActive")
           VALUES ($1, $2, $3, $4, $5, $6, $7, '1 Client Street', '00000', 'Testville', 'France', 'EUR',
                   'COMPANY', 'BUSINESS', false, 'Mr', 'other', 'Doctor', true)`,
          [id, companyId, name, contact.firstname, contact.lastname, contact.email, contact.phone],
        );
      }

      // Company client with all four fields.
      clientIds.allFour = 'mig-client-all-four';
      await insertClient(clientIds.allFour, companyAId, 'Acme SARL', {
        firstname: 'Jean',
        lastname: 'Dupont',
        email: 'jean.dupont@acme.example',
        phone: '+33102030405',
      });

      // INDIVIDUAL client - name is stored blank the same way `createClient` blanks it; the identity
      // lives entirely in the legacy contact columns.
      clientIds.individual = 'mig-client-individual';
      await pre.query(
        `INSERT INTO "Client"
           (id, "companyId", name, "contactFirstname", "contactLastname", "contactEmail", "contactPhone",
            address, "postalCode", city, country, currency, type, kind, "isSupplier", salutation, sex,
            title, "isActive")
         VALUES ($1, $2, '', 'Marie', 'Curie', NULL, NULL,
                 '1 Client Street', '00000', 'Testville', 'France', 'EUR', 'INDIVIDUAL', 'BUSINESS',
                 false, 'Mrs', 'female', 'Professor', true)`,
        [clientIds.individual, companyAId],
      );

      // Only email.
      clientIds.onlyEmail = 'mig-client-only-email';
      await insertClient(clientIds.onlyEmail, companyAId, 'Only Email SARL', {
        firstname: null,
        lastname: null,
        email: 'only-email@example.com',
        phone: null,
      });

      // Only phone.
      clientIds.onlyPhone = 'mig-client-only-phone';
      await insertClient(clientIds.onlyPhone, companyAId, 'Only Phone SARL', {
        firstname: null,
        lastname: null,
        email: null,
        phone: '+33199999999',
      });

      // Empty strings - NOT NULL, so "unchanged" means the migration must NOT convert these to NULL,
      // and must NOT trim/lowercase them either.
      clientIds.emptyStrings = 'mig-client-empty-strings';
      await insertClient(clientIds.emptyStrings, companyAId, 'Empty Strings SARL', {
        firstname: '',
        lastname: '',
        email: '',
        phone: '',
      });

      // All null - the design's own explicit "zero contacts" case: no row at all after migration.
      clientIds.allNull = 'mig-client-all-null';
      await insertClient(clientIds.allNull, companyAId, 'All Null SARL', {
        firstname: null,
        lastname: null,
        email: null,
        phone: null,
      });

      // Unicode/accents and mixed-case email, in the SECOND company - proves both "characters survive
      // exactly" and "no cross-tenant mixing".
      clientIds.unicode = 'mig-client-unicode';
      await insertClient(clientIds.unicode, companyBId, 'Société Générale Café SARL', {
        firstname: 'Émilie',
        lastname: 'Fraçois-Müller',
        email: 'Émilie.Fraçois-Müller@ExAmple.COM',
        phone: '+33 1 23 45 67 89',
      });
    } finally {
      await pre.end();
    }

    // Step 3: apply the REAL migrations directory (including the one under test) against the SAME
    // throwaway database - only `client_contacts` is still pending.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: throwawayUrl },
      stdio: 'inherit',
    });

    // Step 4: read back with raw SQL and assert.
    const post = new Client({ connectionString: throwawayUrl });
    await post.connect();
    try {
      // The four legacy columns are gone.
      const columns = await post.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'Client'`,
      );
      const columnNames = columns.rows.map((r) => r.column_name);
      expect(columnNames).not.toContain('contactFirstname');
      expect(columnNames).not.toContain('contactLastname');
      expect(columnNames).not.toContain('contactEmail');
      expect(columnNames).not.toContain('contactPhone');

      async function contactsFor(clientId: string) {
        const { rows } = await post.query(
          `SELECT "firstName", "lastName", email, phone, "isPrimary", "position"
           FROM "ClientContact" WHERE "clientId" = $1 ORDER BY "position" ASC`,
          [clientId],
        );
        return rows;
      }

      const allFourContacts = await contactsFor(clientIds.allFour);
      expect(allFourContacts).toHaveLength(1);
      expect(allFourContacts[0]).toMatchObject({
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'jean.dupont@acme.example',
        phone: '+33102030405',
        isPrimary: true,
        position: 0,
      });

      const individualContacts = await contactsFor(clientIds.individual);
      expect(individualContacts).toHaveLength(1);
      expect(individualContacts[0]).toMatchObject({
        firstName: 'Marie',
        lastName: 'Curie',
        email: null,
        phone: null,
        isPrimary: true,
      });

      const onlyEmailContacts = await contactsFor(clientIds.onlyEmail);
      expect(onlyEmailContacts).toHaveLength(1);
      expect(onlyEmailContacts[0]).toMatchObject({
        firstName: null,
        lastName: null,
        email: 'only-email@example.com',
        phone: null,
        isPrimary: true,
      });

      const onlyPhoneContacts = await contactsFor(clientIds.onlyPhone);
      expect(onlyPhoneContacts).toHaveLength(1);
      expect(onlyPhoneContacts[0]).toMatchObject({
        firstName: null,
        lastName: null,
        email: null,
        phone: '+33199999999',
        isPrimary: true,
      });

      // Empty strings preserved byte-identical - never converted to NULL by the migration itself
      // (that normalization, when it happens, is `writeClientContacts`'s own `blankToNull`, applied
      // only on a FUTURE application write, never retroactively by this migration).
      const emptyStringsContacts = await contactsFor(clientIds.emptyStrings);
      expect(emptyStringsContacts).toHaveLength(1);
      expect(emptyStringsContacts[0]).toMatchObject({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        isPrimary: true,
      });

      // All null - zero contact rows, the design's own explicit choice.
      const allNullContacts = await contactsFor(clientIds.allNull);
      expect(allNullContacts).toHaveLength(0);

      const unicodeContacts = await contactsFor(clientIds.unicode);
      expect(unicodeContacts).toHaveLength(1);
      expect(unicodeContacts[0]).toMatchObject({
        firstName: 'Émilie',
        lastName: 'Fraçois-Müller',
        email: 'Émilie.Fraçois-Müller@ExAmple.COM',
        phone: '+33 1 23 45 67 89',
        isPrimary: true,
      });

      // At most one primary per client - the partial unique index this migration also adds. Not
      // exercisable by a plain SELECT count (every client above has exactly one contact at most), so
      // proven directly: a second INSERT flagging a second primary for the SAME client must fail.
      await expect(
        post.query(
          `INSERT INTO "ClientContact" (id, "clientId", "isPrimary", "position", "createdAt", "updatedAt")
           VALUES ('mig-second-primary', $1, true, 1, now(), now())`,
          [clientIds.allFour],
        ),
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    } finally {
      await post.end();
    }
  });
});
