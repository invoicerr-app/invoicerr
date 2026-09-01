/**
 * REAL round-trip proof of the post-deposit conformity POLLER (root TODO item 10's own named
 * remainder) — gated the same way `pdp.live.spec.ts` already is (`PDP_LIVE=1` + the same three
 * credential env vars, `live-gate.ts`, REPRISED verbatim), run the same way:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   PDP_LIVE=1 npx jest pdp-conformity --no-coverage --runInBand
 *
 * DB-CONNECTED, deliberately — the ONE difference from `pdp.live.spec.ts`'s own DB-free choice (see
 * that file's own header for why IT stays DB-free): this spec's entire point is to prove the journal
 * itself (`DocumentAuthorityEvent`) genuinely fills with REAL events, not merely that a poller
 * function returns a plausible-looking array in memory. `@/prisma/prisma.service` does `import
 * 'dotenv/config'` at module load, which loads `backend/.env`'s own `DATABASE_URL` (the DEV database,
 * already migrated by this task) since `.env.test.local` sets no `DATABASE_URL` of its own to take
 * priority — this spec runs against `invoicerr_dev`, and cleans up after itself (deletes the
 * throwaway Company, cascading to its DocumentInstance/DocumentAuthorityEvent rows).
 *
 * ## What is genuinely REAL here, and what is substituted (documented, same discipline as pdp.live.spec.ts)
 *
 *  - The Factur-X build recipe (descriptor → totals → semantic bridge → CII → real EN 16931
 *    Schematron gate → real Factur-X PDF/A-3 embed) is REPRISED from `pdp.live.spec.ts` — the exact
 *    same pure, DB-free building blocks, not a copy of PRODUCTION CODE (`facturx-provider.ts`) since
 *    that needs a companyId to render a human PDF via Puppeteer — same substitution `pdp.live.spec.ts`
 *    already documents (a minimal `pdf-lib` PDF stands in for the human-readable page).
 *  - The DEPOSIT is a REAL `PdpClient.sendInvoice()` call against the real superpdp sandbox.
 *  - THE POLLER IS THE REAL PRODUCTION CODE — `buildPdpStatusPoller` (`../../conformity/pollers/
 *    pdp-status-poller.ts`) and `ConformitySweepRunner.runPoll` (`../../conformity/
 *    conformity-sweep-runner.ts`), imported and called exactly as `document-action.processor.ts`
 *    would when a real poll job runs. NOT a copy, NOT a hand-rolled re-implementation.
 *  - The ONE substitution: `ChannelCredentialsService` is a plain stub object handing back the SAME
 *    real credentials `pdp.live.spec.ts` reads from `process.env` — this spec has no interest in
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
import { PDFDocument } from 'pdf-lib';

import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import {
  applyFrenchBusinessProcessInObject,
  frenchBusinessProcessCode,
} from '../../formats/semantic/business-process';
import {
  splitCiiIncludedNotes,
  splitCiiIncludedNotesInObject,
} from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { listAuthorityEvents } from '../../conformity/authority-events.persistence';
import { AuthorityStatusPollerRegistry } from '../../conformity/authority-status-poller';
import { ConformitySweepRunner } from '../../conformity/conformity-sweep-runner';
import { buildPdpStatusPoller } from '../../conformity/pollers/pdp-status-poller';
import { liveDescribe } from '../live-gate';
import { PdpClient } from './pdp-client';

const describeLive = liveDescribe('PDP_LIVE', ['PDP_BASE_URL', 'PDP_CLIENT_ID', 'PDP_CLIENT_SECRET']);

const SELLER: SemanticPartyInput = {
  name: 'Burger Queen',
  address: '809 avenue du Languedoc',
  city: 'Millau',
  postalCode: '12100',
  country: 'France',
  email: 'seller@example.fr',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR18000000002' },
    { scheme: 'LEGAL_ID', value: '000000002' },
    { scheme: 'PEPPOL_ENDPOINT', value: '0225:315143296_1422' },
  ],
};
const BUYER: SemanticPartyInput = {
  name: 'Tricatel',
  address: '1 rue de Tricatel',
  city: 'Paris',
  postalCode: '75001',
  country: 'France',
  email: 'buyer@example.fr',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR15000000001' },
    { scheme: 'LEGAL_ID', value: '000000001' },
    { scheme: 'PEPPOL_ENDPOINT', value: '0225:315143296_1421' },
  ],
};

/** Same stub `ChannelCredentialsService` reasoning as this file's own header — hands the REAL
 *  credentials straight from `process.env` (exactly what `pdp.live.spec.ts` itself reads) to the
 *  REAL `buildPdpStatusPoller`, without needing a real encrypted `CompanyChannelConfig` row. */
