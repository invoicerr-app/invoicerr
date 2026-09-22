/**
 * REAL round-trip proof of PDP RECEPTION — gated the same way `pdp.live.spec.ts`/
 * `pdp-conformity.live.spec.ts` already are (`PDP_LIVE=1` + the same three credential env vars,
 * `live-gate.ts`, REPRISED verbatim), run the same way:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   PDP_LIVE=1 npx jest pdp-reception.live --no-coverage --runInBand
 *
 * DB-CONNECTED, deliberately — same reasoning `pdp-conformity.live.spec.ts`'s own header gives for
 * ITS OWN choice: this spec's whole point is that a REAL `received-invoice` `DocumentInstance` genuinely
 * gets created from a REAL PDP inbound deposit, not merely that a poller function returns a
 * plausible-looking array in memory.
 *
 * ## What this spec proves LIVE, and how — see `pdp-reception.ts`'s own header for the full,
 * dated evidence this recipe is built from:
 *
 *  1. ONLY ONE PDP account is available to this session (`.env.test.local` carries ONE client_id/
 *     secret pair, not a separate seller+buyer pair — see `credentials-guide.md`'s own PDP section).
 *     A real cross-company B2B deposit therefore cannot be tested here; a SELF-ADDRESSED one can —
 *     this company depositing an invoice to its OWN connected identifiers (VAT `FR18000000002`,
 *     SIREN-ish `000000002`, routing `315143296_1422` — the exact identity `GET /v1.beta/companies/me`
 *     resolves for these credentials, confirmed live) — exactly the "envoi vers notre propre SIREN"
 *     self-test the task named as the fallback when a true second party isn't available.
 *  2. `PdpClient.listInvoices({direction:'in'})` genuinely lists the deposit's own INBOUND twin — a
 *     DIFFERENT id from the outbound deposit's own, proven live (`pdp-reception.ts`'s own header).
 *  3. THE POLLER AND THE RUNNER ARE REAL PRODUCTION CODE — `buildPdpReceptionPoller`
 *     (`../../conformity/pollers/pdp-reception-poller.ts`) and `PdpReceptionSweepRunner`
 *     (`../../conformity/reception-sweep-runner.ts`), imported and run exactly as the BullMQ
 *     repeatable would. NOT a copy, NOT a hand-rolled re-implementation.
 *  4. `DocumentsService` is ALSO real production code (real descriptor, real
 *     `registerReceivedInvoiceActions`, real country-policy evaluation) — the ONE thing narrowed down
 *     from the full app graph is which OTHER document types/transports it carries (none needed here),
 *     the same "construct just enough of the real service" choice
 *     `documents.service.received-invoice.spec.ts#buildService` already makes for its own (mocked-
 *     persistence) unit coverage — this spec's own version does NOT mock `./persistence` or
 *     `./received-invoices/supplier-reconciliation`, so every write is a REAL Prisma write.
 *  5. The ONE substitution: `ChannelCredentialsService` is a plain stub object handing back the SAME
 *     real credentials this file reads from `process.env` — identical reasoning
 *     `pdp-conformity.live.spec.ts`'s own header already gives for its own stub.
 *
 * ## The lifecycle-status PUSH — LIVE-VERIFIED NEGATIVE, not re-asserted here
 *
 * `pdp-client.ts#pushLifecycleStatus`'s own header already documents, with full evidence (multiple
 * path variants, all a generic 404), that the sandbox's "API Flux" does not expose this endpoint
 * today. This spec's own "approve"/"record-payment" steps below still exercise the REAL push call
 * (through the REAL `pdpStatusPusher`) — proving it does not crash the action, never re-asserting the
 * already-documented 404 itself (that would just slow this spec down for no new information).
 */
import { PDFDocument } from 'pdf-lib';

import { ActionExtensionRegistry } from '../../actions/action-extensions';
import { ActionRegistry } from '../../actions/action-registry';
import { registerReceivedInvoiceActions } from '../../actions/received-invoice-actions';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import { ContributionRegistry } from '../../contributions/contribution-registry';
import { PdpReceptionSweepRunner } from '../../conformity/reception-sweep-runner';
import { DocumentsService } from '../../documents.service';
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildReceivedInvoiceDescriptor } from '../../descriptors/received-invoice.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from '../../descriptors/field-kinds';
import { DocumentTypeRegistry } from '../../descriptors/type-registry';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import {
  splitCiiIncludedNotes,
  splitCiiIncludedNotesInObject,
} from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { EntityReferenceRegistry } from '../../references/reference-registry';
import { TransportRegistry } from '../../transports/transport-registry';
import prisma from '@/prisma/prisma.service';
import { detectAndReseedCountryPolicyDrift } from '../../country-policy/boot-reseed';
import { liveDescribe } from '../live-gate';
import { buildPdpReceptionStatusPusher } from './pdp-reception';
import { PdpClient } from './pdp-client';

const describeLive = liveDescribe('PDP_LIVE', ['PDP_BASE_URL', 'PDP_CLIENT_ID', 'PDP_CLIENT_SECRET']);

