/**
 * REAL round-trip proof of the post-deposit conformity POLLER — gated the same way
 * `superpdp.live.spec.ts` already is (`SUPERPDP_LIVE=1` + the same three
 * credential env vars, `live-gate.ts`, REPRISED verbatim), run the same way:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   SUPERPDP_LIVE=1 npx vitest run superpdp-conformity.live --no-file-parallelism
 *
 * DB-CONNECTED, deliberately — the ONE difference from `superpdp.live.spec.ts`'s own DB-free choice (see
 * that file's own header for why IT stays DB-free): this spec's entire point is to prove the journal
 * itself (`DocumentAuthorityEvent`) genuinely fills with REAL events, not merely that a poller
 * function returns a plausible-looking array in memory. `@/prisma/prisma.service` does `import
 * 'dotenv/config'` at module load, which loads `backend/.env`'s own `DATABASE_URL` (the DEV database,
 * already migrated) since `.env.test.local` sets no `DATABASE_URL` of its own to take
 * priority — this spec runs against `invoicerr_dev`, and cleans up after itself (deletes the
 * throwaway Company, cascading to its DocumentInstance/DocumentAuthorityEvent rows).
 *
 * ## What is genuinely REAL here, and what is substituted (documented, same discipline as superpdp.live.spec.ts)
 *
 *  - The Factur-X build recipe (descriptor → totals → semantic bridge → CII → real EN 16931
 *    Schematron gate → real Factur-X PDF/A-3 embed) is REPRISED from `superpdp.live.spec.ts` — the exact
 *    same pure, DB-free building blocks, not a copy of PRODUCTION CODE (`facturx-provider.ts`) since
 *    that needs a companyId to render a human PDF via Puppeteer — same substitution `superpdp.live.spec.ts`
 *    already documents (a minimal `pdf-lib` PDF stands in for the human-readable page).
 *  - The DEPOSIT is a REAL `PdpClient.sendInvoice()` call against the real superpdp sandbox.
 *  - THE POLLER IS THE REAL PRODUCTION CODE — `buildPdpStatusPoller` (`../../conformity/pollers/
 *    pdp-status-poller.ts`) and `ConformitySweepRunner.runPoll` (`../../conformity/
 *    conformity-sweep-runner.ts`), imported and called exactly as `document-action.processor.ts`
 *    would when a real poll job runs. NOT a copy, NOT a hand-rolled re-implementation.
 *  - The ONE substitution: `ChannelCredentialsService` is a plain stub object handing back the SAME
 *    real credentials `superpdp.live.spec.ts` reads from `process.env` — this spec has no interest in
 *    proving `CompanyChannelConfig` AES-256-GCM storage (that is `channels.service.spec.ts`'s job);
 *    it exists purely so the REAL poller can resolve REAL credentials without a full encrypted-config
 *    row. The poller's own `poll()` method, the journal write, and the read-back are 100% real.
 *
 * ## fr:213 (rejection) — the SECOND `it()` below
 *
 * A deliberately NON-COMPLIANT Factur-X: this spec skips `splitCiiIncludedNotesInObject` /
 * `applyFrenchBusinessProcessInObject` on the EMBEDDED CII (unlike the plain, VALIDATED CII used for
 * the structural/Schematron gate above it) — the exact divergence `facturx-provider.ts`'s own
 * production code NEVER has (it always applies both consistently, see that file's own header), only
 * ever true here, in this deliberately-crafted test artifact. This reproduces the exact historical
 * rejection this codebase's own comments describe ("Element 'ram:Content' must occur exactly 1
 * times", BT-23 absent) — see the test itself for whether superpdp's sandbox still rejects it today.
 */

import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { listAuthorityEvents } from '../../conformity/authority-events.persistence';
import { AuthorityStatusPollerRegistry } from '../../conformity/authority-status-poller';
import { ConformitySweepRunner } from '../../conformity/conformity-sweep-runner';
import { buildPdpStatusPoller } from '../../conformity/pollers/pdp-status-poller';
import { liveDescribe } from '../live-gate';
import { PdpApiError, PdpClient } from './pdp-client';
import { buildLiveFacturx, depositLiveFacturx } from './superpdp-live-facturx';
import {
  resolveSandboxCompany,
  SUPERPDP_BASE_URL,
  SUPERPDP_LIVE_ENV,
  SUPERPDP_BUYER_ENV,
  sandboxBuyer,
  superpdpLiveClient,
} from './superpdp-live-parties';

const describeLive = liveDescribe('SUPERPDP_LIVE', [...SUPERPDP_LIVE_ENV, ...SUPERPDP_BUYER_ENV]);