function buildRealCredentialsStub(): ChannelCredentialsService {
  const resolved: ResolvedChannelConfig = {
    providerId: 'pdp',
    channel: 'PDP',
    environment: 'TEST',
    isActive: true,
    config: {
      baseUrl: process.env.PDP_BASE_URL,
      clientId: process.env.PDP_CLIENT_ID,
      clientSecret: process.env.PDP_CLIENT_SECRET,
    },
  };
  return { resolveActive: async () => resolved } as unknown as ChannelCredentialsService;
}

/** Builds and Schematron-validates a plain CII — always used only for the VALID-path assertions
 *  below; the rejection path builds its own, deliberately divergent, embedded object. */
async function buildFacturxBytes(opts: { includeMentions: boolean; timestamp: number }): Promise<Uint8Array> {
  const descriptor = buildInvoiceDescriptor();
  const data = {
    client: 'live-client',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    currency: 'EUR',
    lines: [
      {
        description: 'Prestation de test (conformity poller live proof)',
        quantity: 1,
        unit: 'unit',
        unitPrice: 100,
        vatRate: '20',
        supplyType: 'SERVICES' as const,
      },
    ],
  };
  const totals = computeDocumentTotals(descriptor, data);
  const euInvoice = buildSemanticInvoice({
    displayNumber: `INV-CONFORMITY-${opts.timestamp}`,
    issueDate: data.issueDate,
    seller: SELLER,
    buyer: BUYER,
    lines: data.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      supplyType: l.supplyType,
    })),
    totals,
  });
  const businessProcessCode =
    (euInvoice['ubl:Invoice']['cbc:ProfileID'] as string | undefined) ??
    frenchBusinessProcessCode(['SERVICES']);

  const service = newEuInvoiceService();

  // The plain CII — ALWAYS gated (structural + Schematron), exactly like `facturx-provider.ts`'s own
  // production path — this is what proves the descriptor/totals/semantic bridge themselves are sound
  // regardless of which embedded artifact this test then chooses to build below.
  const rawCii = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
  const cii = splitCiiIncludedNotes(rawCii);
  const structural = validateStructural(cii, 'cii');
  if (!structural.valid) throw new Error(`structural gate rejected the CII: ${structural.errors.join('; ')}`);
  const schematron = validateSchematron(cii, EN16931_CII_SCH);
  if (!schematron.valid) {
    throw new Error(
      `EN 16931 Schematron gate rejected the CII: ${schematron.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const hostPdf = await PDFDocument.create();
  hostPdf.addPage([595, 842]);
  const hostPdfBytes = Buffer.from(await hostPdf.save());

  const facturxPdf = (await service.generate(euInvoice, {
    format: 'Factur-X-EN16931',
    pdf: {
      buffer: hostPdfBytes,
      filename: `INV-CONFORMITY-${opts.timestamp}.pdf`,
      mimetype: 'application/pdf',
    },
    lang: 'en',
    // THE DELIBERATE DIVERGENCE for the rejection path (`opts.includeMentions: false`): the plain CII
    // just validated ABOVE was fixed via `splitCiiIncludedNotes`/a resolved BT-23 code — the EMBEDDED
    // artifact actually sent skips both fixes entirely when `includeMentions` is false, reproducing
    // this codebase's own documented historical rejection cause (`pdp.live.spec.ts`'s own header:
    // "Element 'ram:Content' must occur exactly 1 times", BT-23 absent). `facturx-provider.ts`'s own
    // PRODUCTION code never has this gap — it always applies both, unconditionally — this divergence
    // exists ONLY in this deliberately-crafted test artifact.
    postProcessor: opts.includeMentions
      ? async (embedded) => {
          const embeddedCii = embedded as Record<string, unknown>;
          splitCiiIncludedNotesInObject(embeddedCii);
          applyFrenchBusinessProcessInObject(embeddedCii, businessProcessCode);
        }
      : undefined,
  })) as Uint8Array;

  return facturxPdf;
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
    const facturxPdf = await buildFacturxBytes({ includeMentions: true, timestamp });

    const client = new PdpClient({
      baseUrl: process.env.PDP_BASE_URL!,
      clientId: process.env.PDP_CLIENT_ID!,
      clientSecret: process.env.PDP_CLIENT_SECRET!,
      apiStyle: 'superpdp',
    });
    await client.authenticate();
    const invoice = await client.sendInvoice(Buffer.from(facturxPdf), {
      externalId: `INV-CONFORMITY-${timestamp}`,
    });
    if (!invoice || String(invoice.id ?? '') === '') {
      throw new Error(`superpdp did not return a usable deposit id: ${JSON.stringify(invoice)}`);
    }
    const depositId = String(invoice.id);
    console.log('DEPOSIT ACCEPTED — id:', depositId);

    // A throwaway Company + DocumentInstance, exactly the shape the real "send" flow leaves behind
    // (status "sent", transportRef the deposit id, channelProviderId "pdp") — created directly via
    // Prisma (never through the HTTP API) since this spec's own point is the POLLER, not the send
    // action itself (already proven by `pdp.live.spec.ts`).
    const company = await prisma.company.create({
      data: {
        name: 'Conformity Live Test Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Conformity Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `conformity-live-${timestamp}@example.com`,
      },
    });
    const companyId = company.id;
    cleanupCompanyId = companyId;
    const document = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'sent',
        data: { client: 'live-client' },
        transportRef: depositId,
        channelProviderId: 'pdp',
      },
    });

    // THE REAL PRODUCTION CODE — not a copy. See this file's own header for the ONE substitution
    // (credentials resolution only).
    const registry = new AuthorityStatusPollerRegistry();
    registry.register(buildPdpStatusPoller({ channelCredentials: buildRealCredentialsStub() }));
    const runner = new ConformitySweepRunner(registry, {} as never); // runPoll never touches the queue

    // superpdp's own verdict lands in well under a second (`pdp.live.spec.ts`'s own observed
    // timestamps) — poll every 500ms, up to 5s, calling the REAL runPoll each time (exactly what
    // successive real sweep passes would do).
    let sawTerminal = false;
    for (let attempt = 0; attempt < 10 && !sawTerminal; attempt++) {
      await runner.runPoll({
        companyId,
        documentId: document.id,
        providerId: 'pdp',
        transportRef: depositId,
      });
      const events = await listAuthorityEvents(companyId, document.id);
      sawTerminal = events.some((e) => e.statusCode === 'fr:202' || e.statusCode === 'fr:213');
      if (!sawTerminal) await new Promise((r) => setTimeout(r, 500));
    }

    const journaled = await listAuthorityEvents(companyId, document.id);
    console.log(
      'REAL journal contents (DocumentAuthorityEvent rows):',
      JSON.stringify(
        journaled.map((e) => ({ statusCode: e.statusCode, statusText: e.statusText, reason: e.reason })),
        null,
        2,
      ),
    );

    const codes = journaled.map((e) => e.statusCode);
    expect(codes).toEqual(expect.arrayContaining(['fr:200', 'fr:201', 'fr:202']));
    expect(journaled.every((e) => e.rawPayload !== null)).toBe(true); // the raw platform payload was kept, verbatim
    expect(journaled.some((e) => e.statusCode === 'fr:213')).toBe(false); // never both accepted AND rejected

    // THE LIVE DEDUP PROOF — the exact same real events polled again journal ZERO new rows.
    const before = journaled.length;
    const secondPoll = await runner.runPoll({
      companyId,
      documentId: document.id,
      providerId: 'pdp',
      transportRef: depositId,
    });
    expect(secondPoll.journaled).toBe(0);
    const after = await listAuthorityEvents(companyId, document.id);
    expect(after.length).toBe(before); // not one extra row from re-polling the identical events
  }, 30_000);

  it('a NON-COMPLIANT deposit (mentions/BT-23 deliberately skipped): does the platform answer fr:213?', async () => {
    const timestamp = Date.now();
    const facturxPdf = await buildFacturxBytes({ includeMentions: false, timestamp });

    const client = new PdpClient({
      baseUrl: process.env.PDP_BASE_URL!,
      clientId: process.env.PDP_CLIENT_ID!,
      clientSecret: process.env.PDP_CLIENT_SECRET!,
      apiStyle: 'superpdp',
    });
    await client.authenticate();
    const invoice = await client.sendInvoice(Buffer.from(facturxPdf), {
      externalId: `INV-CONFORMITY-REJECT-${timestamp}`,
    });
    const depositId = String(invoice?.id ?? '');
    if (!depositId) {
      console.warn('superpdp refused the upload outright (pre-check) — nothing to poll.');
      return;
    }
    console.log('NON-COMPLIANT DEPOSIT ACCEPTED (pending conformity verdict) — id:', depositId);

    const company = await prisma.company.create({
      data: {
        name: 'Conformity Live Reject Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Conformity Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `conformity-live-reject-${timestamp}@example.com`,
      },
    });
    const companyId = company.id;
    cleanupCompanyId = companyId;
    const document = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'sent',
        data: { client: 'live-client' },
        transportRef: depositId,
        channelProviderId: 'pdp',
      },
    });

    const registry = new AuthorityStatusPollerRegistry();
    registry.register(buildPdpStatusPoller({ channelCredentials: buildRealCredentialsStub() }));
    const runner = new ConformitySweepRunner(registry, {} as never);

    let sawTerminal = false;
    for (let attempt = 0; attempt < 10 && !sawTerminal; attempt++) {
      await runner.runPoll({
        companyId,
        documentId: document.id,
        providerId: 'pdp',
        transportRef: depositId,
      });
      const events = await listAuthorityEvents(companyId, document.id);
      sawTerminal = events.some((e) => e.statusCode === 'fr:202' || e.statusCode === 'fr:213');
      if (!sawTerminal) await new Promise((r) => setTimeout(r, 500));
    }

    const journaled = await listAuthorityEvents(companyId, document.id);
    console.log(
      'REAL journal contents for the non-compliant deposit:',
      JSON.stringify(
        journaled.map((e) => ({ statusCode: e.statusCode, statusText: e.statusText, reason: e.reason })),
        null,
        2,
      ),
    );

    // HARD assertion, not a soft `if` — reproduced live, twice, while wiring this very spec (see
    // this task's own report for the raw payload: a real BR-FR-05/BT-22 rejection, "Element
    // 'ram:Content' must occur exactly 1 times", citing the exact missing BG-1 mentions this
    // deliberately-crafted artifact omits). If superpdp's own sandbox ever stops rejecting this
    // shape (a real behavior change on their side), this assertion SHOULD fail loud rather than
    // silently downgrade to a warning — a poller that can only ever prove the success path again
    // would be exactly the kind of false-green this task exists to rule out.
    const rejected = journaled.find((e) => e.statusCode === 'fr:213');
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toEqual(expect.stringContaining('BG-1'));
    console.log('fr:213 REPRODUCED LIVE — reason:', rejected!.reason);
  }, 30_000);
});
