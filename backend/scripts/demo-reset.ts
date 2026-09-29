/**
 * `npm run demo:reset` (issue #533) — wipes the demo instance's data and rebuilds it, deterministic
 * modulo which random seed it draws (a fresh one on every real run; pass `--seed <value>` for a
 * reproducible one, which `demo-mode-seed.spec.ts` and any manual debugging both rely on). Run this
 * from the built image (`node dist/scripts/demo-reset.js` after `npm run build`, mirroring how
 * `catalogs:release`/`worker.js` are already run in production) or via `tsx` in development.
 *
 * ## Safe while visitors are connected — "build all the new, then swap"
 *
 * This does NOT delete-then-rebuild. It builds every new company for every supported country FIRST,
 * each one fully, inside its own set of writes (`seed-company.ts`'s own real `DocumentsService.
 * runAction` calls, each already transactional at the row level) — and only once EVERY new company has
 * been built successfully does it delete the OLD demo companies, in one final pass. A visitor
 * connected mid-run sees, at worst, a company switcher briefly listing MORE companies than usual (the
 * old generation alongside the new one already built) — never fewer, never a half-built company with
 * some document types present and others missing, and never a moment where the demo account has NO
 * company at all. The delete pass itself is a real transactional company delete per row
 * (`prisma.company.delete`, cascading every child table via the schema's own `onDelete: Cascade`
 * FKs — see `danger.service.ts#resetCompanyData`'s own header for the identical cascade shape), so a
 * single old company is either fully gone or (on a crash mid-sweep) still fully present, never half
 * either way.
 *
 * "Old demo companies" is never a guessed or hardcoded list: it is read as "every company the demo
 * user (`demo@invoicerr.app`) currently belongs to", queried BEFORE this run's own new companies are
 * created — the demo account is the sign-up-closed instance's only account (`lib/registration-policy.
 * ts`'s own demo-mode branch), so every company it belongs to IS demo data, by construction, no
 * separate marker column needed.
 *
 * ## What it seeds
 *
 * One company per country `defaultCountryPolicyCatalog.countries()` currently declares (today:
 * DE/FR/IT/PL/PT), each with domestic + foreign clients, a small article catalog, and at least two
 * documents of every document type that country's own policy offers — see `seed-company.ts`'s own
 * header for exactly which actions build which state. Every date is relative to THIS run's own clock
 * (`new Date()` below, threaded through as `now`), never a fixed literal — the dashboard never looks
 * stale between resets, per the issue's own requirement.
 *
 * ## The demo account itself
 *
 * `demo@invoicerr.app` / `demo`, created once (idempotent — a re-run finds the existing row and
 * changes nothing about it: its email/password are refused-from-changing everywhere ELSE in this
 * codebase, so there is nothing for a re-run to reconcile). Created through the REAL `auth.api.
 * signUpEmail` — never a hand-rolled password hash (see `e2e/cypress/support/commands.ts#resetAndSeed`'s
 * own reasoning, quoted here because it applies verbatim: "the password is hashed by better-auth, and
 * a fixture that writes its own hash is a fixture that breaks the day the auth library changes") —
 * which needs `DEMO_SEED_RUN=1` set on THIS process only, so `lib/registration-policy.ts#decideRegistration`'s
 * own demo-mode branch lets this ONE bootstrap call through without opening sign-up for anyone else
 * (see that file's own header).
 */
process.env.DEMO_SEED_RUN = '1';

import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import prisma from '../src/prisma/prisma.service';
import { auth } from '../src/lib/auth';
import { DEMO_ACCOUNT_EMAIL, DEMO_ACCOUNT_PASSWORD, isDemoModeEnabled } from '../src/modules/demo/demo-flag';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { ArticlesService } from '../src/modules/articles/articles.service';
import { ClientsService } from '../src/modules/clients/clients.service';
import { defaultCountryPolicyCatalog } from '../src/modules/documents/country-policy/registry';
import { deleteInboundFilesForCompany } from '../src/modules/documents/received-invoices/storage';
import { deleteArchivedArtifacts } from '../src/modules/documents/archive/storage';
import { createRng } from '../src/modules/demo/generators/rng';
import { SupportedCountryCode } from '../src/modules/demo/generators/data-pools';
import { seedCountryCompany } from '../src/modules/demo/seed-runtime/seed-company';

const logger = new Logger('demo-reset');

function readSeedArg(): string {
  const flagIndex = process.argv.indexOf('--seed');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  // A fresh seed every real run, per issue #533: "each reset uses a fresh one".
  return `demo-reset-${Date.now()}`;
}

/** Idempotent: reuses the existing row on a re-run rather than erroring — the account's own email and
 *  password are refused from ever changing elsewhere in this codebase (`lib/auth.ts`'s own
 *  `hooks.before`/`deleteUser.beforeDelete`), so there is nothing left for a re-run to reconcile. */