// The exact identity `GET /v1.beta/companies/me` resolves for these credentials — see this file's own
// header, point 1. Seller AND buyer, deliberately: the self-addressed deposit.
const SELF: SemanticPartyInput = {
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

/** Same stub reasoning `pdp-conformity.live.spec.ts`'s own header documents for ITS OWN stub — hands
 *  the REAL credentials straight from `process.env` to the REAL poller/pusher/runner, without needing
 *  a real encrypted `CompanyChannelConfig` row. Both `resolveActive` (the poller/pusher's own call)
 *  AND `listActiveByProvider` (the sweep's own "which companies have PDP connected" call) resolve to
 *  the SAME one company created below. */
function buildRealCredentialsStub(companyId: string): ChannelCredentialsService {
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
  return {
    resolveActive: async () => resolved,
    listActiveByProvider: async () => [{ ...resolved, companyId }],
  } as unknown as ChannelCredentialsService;
}

/** A REAL, but minimal, `DocumentsService` — same "construct just enough of the real service" choice
 *  `documents.service.received-invoice.spec.ts#buildService` already makes for its own unit coverage,
 *  except NOTHING is mocked here (see this file's own header, point 4): every write below is a real
 *  Prisma write, gated by the REAL country-policy catalog. */
function buildRealDocumentsService(pdpStatusPusher: ReturnType<typeof buildPdpReceptionStatusPusher>) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildReceivedInvoiceDescriptor());
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);
  const actionRegistry = new ActionRegistry();
  registerReceivedInvoiceActions(actionRegistry, undefined, pdpStatusPusher);
  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

/** Builds and Schematron-validates a real Factur-X PDF, self-addressed — same recipe
 *  `pdp.live.spec.ts`/`pdp-conformity.live.spec.ts` already use (buildInvoiceDescriptor is imported
 *  only to feed `computeDocumentTotals`, exactly like those two files). */
async function buildSelfAddressedFacturxBytes(timestamp: number): Promise<Uint8Array> {
  const descriptor = buildInvoiceDescriptor();
  const data = {
    client: 'live-client',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    currency: 'EUR',
    lines: [
      {
        description: 'Reception live proof',
        quantity: 1,
        unit: 'unit',
        unitPrice: 42,
        vatRate: '20',
        supplyType: 'SERVICES' as const,
      },
    ],
  };
  const totals = computeDocumentTotals(descriptor, data);
  const euInvoice = buildSemanticInvoice({
    displayNumber: `INV-RECEPTION-${timestamp}`,
    issueDate: data.issueDate,
    seller: SELF,
    buyer: SELF,
    lines: data.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      supplyType: l.supplyType,
    })),
    totals,
  });

  const service = newEuInvoiceService();
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
  return (await service.generate(euInvoice, {
    format: 'Factur-X-EN16931',
    pdf: { buffer: hostPdfBytes, filename: `INV-RECEPTION-${timestamp}.pdf`, mimetype: 'application/pdf' },
    lang: 'en',
    postProcessor: async (embedded) => {
      splitCiiIncludedNotesInObject(embedded as Record<string, unknown>);
    },
  })) as Uint8Array;
}