/** Same stub `ChannelCredentialsService` reasoning as this file's own header — hands the REAL
 *  credentials straight from `process.env` (exactly what `superpdp.live.spec.ts` itself reads) to the
 *  REAL `buildPdpStatusPoller`, without needing a real encrypted `CompanyChannelConfig` row. */
function buildRealCredentialsStub(): ChannelCredentialsService {
  const resolved: ResolvedChannelConfig = {
    providerId: 'pdp',
    channel: 'PDP',
    environment: 'TEST',
    isActive: true,
    config: {
      baseUrl: SUPERPDP_BASE_URL,
      clientId: process.env.SUPERPDP_CLIENT_ID,
      clientSecret: process.env.SUPERPDP_CLIENT_SECRET,
    },
  };
  return { resolveActive: async () => resolved } as unknown as ChannelCredentialsService;
}

/** A throwaway Company + DocumentInstance, exactly the shape the real "send" flow leaves behind
 *  (status "sent", transportRef the deposit id, channelProviderId "pdp"), created directly via Prisma
 *  since this spec's point is the POLLER, not the send action itself (`superpdp.live.spec.ts`). */
async function createSentDocument(name: string, email: string, depositId: string) {
  const company = await prisma.company.create({
    data: {
      name,
      foundedAt: new Date('2020-01-01'),
      address: '1 Conformity Street',
      postalCode: '00000',
      city: 'Testville',
      country: 'France',
      countryCode: 'FR',
      phone: '+33000000000',
      email,
    },
  });
  const document = await prisma.documentInstance.create({
    data: {
      companyId: company.id,
      typeId: 'invoice',
      status: 'sent',
      data: { client: 'live-client' },
      transportRef: depositId,
      channelProviderId: 'pdp',
    },
  });
  return { companyId: company.id, documentId: document.id };
}

/** THE REAL PRODUCTION CODE, not a copy: the only substitution is the credentials stub above.
 *  superpdp's verdict lands in well under a second, so the REAL runPoll is called every 500ms, up to
 *  5s, exactly what successive sweep passes would do. */
async function pollUntilTerminal(companyId: string, documentId: string, depositId: string) {
  const registry = new AuthorityStatusPollerRegistry();
  registry.register(buildPdpStatusPoller({ channelCredentials: buildRealCredentialsStub() }));
  const runner = new ConformitySweepRunner(registry, {} as never); // runPoll never touches the queue
  const job = { companyId, documentId, providerId: 'pdp', transportRef: depositId };
  let sawTerminal = false;
  for (let attempt = 0; attempt < 10 && !sawTerminal; attempt++) {
    await runner.runPoll(job);
    const events = await listAuthorityEvents(companyId, documentId);
    sawTerminal = events.some((e) => e.statusCode === 'fr:202' || e.statusCode === 'fr:213');
    if (!sawTerminal) await new Promise((r) => setTimeout(r, 500));
  }
  const journaled = await listAuthorityEvents(companyId, documentId);
  console.log(
    'REAL journal contents (DocumentAuthorityEvent rows):',
    JSON.stringify(
      journaled.map((e) => ({ statusCode: e.statusCode, statusText: e.statusText, reason: e.reason })),
      null,
      2,
    ),
  );
  return { runner, job, journaled };
}

/** The gated plain CII is always fixed; with `includeMentions: false` the EMBEDDED artifact actually
 *  sent skips the BG-1 note split and BT-23, reproducing the documented historical rejection cause.
 *  `facturx-provider.ts` never has this gap; it exists only in this test artifact. */
async function buildFacturxBytes(client: PdpClient, includeMentions: boolean, timestamp: number) {
  return buildLiveFacturx({
    displayNumber: `INV-CONFORMITY-${timestamp}`,
    seller: await resolveSandboxCompany(client),
    buyer: sandboxBuyer(),
    description: 'Prestation de test (conformity poller live proof)',
    businessProcess: 'embedded',
    fixEmbedded: includeMentions,
  });
}

