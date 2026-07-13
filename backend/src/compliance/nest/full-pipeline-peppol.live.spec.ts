/**
 * FULL-PIPELINE live proof — COMPLIANCE_AUDIT.md M-14/M-15.
 *
 * M-14: every existing live proof (peppol-sh-live.spec.ts, ksef-live, pdp-live, sdi-live, …) calls
 * `provider.transmit()`/`provider.poll()` directly. None of them drive a document through the REAL
 * `ComplianceEngine.resolve()` → `ComplianceExecutor.execute()` → `ApplySignalService` → (BullMQ
 * `TransmitProcessor`/`PollProcessor`) pipeline the way a real invoice actually goes out in
 * production. This spec closes that gap for a PEPPOL-channel country — Germany (DE) — using the
 * credential-free peppol.sh sandbox (self-signup, zero secrets; see peppol-sh-live.spec.ts /
 * `PEPPOL_AP_PROVIDER=peppol-sh`).
 *
 * DE is the interesting case because its PRIMARY format is XRECHNUNG, not a Peppol syntax — the
 * only reason `PeppolTransmissionProvider.transmit()` gets a usable artifact at all is the F-7 fix
 * (`buildArtifacts()` now also emits a PEPPOL_BIS artifact when the plan declares a PEPPOL channel,
 * even though the country's authoritative syntax is something else). `peppol-f7-reachability.spec.ts`
 * proves that mechanism with hand-injected fakes (real engine + executor, but a fake AP port and a
 * fake credentials port). THIS spec proves the same mechanism with NOTHING faked: real Nest DI
 * (`ComplianceCoreModule`/`ComplianceWorkerModule`/`QueueModule`), a real Postgres-backed Invoice
 * (so `InvoiceRenderingService` — the real UBL/XRechnung builder — actually runs), real encrypted
 * per-company credentials (`ChannelCredentialsService`), and a real HTTP round-trip to the peppol.sh
 * sandbox.
 *
 * Driven end to end:
 *   resolve(ctx)                                             [real engine — engine/compliance-engine.ts]
 *     → docStore.save(status: ISSUED) + dispatcher.enqueueTransmit()
 *     → TransmitProcessor (real BullMQ worker, nest/queue/processors/transmit.processor.ts)
 *       → ComplianceService.computeSendOutcome()
 *         → ComplianceExecutor.execute()                     [real executor — execution/executor.ts]
 *           → FormatProviderRegistry.buildAll()               [real UBL builder, DB-backed
 *                                                                InvoiceRenderingService — proves the
 *                                                                F-7 PEPPOL_BIS artifact is genuinely
 *                                                                built, never hand-injected]
 *           → TransmissionProviderRegistry.transmitAll()
 *             → PeppolTransmissionProvider.transmit()         [real peppol.sh AP adapter, real HTTP]
 *     → ApplySignalService.apply()                            [event-sourced LifecycleRuntime]
 *       → ISSUED -> DELIVERED, DELIVER event persisted.
 *
 * Then, to prove "DELIVERED" corresponds to a REAL peppol.sh acceptance and not merely a local
 * status flip: DE's regime is POST_AUDIT/non-blocking (profiles/data/de.ts) and its Peppol channel
 * has no configured `lifecycle.response` window, so `LifecycleRuntime.armNext()` does not arm a
 * SCHEDULE_POLL driver once DELIVERED is reached — the F-2 fallback-poll wiring in
 * `ApplySignalService.apply()` only fires for an armed `AWAIT_CALLBACK` effect (a blocking clearance
 * phase, or a configured buyer-response window), and no real country profile in this repo combines
 * either of those with the PEPPOL channel. That is genuine, intentional lifecycle behaviour — DE
 * reaching DELIVERED with no autonomous poll job is what production actually does for a document
 * sent over Peppol, not a shortcoming of this test (see ksef-mock-tests-false-confidence: do not
 * manufacture a poll that production never schedules just to exercise more code). So the second half
 * of this test polls the SAME DI-resolved, credentialed `TransmissionProviderRegistry`'s 'peppol'
 * provider directly — the exact instance and `poll()` implementation `PollProcessor` would call —
 * until the sandbox confirms CLEARED (peppol.sh 'delivered'), closing the loop the autonomous queue
 * path does not exercise for this particular country/regime combination.
 *
 * Gating: mirrors peppol-sh-live.spec.ts (`PEPPOL_LIVE=1` + `PEPPOL_AP_PROVIDER=peppol-sh`, no
 * credentials required — self-signup) PLUS `REDIS_URL` (same gate phase2-transmit-poll.spec.ts uses)
 * since this spec drives the real BullMQ `QueueModule`/`ComplianceWorkerModule` DI graph against a
 * real Postgres + Redis. Deliberately named with `.live.spec.ts` (matches the `live`-job
 * `--testPathPattern` in compliance-live.yml) and placed OUTSIDE `nest/queue/__tests__` (so the
 * `queue-integration` CI job's `--testPathPattern 'compliance/nest/queue/__tests__'` never picks it
 * up — that job wires Redis but not Postgres, and this spec needs both plus network egress). In any
 * offline run (no PEPPOL_AP_PROVIDER/no REDIS_URL) this file self-skips before importing anything
 * that would touch the network or a DB connection.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';
import { TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { defaultLogger } from '../execution/logger';
import { TransmissionResult } from '../execution/types';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { DE_B2B } from '../providers/format/__fixtures__/invoices';
import { liveDescribe } from '../providers/transmission/live-gate';
import { TransmissionProviderRegistry } from '../providers/transmission/registry';
import { TransmissionProvider } from '../providers/transmission/transmission-provider';
import { ComplianceQueueDispatcher } from './queue/compliance-queue.dispatcher';
import { ComplianceWorkerModule } from './queue/compliance-worker.module';
import { QueueModule } from './queue/queue.module';

const isPeppolSh = process.env.PEPPOL_AP_PROVIDER === 'peppol-sh';
const hasQueueInfra = !!process.env.REDIS_URL;
if (isPeppolSh && !hasQueueInfra) {
  process.stderr.write(
    '[full-pipeline-peppol.live] PEPPOL_AP_PROVIDER=peppol-sh but REDIS_URL is unset — this spec ' +
      'drives the real BullMQ+Postgres DI graph (queue-integration-style infra required), skipping.\n',
  );
}
const describeLive = isPeppolSh && hasQueueInfra ? liveDescribe('PEPPOL_LIVE', []) : describe.skip;

async function waitFor<T>(
  check: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await check();
    if (predicate(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms (last value: ${JSON.stringify(last)})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describeLive(
  'Full pipeline live proof: resolve() -> executor -> real peppol.sh transmit -> applySignal (DE)',
  () => {
    jest.setTimeout(300_000);

    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let docStore: PrismaComplianceDocumentStore;
    let dispatcher: ComplianceQueueDispatcher;
    let registry: TransmissionProviderRegistry;

    let companyId: string;
    let clientId: string;
    let invoiceId: string;
    let documentId: string | undefined;

    beforeAll(async () => {
      process.env.CREDENTIALS_ENCRYPTION_KEY ??=
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      // 1) The real Nest DI graph — exactly what the dedicated worker process boots
      //    (ComplianceWorkerModule -> ComplianceCoreModule, unmodified): real
      //    FormatProviderRegistry/InvoiceRenderingService, real
      //    TransmissionProviderRegistry/ChannelCredentialsService, real ApplySignalService.
      moduleRef = await Test.createTestingModule({
        imports: [QueueModule, ComplianceWorkerModule],
      }).compile();
      await moduleRef.init();

      prisma = moduleRef.get(PrismaService);
      docStore = moduleRef.get(PrismaComplianceDocumentStore);
      dispatcher = moduleRef.get(ComplianceQueueDispatcher);
      registry = moduleRef.get(TransmissionProviderRegistry);
      // F-3 guard (mirrors phase2-transmit-poll.spec.ts): must be the CREDENTIALED registry, never
      // `defaultTransmissionRegistry` — otherwise the credentials written below would never resolve.
      expect(registry.credentials).toBeDefined();

      // 2) peppol.sh bootstrap — reuse env creds or self-signup (zero-secret sandbox), identical to
      //    peppol-sh-live.spec.ts.
      const timestamp = Date.now();
      const { PeppolShApClient } = await import('../providers/transmission/peppol/peppol-sh-client.js');
      let apiKey = process.env.PEPPOL_SH_API_KEY;
      let apCompanyId = process.env.PEPPOL_SH_COMPANY_ID;
      if (!apiKey) {
        const email = `invoicerr-fullpipeline-${timestamp}@example.com`;
        const signup = await PeppolShApClient.signup(email, 'Invoicerr Full-Pipeline Test');
        apiKey = signup.apiKey;
        apCompanyId = undefined; // fresh account → fresh company
        console.log(`peppol.sh self-signup OK: account ${signup.accountId} (${email})`);
      }
      if (!apCompanyId) {
        const created = await PeppolShApClient.createCompany(apiKey, {
          name: DE_B2B.data.company.name,
          taxId: 'DE123456789',
          country: 'DE',
          address: {
            street: DE_B2B.data.company.address ?? undefined,
            city: DE_B2B.data.company.city ?? undefined,
            postal_code: DE_B2B.data.company.postalCode ?? undefined,
          },
        });
        apCompanyId = created.companyId;
        console.log(`peppol.sh company created: ${apCompanyId}`);
      }
      expect(apiKey).toBeTruthy();
      expect(apCompanyId).toMatch(/^com_/);

      // 3) Real DB fixtures (Company/Client/Invoice) mirroring the F-7-proven DE_B2B fixture data
      //    (peppol-f7-reachability.spec.ts already proves this exact data builds a valid,
      //    non-SKIPPED PEPPOL_BIS transmission through the real executor) — reused here verbatim so
      //    this spec's only NEW variable is "does it work against the real DB + real sandbox",
      //    not "is this invoice data shape valid". Deliberately NO client.contactEmail: DE's other
      //    configured channel (EMAIL) must SKIP without attempting a real SMTP send — see
      //    email-transmission.ts's guard in InvoiceMailGateway.sendInvoiceEmail.
      const company = await prisma.company.create({
        data: {
          name: DE_B2B.data.company.name,
          description: DE_B2B.data.company.description,
          currency: 'EUR',
          foundedAt: DE_B2B.data.company.foundedAt ?? new Date('2012-09-01'),
          address: DE_B2B.data.company.address ?? '',
          postalCode: DE_B2B.data.company.postalCode ?? '',
          city: DE_B2B.data.company.city ?? '',
          country: DE_B2B.data.company.country ?? 'Germany',
          countryCode: 'DE',
          phone: DE_B2B.data.company.phone ?? '',
          email: DE_B2B.data.company.email ?? '',
          pdfConfig: { create: {} },
          partyIdentifiers: { create: DE_B2B.data.company.partyIdentifiers ?? [] },
        },
      });
      companyId = company.id;

      const client = await prisma.client.create({
        data: {
          companyId,
          name: DE_B2B.data.client.name,
          type: 'COMPANY',
          address: DE_B2B.data.client.address ?? '',
          postalCode: DE_B2B.data.client.postalCode ?? '',
          city: DE_B2B.data.client.city ?? '',
          country: DE_B2B.data.client.country ?? 'France',
          countryCode: 'FR',
          partyIdentifiers: { create: DE_B2B.data.client.partyIdentifiers ?? [] },
        },
      });
      clientId = client.id;

      const item = DE_B2B.data.items[0];
      const netTotal = item.quantity * item.unitPrice;
      const vatTotal = netTotal * (item.vatRate / 100);
      const invoice = await prisma.invoice.create({
        data: {
          clientId,
          companyId,
          rawNumber: `FULLPIPE-DE-${timestamp}`,
          dueDate: new Date(Date.now() + 30 * 86_400_000),
          currency: 'EUR',
          status: 'ISSUED',
          totalHT: netTotal,
          totalVAT: vatTotal,
          totalTTC: netTotal + vatTotal,
          items: {
            create: [
              {
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                vatRate: item.vatRate,
                type: 'SERVICE', // DE_B2B.data.items[0].type — see providers/format/__fixtures__/invoices.ts
                order: 0,
              },
            ],
          },
        },
      });
      invoiceId = invoice.id;

      // 4) Real, encrypted per-company channel config — exactly how a company connects Peppol via
      //    Settings (ChannelCredentialsService), never hand-injected into the provider.
      const { encryptJson, isEncryptionAvailable } = await import('@/utils/secret-crypto');
      expect(isEncryptionAvailable()).toBe(true);
      await prisma.companyChannelConfig.create({
        data: {
          companyId,
          channel: 'PEPPOL',
          providerId: 'peppol',
          environment: 'TEST',
          isActive: true,
          config: encryptJson({
            apProvider: 'peppol-sh',
            apiKey,
            apCompanyId,
            participantId: '9957:DE123456789',
            environment: 'TEST',
          }),
        },
      });
    });

    afterAll(async () => {
      if (prisma) {
        if (documentId) {
          await prisma.scheduledJob.deleteMany({ where: { documentId } });
          await prisma.complianceCallbackRegistration.deleteMany({ where: { documentId } });
          await prisma.complianceEvent.deleteMany({ where: { documentId } });
          await prisma.complianceAuthorityId.deleteMany({ where: { documentId } });
          await prisma.complianceDocument.deleteMany({ where: { id: documentId } });
        }
        if (invoiceId) {
          await prisma.invoiceItem.deleteMany({ where: { invoiceId } });
          await prisma.invoice.deleteMany({ where: { id: invoiceId } });
        }
        if (companyId) {
          // Cascades: Client, PartyIdentifier (company + client), CompanyChannelConfig.
          await prisma.company.deleteMany({ where: { id: companyId } });
        }
      }
      await moduleRef?.close();
    });

    it('drives a DE invoice through the real engine/executor/queue pipeline to a real peppol.sh delivery', async () => {
      const supplierVat = 'DE123456789';
      const buyerVat = 'FR12345678901';

      const ctx: TransactionContext = {
        supplier: {
          legalName: DE_B2B.data.company.name,
          countryCode: 'DE',
          role: 'B2B',
          identifiers: [{ scheme: 'VAT', value: supplierVat, validated: true }],
        },
        buyer: {
          legalName: DE_B2B.data.client.name,
          countryCode: 'FR',
          role: 'B2B',
          identifiers: [{ scheme: 'VAT', value: buyerVat, validated: true }],
        },
        lines: [
          {
            id: 'l1',
            description: DE_B2B.data.items[0].name,
            quantity: DE_B2B.data.items[0].quantity,
            unitNetMinor: Math.round(DE_B2B.data.items[0].unitPrice * 100),
            supplyType: 'SERVICES',
          },
        ],
        issueDate: new Date(),
        currency: 'EUR',
        supplierCompanyId: companyId,
        externalRef: invoiceId,
      } as TransactionContext;

      // ── The real engine — same call any DE invoice actually goes through in production. ──
      const plan = resolve(ctx);
      expect(plan.channels.map((c) => c.type)).toEqual(expect.arrayContaining(['PEPPOL', 'EMAIL']));
      expect(plan.regime.blocking).toBe(false); // DE: POST_AUDIT, non-blocking (profiles/data/de.ts)
      // F-7: DE's primary/authoritative format is XRECHNUNG — PEPPOL_BIS only exists in the plan
      // because buildArtifacts() cross-checks the plan's channels (the F-7 fix).
      expect(plan.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'XRECHNUNG' }),
          expect.objectContaining({ syntax: 'PEPPOL_BIS' }),
        ]),
      );

      // Observe (never replace) the real, DI-resolved Peppol provider's transmit() call so we can
      // recover the real transmitRef afterwards — DE's non-blocking/no-response profile means no
      // ScheduledJob row is armed to read it back from (see file docstring).
      const peppolProvider = registry.getById('peppol') as TransmissionProvider;
      expect(peppolProvider).toBeTruthy();
      const originalTransmit = peppolProvider.transmit.bind(peppolProvider);
      let capturedTransmit: TransmissionResult | undefined;
      const transmitSpy = jest
        .spyOn(peppolProvider, 'transmit')
        .mockImplementation(async (...args: Parameters<TransmissionProvider['transmit']>) => {
          const result = await originalTransmit(...args);
          capturedTransmit = result;
          return result;
        });

      documentId = `full-pipeline-de-${Date.now()}`;
      const nowIso = new Date().toISOString();
      await docStore.save({
        id: documentId,
        kind: 'INVOICE',
        direction: 'OUTBOUND',
        status: 'ISSUED',
        ctx,
        plan,
        authorityIds: [],
        events: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      // ── The real async path: BullMQ TransmitProcessor -> ComplianceService.computeSendOutcome()
      //    -> ComplianceExecutor.execute() (builds the REAL PEPPOL_BIS UBL via the DB-backed
      //    InvoiceRenderingService, then TransmissionProviderRegistry.transmitAll() -> the REAL
      //    peppol.sh AP adapter, a real HTTP call) -> ApplySignalService.apply(). ──
      await dispatcher.enqueueTransmit(documentId);

      const rec = await waitFor(
        () => docStore.get(documentId!),
        (d) => d?.status === 'DELIVERED' || d?.status === 'TRANSMISSION_FAILED',
        120_000,
      );

      // Hard-success contract (ksef-mock-tests-false-confidence): a document that fails to
      // transmit must fail this test loudly, never be tolerated as "well, it tried".
      if (rec?.status === 'TRANSMISSION_FAILED') {
        const events = rec.events.map((e) => `${e.type}${e.detail ? `: ${e.detail}` : ''}`).join(' | ');
        throw new Error(`document reached TRANSMISSION_FAILED — hard failure. Events: ${events}`);
      }
      expect(rec?.status).toBe('DELIVERED');
      expect(rec?.events.some((e) => e.type === 'DELIVER')).toBe(true);

      expect(transmitSpy).toHaveBeenCalledTimes(1);
      expect(capturedTransmit).toBeTruthy();
      if (capturedTransmit!.status === 'REJECTED' || capturedTransmit!.status === 'SKIPPED') {
        throw new Error(
          `peppol.sh transmit returned ${capturedTransmit!.status} — hard failure. ` +
            `Notes: ${(capturedTransmit!.notes ?? []).join(' | ')}`,
        );
      }
      expect(['PENDING', 'SENT']).toContain(capturedTransmit!.status);
      const transmitRef = capturedTransmit!.ref;
      expect(transmitRef).toBeTruthy();
      const [refCompanyId, refMessageId] = (transmitRef ?? '').split('|');
      expect(refCompanyId).toBe(companyId);
      expect(refMessageId).toMatch(/^doc_/);
      console.log('peppol.sh document id (via real engine pipeline):', refMessageId);

      // ── Close the loop: poll the SAME DI-resolved, credentialed provider instance — the exact
      //    code path PollProcessor.poll() calls — until the sandbox confirms real delivery. This
      //    proves DELIVERED corresponds to a genuine peppol.sh acceptance, not just a local status
      //    flip (see file docstring for why the engine itself does not autonomously poll here). ──
      transmitSpy.mockRestore();
      const MAX_POLLS = 24;
      const POLL_INTERVAL_MS = 5_000;
      let pollResult: TransmissionResult | undefined;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        pollResult = await peppolProvider.poll!(transmitRef!, defaultLogger);
        console.log(`Poll ${i + 1}/${MAX_POLLS}:`, pollResult.status, (pollResult.notes ?? []).join(' | '));
        if (pollResult.status === 'CLEARED' || pollResult.status === 'REJECTED') break;
      }

      if (pollResult?.status === 'REJECTED') {
        throw new Error(
          `peppol.sh poll returned REJECTED — hard failure. Notes: ${(pollResult.notes ?? []).join(' | ')}`,
        );
      }
      // Terminal success REQUIRED: CLEARED (= peppol.sh 'delivered'). PENDING is a failure.
      expect(pollResult?.status).toBe('CLEARED');
    }, 300_000);
  },
);