describeLive('PDP reception — REAL self-addressed deposit becomes a REAL received-invoice', () => {
  let cleanupCompanyId: string | undefined;

  // This spec never boots the full Nest app (no `CountryPolicyBootReseedService.onModuleInit` runs),
  // so the DB-backed country-action policy this session's own DATABASE_URL points at could be stale —
  // missing THIS task's own new `received-invoice`/`record-payment` rule, e.g. on a fresh checkout or
  // a dev DB nobody has booted the app against since this rule was added. Same idempotent, drift-
  // detecting correction `CountryPolicyBootReseedService` itself calls at every real boot — safe to
  // call here too, a genuine no-op once the table already matches `data/*.json`.
  beforeAll(async () => {
    await detectAndReseedCountryPolicyDrift(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (cleanupCompanyId) {
      await prisma.company.delete({ where: { id: cleanupCompanyId } }).catch(() => undefined);
      cleanupCompanyId = undefined;
    }
  });

  it('deposit (self-addressed) -> direction=in lists it -> real sweep creates a real received-invoice ' +
    '-> approve -> record-payment, all through REAL production code', async () => {
    const timestamp = Date.now();
    const facturxPdf = await buildSelfAddressedFacturxBytes(timestamp);

    const client = new PdpClient({
      baseUrl: process.env.PDP_BASE_URL!,
      clientId: process.env.PDP_CLIENT_ID!,
      clientSecret: process.env.PDP_CLIENT_SECRET!,
      apiStyle: 'superpdp',
    });
    await client.authenticate();
    const outbound = await client.sendInvoice(Buffer.from(facturxPdf), {
      externalId: `INV-RECEPTION-${timestamp}`,
    });
    if (!outbound || String(outbound.id ?? '') === '') {
      throw new Error(`superpdp did not return a usable deposit id: ${JSON.stringify(outbound)}`);
    }
    console.log('OUTBOUND deposit accepted — id:', outbound.id);

    // The inbound TWIN's own id is DIFFERENT — see this file's own header, point 2. Poll `direction=in`
    // for a few seconds (the twin appears within ~1s per prior live observation) and pick the one
    // created most recently, since this same sandbox account may carry earlier inbound deposits from
    // previous runs of this exact spec.
    let inboundId: number | undefined;
    for (let attempt = 0; attempt < 10 && !inboundId; attempt++) {
      const { data } = await client.listInvoices({ direction: 'in', limit: 10 });
      const newest = [...data].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];
      if (newest && new Date(newest.created_at).getTime() >= timestamp - 2000) {
        inboundId = newest.id;
      } else {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (!inboundId) {
      throw new Error("direction=in never listed this deposit's own inbound twin — hard failure.");
    }
    console.log('INBOUND twin id:', inboundId);

    // A real Company, exactly the shape `pdp-conformity.live.spec.ts` already creates directly via
    // Prisma (never through the HTTP API) — this spec's own point is reception, not company signup.
    const company = await prisma.company.create({
      data: {
        name: 'Reception Live Test Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Reception Street',
        postalCode: '00000',
        city: 'Testville',
        country: 'France',
        countryCode: 'FR',
        phone: '+33000000000',
        email: `reception-live-${timestamp}@example.com`,
      },
    });
    const companyId = company.id;
    cleanupCompanyId = companyId;

    const credentialsStub = buildRealCredentialsStub(companyId);
    const pdpStatusPusher = buildPdpReceptionStatusPusher(credentialsStub);
    const documentsService = buildRealDocumentsService(pdpStatusPusher);
    const runner = new PdpReceptionSweepRunner(credentialsStub, documentsService);

    const sweepResult = await runner.runSweep();
    console.log('REAL sweep result:', JSON.stringify(sweepResult));
    expect(sweepResult.companies).toBe(1);
    // >= 1, never a hard `=== 1`: this sandbox account may carry earlier inbound deposits from
    // previous runs of this exact spec that were never cleaned up (a superpdp-side artifact, not
    // this codebase's own state) — the HARD assertion is on THIS run's own deposit, checked next.
    expect(sweepResult.imported).toBeGreaterThanOrEqual(1);

    // This same sandbox superpdp account accumulates every self-addressed deposit any past run of
    // this spec ever made (superpdp itself has no cleanup — only the freshly-created Company row
    // above is ever deleted, in `afterEach`) — `listInbound` above (`limit: 50`) can therefore
    // legitimately return MORE than just THIS run's own deposit, and since `companyId` is BRAND NEW
    // every run, dedup finds none of them already known and imports every one it sees. The hard
    // assertion is on THIS run's own deposit specifically — matched by `data.pdpInboundId`, never
    // "whichever row happened to be created first".
    const createdForThisRun = await prisma.documentInstance.findFirst({
      where: {
        companyId,
        typeId: 'received-invoice',
        data: { path: ['pdpInboundId'], equals: String(inboundId) },
      },
    });
    const created = createdForThisRun;
    if (!created) {
      throw new Error(
        `The REAL sweep ran but no received-invoice DocumentInstance carries THIS run's own ` +
          `pdpInboundId (${inboundId}) — hard failure.`,
      );
    }
    const data = created.data as Record<string, unknown>;
    console.log(
      'REAL received-invoice created:',
      JSON.stringify({ id: created.id, status: created.status, data }),
    );
    expect(created.status).toBe('received');
    expect(data.pdpProviderId).toBe('pdp');
    expect(typeof data.fileRef).toBe('string');
    expect((data.fileRef as string).length).toBeGreaterThan(0);
    // The self-addressed identity's own name, structurally extracted from the REAL downloaded
    // Factur-X (never invented) — see `pdp-reception-poller.ts`'s own header on why this reuses the
    // SAME extraction the manual upload screen uses.
    expect(data.supplier).toBe('Burger Queen');
    expect(data.currency).toBe('EUR');

    // "approve" — real production code, real Prisma write, real (best-effort, documented-404) push.
    const approveResult = await documentsService.runAction(companyId, 'received-invoice', 'approve', {
      documentId: created.id,
      data: {},
    });
    expect(approveResult.document?.status).toBe('approved');

    // "record-payment" — same, plus the "paid" push attempt once the recorded amount reaches the
    // record's own stated gross.
    const grossAmount = typeof data.grossAmount === 'number' ? data.grossAmount : 50.4; // 42 + 20% VAT
    const paymentResult = await documentsService.runAction(companyId, 'received-invoice', 'record-payment', {
      documentId: created.id,
      data: {},
      params: { amount: grossAmount, currency: 'EUR', paidAt: new Date().toISOString() },
    });
    expect(paymentResult.changed).toBe(true);
    expect(paymentResult.createdPaymentId).toBeTruthy();
    console.log('REAL payment recorded:', paymentResult.message);
  }, 60_000);
});
