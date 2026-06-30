/**
 * National portal live round-trip tests — parametrized over NATIONAL_PORTAL_PROVIDERS.
 *
 * Each provider self-gates on `<PREFIX>_LIVE=1` (never set in CI).  All suites are
 * SKIPPED by default.  Configure one or many portals at once with the namespaced
 * convention — see LIVE_TESTING.md for full documentation.
 *
 * Gate convention (see portal-live-env.ts for full detail):
 *   prefix = portalPrefix(provider.id)   e.g. 'choruspro' → 'CHORUSPRO'
 *   <PREFIX>_LIVE=1                      opt-in flag
 *   <PREFIX>_BASE_URL / _API_KEY / …     namespaced credentials
 *
 * Example — run the ANAF (RO) suite:
 *   ANAF_LIVE=1 ANAF_AUTH_TOKEN=<tok> ANAF_TAXPAYER_ID=<cui> \
 *     npx jest portal-live --no-coverage --runInBand
 *
 * Example — run ZATCA + ANAF in the same invocation:
 *   ZATCA_LIVE=1 ZATCA_API_KEY=<key> ZATCA_TAXPAYER_ID=<tin> \
 *   ANAF_LIVE=1  ANAF_AUTH_TOKEN=<tok> ANAF_TAXPAYER_ID=<cui> \
 *     npx jest portal-live --no-coverage --runInBand
 *
 * Hard assertions (REJECTED / SKIPPED outcomes fail the test):
 *   - transmit status MUST be PENDING, SENT, or CLEARED.
 *   - ref MUST be truthy (real authority identifier returned).
 *   - Async portals (ASYNC_POLL) polled until CLEARED within 5 min.
 *
 * See LIVE_TESTING.md → "National portals (namespaced)" for the full env-var table.
 */
export {}; // module marker

import { liveDescribe } from './live-gate.js';
import { portalPrefix, readNamespacedConfig } from './portal-live-env.js';

// ─── lazy imports (deferred until the suite body runs) ───────────────────────
async function loadDeps() {
  const { NATIONAL_PORTAL_PROVIDERS } = await import('./national-portals.js');
  const { RecordingComplianceLogger } = await import('../../execution/logger.js');
  const { InvoiceRenderingService } = await import(
    '../../../modules/invoice-rendering/invoice-rendering.service.js'
  );
  return { NATIONAL_PORTAL_PROVIDERS, RecordingComplianceLogger, InvoiceRenderingService };
}

// ─── parametrized loop ───────────────────────────────────────────────────────

// We need to enumerate providers at module load so Jest discovers the describe blocks.
// Use a dynamic require synchronously to avoid top-level await (Jest doesn't support it yet).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NATIONAL_PORTAL_PROVIDERS } = require('./national-portals.js') as {
  NATIONAL_PORTAL_PROVIDERS: Array<{ id: string; channel: string; feedback?: string; poll?: unknown }>;
};