async function ensureDemoUser(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_ACCOUNT_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  const result = await auth.api.signUpEmail({
    body: {
      email: DEMO_ACCOUNT_EMAIL,
      password: DEMO_ACCOUNT_PASSWORD,
      firstname: 'Demo',
      lastname: 'Account',
      name: 'Demo Account',
    } as never,
  });
  const userId = (result as { user?: { id?: string } }).user?.id;
  if (!userId) {
    throw new Error('demo-reset: auth.api.signUpEmail did not return a user id — cannot continue.');
  }
  // better-auth marks a fresh email/password sign-up unverified by default — the demo account is not
  // reached through a verification link (there is no inbox behind it, and demo mode refuses to send
  // one anyway — `mail/mail.service.ts`), so it is marked verified directly, once, here.
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  return userId;
}

/** Erases the STORED FILES (never just the rows — the rows are gone the moment the old `Company` rows
 *  are deleted below, cascading every table via the schema's own FKs) an old demo company's documents
 *  left behind: uploaded/received-invoice attachments and archived, signed PDFs — the same two stores
 *  `danger.service.ts#resetCompanyData`/`instance-reset.service.ts` already erase, read here BEFORE
 *  the company row (and therefore its `DocumentArchive` rows) is deleted, for the identical reason
 *  that function journals storage objects inside its own transaction first: the archive path carries
 *  no `companyId` of its own, so nothing could name those bytes again once the row is gone. */
async function eraseOldCompanyFiles(companyId: string): Promise<void> {
  const archives = await prisma.documentArchive.findMany({ where: { companyId }, select: { uri: true } });
  for (const archive of archives) {
    try {
      await deleteArchivedArtifacts(archive.uri);
    } catch (error) {
      logger.warn(`Could not erase archived artifact ${archive.uri} for company ${companyId}: ${error}`);
    }
  }
  try {
    await deleteInboundFilesForCompany(companyId);
  } catch (error) {
    logger.warn(`Could not erase inbound files for company ${companyId}: ${error}`);
  }
}

async function main(): Promise<void> {
  if (!isDemoModeEnabled()) {
    logger.error(
      'DEMO_MODE is not set on this process — refusing to run. This script rebuilds a demo ' +
        'dataset; running it against a real instance would fabricate a company and documents in it.',
    );
    process.exitCode = 1;
    return;
  }

  const seed = readSeedArg();
  logger.log(`demo:reset starting — seed "${seed}"`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const documentsService = app.get(DocumentsService);
    const articlesService = app.get(ArticlesService);
    const clientsService = app.get(ClientsService);

    const userId = await ensureDemoUser();

    const oldCompanies = await prisma.userCompany.findMany({
      where: { userId },
      select: { companyId: true },
    });
    const oldCompanyIds = oldCompanies.map((row) => row.companyId);
    logger.log(
      `Found ${oldCompanyIds.length} existing demo company(ies) to replace after the new set builds.`,
    );

    const now = new Date();
    const rng = createRng(seed);
    const countries = defaultCountryPolicyCatalog.countries() as SupportedCountryCode[];
    if (countries.length === 0) {
      throw new Error('demo-reset: defaultCountryPolicyCatalog.countries() returned none — nothing to seed.');
    }

    const newCompanyIds: string[] = [];
    for (const countryCode of countries) {
      logger.log(`Seeding a new demo company for ${countryCode}…`);
      const summary = await seedCountryCompany(
        { documentsService, articlesService, clientsService },
        { userId, userEmail: DEMO_ACCOUNT_EMAIL, countryCode, rng, now },
      );
      newCompanyIds.push(summary.companyId);
      logger.log(`  ${summary.companyName} (${countryCode}): ${JSON.stringify(summary.documentsCreated)}`);
    }

    // The swap: every new company exists and is fully built — only now do the old ones go.
    for (const companyId of oldCompanyIds) {
      await eraseOldCompanyFiles(companyId);
    }
    if (oldCompanyIds.length > 0) {
      await prisma.company.deleteMany({ where: { id: { in: oldCompanyIds } } });
      logger.log(`Deleted ${oldCompanyIds.length} old demo company(ies).`);
    }

    logger.log(
      `demo:reset complete — ${newCompanyIds.length} compan${newCompanyIds.length === 1 ? 'y' : 'ies'} seeded.`,
    );
  } finally {
    await app.close();
  }
}

main()
  .catch((error) => {
    logger.error('demo:reset failed', error instanceof Error ? error.stack : String(error));
    const response = (error as { getResponse?: () => unknown })?.getResponse?.();
    if (response) logger.error(`demo:reset failure detail: ${JSON.stringify(response)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // `app.close()` inside `main()` already ran every module's own `onModuleDestroy` — but this
    // process boots the FULL `AppModule`, BullMQ repeatables (document/webhook/backup/transfer
    // sweeps) included, and at least one of those schedulers does not release every timer it holds
    // even once closed (measured: the process idles at low CPU for well over a minute after logging
    // "demo:reset complete" instead of exiting). A Kubernetes CronJob run on a fixed schedule must
    // actually TERMINATE, not idle until the Job's own deadline kills it — every await this script
    // needed has already settled by the time this line runs, so forcing the exit here is safe.
    process.exit(process.exitCode ?? 0);
  });