describeLive('PDP conformity poller — REAL sweep code journals a REAL platform verdict', () => {
  let cleanupCompanyId: string | undefined;

  afterAll(async () => {
    // A real Prisma connection pool is an open handle jest will otherwise warn about — same
    // "DB-connected specs disconnect explicitly" discipline, harmless here since this file is the
    // only consumer of `prisma` in its own process (a lone `jest --runInBand` matching this file).
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (cleanupCompanyId) {
      await prisma.company.delete({ where: { id: cleanupCompanyId } }).catch(() => undefined);
      cleanupCompanyId = undefined;
    }
  });

  it('a compliant deposit: the REAL poller journals real fr:200/201/202 events, and re-polling dedups to zero', async () => {
    const timestamp = Date.now();
    const client = superpdpLiveClient();
    await client.authenticate();
    const facturxPdf = await buildFacturxBytes(client, true, timestamp);
    const invoice = await depositLiveFacturx(client, facturxPdf, `INV-CONFORMITY-${timestamp}`);
    const depositId = String(invoice.id);

    const { companyId, documentId } = await createSentDocument(
      'Conformity Live Test Co',
      `conformity-live-${timestamp}@example.com`,
      depositId,
    );
    cleanupCompanyId = companyId;
    const { runner, job, journaled } = await pollUntilTerminal(companyId, documentId, depositId);

    const codes = journaled.map((e) => e.statusCode);
    expect(codes).toEqual(expect.arrayContaining(['fr:200', 'fr:201', 'fr:202']));
    expect(journaled.every((e) => e.rawPayload !== null)).toBe(true); // the raw platform payload was kept, verbatim
    expect(journaled.some((e) => e.statusCode === 'fr:213')).toBe(false); // never both accepted AND rejected

    // The platform keeps appending statuses after fr:202 (fr:203 "Mise à disposition" arrives later),
    // so first wait, bounded, until a poll finds nothing new: only then is the event list stable.
    let stable = false;
    let known = journaled.map((e) => e.statusCode);
    for (let attempt = 0; attempt < 10 && !stable; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { journaled: added } = await runner.runPoll(job);
      const current = (await listAuthorityEvents(companyId, documentId)).map((e) => e.statusCode);
      if (added > 0)
        console.log(
          'Later platform status journaled:',
          current.filter((c) => !known.includes(c)),
        );
      known = current;
      stable = added === 0;
    }
    if (!stable)
      throw new Error('superpdp kept adding statuses for 10s; the dedup proof needs a stable list');

    // THE LIVE DEDUP PROOF — the exact same real events polled again journal ZERO new rows.
    const before = (await listAuthorityEvents(companyId, documentId)).length;
    const secondPoll = await runner.runPoll(job);
    expect(secondPoll.journaled).toBe(0);
    const after = await listAuthorityEvents(companyId, documentId);
    expect(after.length).toBe(before); // not one extra row from re-polling the identical events
  }, 45_000);

  it('a NON-COMPLIANT deposit (mentions/BT-23 deliberately skipped): does the platform answer fr:213?', async () => {
    const timestamp = Date.now();
    const client = superpdpLiveClient();
    await client.authenticate();
    const facturxPdf = await buildFacturxBytes(client, false, timestamp);
    let invoice: Awaited<ReturnType<PdpClient['sendInvoice']>>;
    try {
      invoice = await client.sendInvoice(Buffer.from(facturxPdf), {
        externalId: `INV-CONFORMITY-REJECT-${timestamp}`,
      });
    } catch (error) {
      // The platform may refuse this artifact at upload, before any conformity verdict: that refusal
      // must itself be the schema error the unsplit BG-1 notes cause.
      if (!(error instanceof PdpApiError)) throw error;
      console.log('NON-COMPLIANT DEPOSIT REFUSED AT UPLOAD:', error.message);
      expect(error.status).toBe(400);
      expect(`${error.message} ${JSON.stringify(error.body)}`).toMatch(/IncludedNote|\}Content'/);
      return;
    }
    const depositId = String(invoice?.id ?? '');
    if (!depositId) {
      console.warn('superpdp refused the upload outright (pre-check) — nothing to poll.');
      return;
    }
    console.log('NON-COMPLIANT DEPOSIT ACCEPTED (pending conformity verdict) — id:', depositId);

    const { companyId, documentId } = await createSentDocument(
      'Conformity Live Reject Co',
      `conformity-live-reject-${timestamp}@example.com`,
      depositId,
    );
    cleanupCompanyId = companyId;
    const { journaled } = await pollUntilTerminal(companyId, documentId, depositId);

    // HARD assertion, not a soft `if` — reproduced live, twice (the raw payload: a real
    // BR-FR-05/BT-22 rejection, "Element
    // 'ram:Content' must occur exactly 1 times", citing the exact missing BG-1 mentions this
    // deliberately-crafted artifact omits). If superpdp's own sandbox ever stops rejecting this
    // shape (a real behavior change on their side), this assertion SHOULD fail loud rather than
    // silently downgrade to a warning — a poller that can only ever prove the success path again
    // would be exactly the kind of false-green this spec exists to rule out.
    const rejected = journaled.find((e) => e.statusCode === 'fr:213');
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toEqual(expect.stringContaining('BG-1'));
    console.log('fr:213 REPRODUCED LIVE — reason:', rejected!.reason);
  }, 30_000);
});