for (const portal of NATIONAL_PORTAL_PROVIDERS) {
  const prefix = portalPrefix(portal.id);
  const flagVar = `${prefix}_LIVE`;

  // Each provider registers its own gated describe block.
  // Minimum required vars: the LIVE flag alone (no mandatory creds at gate time).
  // Missing creds surface as test failures inside beforeAll/it, giving precise messages.
  const describeLive = liveDescribe(flagVar, []);

  describeLive(`National portal live — ${portal.id} (${prefix}_*)`, () => {
    let config: Record<string, string>;

    beforeAll(() => {
      process.env.CREDENTIALS_ENCRYPTION_KEY ??=
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      config = readNamespacedConfig(prefix);
      console.log(`[portal-live/${portal.id}] Config keys:`, Object.keys(config));
    });

    it(`transmits a real invoice to ${portal.id} and receives a non-rejected status`, async () => {
      const { RecordingComplianceLogger, InvoiceRenderingService } = await loadDeps();

      console.log(`[portal-live/${portal.id}] channel=${portal.channel} feedback=${portal.feedback}`);

      // Build per-company-style resolved config from namespaced env.
      const fakeResolvedConfig = {
        providerId: portal.id,
        channel: portal.channel,
        environment: config.environment ?? 'TEST',
        config,
        isActive: true,
      };

      // ─── Build XML artifact ───────────────────────────────────────────────
      let xmlBytes: Buffer;
      const xmlPath = config.xmlPath;

      if (xmlPath) {
        const { readFileSync } = await import('fs');
        xmlBytes = readFileSync(xmlPath);
        console.log(`[portal-live/${portal.id}] Loaded XML from`, xmlPath, '—', xmlBytes.length, 'bytes');
      } else {
        const svc = new InvoiceRenderingService();
        const now = new Date();
        const timestamp = Date.now();
        const inv = svc.buildEInvoice({
          rawNumber: `INV-${prefix}-${timestamp}`,
          number: null,
          issuedAt: now,
          createdAt: now,
          company: {
            name: config.sellerName ?? 'Test Seller',
            description: null,
            foundedAt: null,
            currency: config.currency ?? 'EUR',
            address: '1 Seller St',
            city: 'Test City',
            postalCode: '00001',
            country: config.country ?? 'Germany',
            partyIdentifiers: [{ scheme: 'VAT', value: config.sellerVat ?? 'DE000000000' }],
          },
          client: {
            type: 'COMPANY',
            name: config.buyerName ?? 'Test Buyer',
            description: null,
            foundedAt: null,
            contactFirstname: null,
            contactLastname: null,
            contactEmail: null,
            contactPhone: null,
            salutation: null,
            sex: null,
            title: null,
            isActive: true,
            address: '2 Buyer Ave',
            city: 'Test City',
            postalCode: '00002',
            country: config.buyerCountry ?? 'Germany',
            partyIdentifiers: [{ scheme: 'VAT', value: config.buyerVat ?? 'DE000000001' }],
          },
          items: [{ name: 'Portal live test', quantity: 1, unitPrice: 100, vatRate: 0, type: 'SERVICE' }],
        } as any);
        const xml = await inv.exportXml('ubl');
        xmlBytes = Buffer.from(xml, 'utf8');
        console.log(`[portal-live/${portal.id}] Generated UBL XML —`, xmlBytes.length, 'bytes');
      }

      const artifact = {
        role: 'AUTHORITATIVE' as const,
        syntax: (config.syntax ?? 'EN16931_UBL') as any,
        mime: 'application/xml',
        bytes: xmlBytes,
      };

      // ─── Transmission context ─────────────────────────────────────────────
      const timestamp = Date.now();
      const log = new RecordingComplianceLogger();
      const ctx = {
        supplier: {
          legalName: config.sellerName ?? 'Test Seller',
          countryCode: config.country ?? 'DE',
          role: 'B2B',
          identifiers: [
            { scheme: 'VAT', value: config.sellerVat ?? 'DE000000000', validated: true },
          ],
        },
        buyer: {
          legalName: config.buyerName ?? 'Test Buyer',
          countryCode: config.buyerCountry ?? 'DE',
          role: 'B2B',
          identifiers: [
            { scheme: 'VAT', value: config.buyerVat ?? 'DE000000001', validated: true },
          ],
        },
        lines: [],
        issueDate: new Date(),
        currency: config.currency ?? 'EUR',
        supplierCompanyId: `live_portal_${portal.id}_${timestamp}`,
      } as any;

      // ─── Transmit ─────────────────────────────────────────────────────────
      const transmitFn = (portal as any).transmit;
      if (!transmitFn) {
        fail(`[portal-live/${portal.id}] Provider has no transmit() method`);
        return;
      }

      const transmitResult = await transmitFn.call(
        portal,
        [artifact],
        ctx,
        { channels: [{ type: portal.channel, providerId: portal.id }] } as any,
        `portal-live-${portal.id}-${timestamp}`,
        log,
        fakeResolvedConfig as any,
      );

      console.log(`[portal-live/${portal.id}] Result:`, JSON.stringify(transmitResult, null, 2));

      // Hard assertions — REJECTED or SKIPPED are NOT tolerated.
      if (transmitResult.status === 'REJECTED' || transmitResult.status === 'SKIPPED') {
        const notes = (transmitResult.notes ?? []).join(' | ');
        fail(`Portal '${portal.id}' transmit returned ${transmitResult.status} — hard failure. Notes: ${notes}`);
      }

      expect(['PENDING', 'SENT', 'CLEARED']).toContain(transmitResult.status);

      // ─── Poll async portals ───────────────────────────────────────────────
      if (portal.feedback === 'ASYNC_POLL' && transmitResult.status === 'PENDING') {
        expect(transmitResult.ref).toBeTruthy();
        const ref = transmitResult.ref!;
        console.log(`[portal-live/${portal.id}] Async portal, ref:`, ref);

        if (!(portal as any).poll) {
          fail(`[portal-live/${portal.id}] ASYNC_POLL portal has no poll() method`);
          return;
        }

        const MAX_POLLS = 20;
        const POLL_INTERVAL_MS = 15_000;
        let pollResult: any;

        for (let i = 0; i < MAX_POLLS; i++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          pollResult = await (portal as any).poll(ref, log);
          console.log(
            `[portal-live/${portal.id}] Poll ${i + 1}/${MAX_POLLS}:`,
            pollResult.status,
            (pollResult.notes ?? []).join(' | '),
          );
          if (pollResult.status === 'CLEARED' || pollResult.status === 'REJECTED') break;
        }

        expect(pollResult).toBeDefined();
        console.log(`[portal-live/${portal.id}] Final poll:`, JSON.stringify(pollResult, null, 2));

        if (pollResult.status === 'REJECTED') {
          const notes = (pollResult.notes ?? []).join(' | ');
          fail(`Portal '${portal.id}' poll returned REJECTED — hard failure. Notes: ${notes}`);
        }
        expect(pollResult.status).toBe('CLEARED');
      }
    }, 360_000); // 6 min for async portals
  });
}
