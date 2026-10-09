/**
 * The country channel mandate ("the channel a country imposes") — the WIRING inside
 * `invoice-actions.ts`'s "send": `resolveCompanyCountryCode` and `activeChannelMandateForOperation`
 * (`channel-policy/mandate.ts`) are both
 * mocked here, the same way `documents.service.invoice.spec.ts` already mocks
 * `country-policy/country-policy` wholesale — this file's job is "does invoice-actions.ts react
 * correctly to a mandate decision", never "is the FR/PDP mandate's own date arithmetic right" (that
 * is `channel-policy/mandate.spec.ts`'s job) nor "is `2026-09-01` the real, shipped date" (that is
 * `channel-policy/registry.spec.ts`'s job). Calls the registered "send" handler directly, bypassing
 * `DocumentsService.runAction`'s own gates entirely — the exact same style `send-divergence.spec.ts`
 * already established for this module.
 */
import { vi } from 'vitest';
import { NotImplementedException } from '@nestjs/common';

import * as persistence from '../persistence';
import { TransportRegistry } from '../transports/transport-registry';
import {
  FR_MANDATE,
  NUMBERED,
  invoiceData,
  invoiceRow,
  mockAtomicNumbering,
  mockCompany,
  mockNeutralIssuanceContext,
  runInvoiceAction,
} from '../__tests__/invoice-action-fixtures';

vi.mock('../persistence');
vi.mock('../transports/company-transport');
vi.mock('../country-policy/country-policy');
vi.mock('../transports/channel-policy/mandate');
// B2G routing (`b2g-routing/`) reaches Prisma directly, exactly like `country-policy/country-policy`
// above — mocked here for the SAME "no Nest, no DB" reason, and defaulted to `applies: false` in
// `beforeEach` below: this file's own concern is the SELLER-country mandate, never a GOVERNMENT
// client — see `invoice-b2g-routing.spec.ts` for that mechanism's own dedicated tests, including the
// one proving this mandate machinery is skipped ENTIRELY once a B2G rule applies.
vi.mock('../b2g-routing/b2g-routing');
// `async-send.ts`'s own "number at enqueue time" mechanism (see that file's header) reaches Prisma
// directly for a real invoice — mocked here for the same reason `send-divergence.spec.ts` and
// `documents.service.invoice.spec.ts` already mock it: this file has no Nest, no DB, and does not
// care about numbering at all, only about the mandate decision.
vi.mock('../numbering/take-number');
// Cross-border VAT ("transfrontalier") — see `send-divergence.spec.ts`'s own comment on this exact
// mock: a permissive pass-through, this file's own concern is the channel mandate, never cross-border
// VAT.
vi.mock('../tax/load-and-resolve');

const documentData = invoiceData('2026-09-01');

const draftDocument = () => invoiceRow(documentData, 'draft');

// A genuine "sending" invoice always carries a number: invoice has no `numbering.onlyFrom`.
const sendingDocument = () => invoiceRow(documentData, 'sending', NUMBERED);

describe('invoice "send" — a country channel mandate overrides the company\'s free choice', () => {
  afterEach(() => vi.resetAllMocks());
  // Cross-border VAT and B2G routing (see `send-divergence.spec.ts` and `invoice-b2g-routing.spec.ts`)
  // are re-installed here, in `beforeEach`, rather than relying on the module factories alone.
  beforeEach(() => mockNeutralIssuanceContext());

  it('BLOCKS at the preflight when the company is configured for a DIFFERENT transport — never persisted, message names channel + source', async () => {
    mockCompany({ countryCode: 'FR', mandate: FR_MANDATE, transportId: 'email', document: draftDocument() });

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn() });
    const action = runInvoiceAction('send', documentData, {}, transportRegistry);

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/FR requires invoices issued on or after 2026-09-01/);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/Seule une plateforme agréée/);
    await expect(action).rejects.toThrow(/currently configured to send invoices via "email"/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('BLOCKS the same way when NO transport is configured at all — names the mandate, not the generic "no transport" message', async () => {
    mockCompany({ countryCode: 'FR', mandate: FR_MANDATE, transportId: null, document: draftDocument() });

    const action = runInvoiceAction('send', documentData);

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/No transport is configured for this company/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('BLOCKS, naming both the mandate AND the underlying reason, when the mandated channel IS chosen but its own preflight refuses (not connected)', async () => {
    mockCompany({ countryCode: 'FR', mandate: FR_MANDATE, transportId: 'pdp', document: draftDocument() });

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('pdp', 'PDP', {
      send: vi.fn(),
      preflight: vi
        .fn()
        .mockRejectedValue(new NotImplementedException('The PDP channel is not connected for this company.')),
    });
    const action = runInvoiceAction('send', documentData, {}, transportRegistry);

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/FR requires invoices issued on or after 2026-09-01/);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/already chose "pdp"/);
    await expect(action).rejects.toThrow(/The PDP channel is not connected for this company\./);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('ALLOWS the send once the mandated channel is chosen AND ready — the mandate does not block what it requires', async () => {
    mockCompany({ countryCode: 'FR', mandate: FR_MANDATE, transportId: 'pdp', document: draftDocument() });
    mockAtomicNumbering(sendingDocument());

    const transportRegistry = new TransportRegistry();
    const fakePreflight = vi.fn().mockResolvedValue(undefined);
    transportRegistry.register('pdp', 'PDP', { send: vi.fn(), preflight: fakePreflight });

    const result = await runInvoiceAction('send', documentData, {}, transportRegistry);

    expect(fakePreflight).toHaveBeenCalledWith('company-1');
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it('a country with NO active mandate leaves the company entirely free to choose — unaffected by the mandate machinery', async () => {
    mockCompany({ countryCode: 'DE', mandate: undefined, transportId: 'email', document: draftDocument() });
    mockAtomicNumbering(sendingDocument());

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn() });

    const result = await runInvoiceAction('send', documentData, {}, transportRegistry);

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it(
    'ALLOWS a transport listed in equivalentProviderIds — the mandate names "sdi" but this company ' +
      'chose "sdi-pec", the SAME legal channel over a different sub-channel (see ' +
      'channel-policy/schema.ts\'s own "equivalentProviderIds" header)',
    async () => {
      mockCompany({
        countryCode: 'IT',
        mandate: {
          providerId: 'sdi',
          mandatedFrom: '2019-01-01',
          equivalentProviderIds: ['sdi-pec'],
          provenance: {
            kind: 'legal' as const,
            sourceText:
              'Sono emesse esclusivamente fatture elettroniche utilizzando il Sistema di Interscambio.',
            sourceCheckedAt: '2026-09-13',
          },
        },
        transportId: 'sdi-pec',
        document: draftDocument(),
      });
      mockAtomicNumbering(sendingDocument());

      const transportRegistry = new TransportRegistry();
      const fakePreflight = vi.fn().mockResolvedValue(undefined);
      transportRegistry.register('sdi-pec', 'SdI via PEC', { send: vi.fn(), preflight: fakePreflight });

      const result = await runInvoiceAction('send', documentData, {}, transportRegistry);

      expect(fakePreflight).toHaveBeenCalledWith('company-1');
      expect(result.changed).toBe(true);
      expect(result.document).toMatchObject({ status: 'sending' });
    },
  );

  it("deliver() (the worker's replay, phase 2) ALSO respects the mandate — a mismatch is refused even if the preflight somehow let it through", async () => {
    // The company switched its transport to "email" AFTER the job was enqueued — deliver() must
    // still honor the mandate at the moment it actually runs, not trust whatever preflight decided.
    mockCompany({
      countryCode: 'FR',
      mandate: FR_MANDATE,
      transportId: 'email',
      document: sendingDocument(),
    });

    const transportRegistry = new TransportRegistry();
    transportRegistry.register('email', 'Email', { send: vi.fn() });
    const action = runInvoiceAction('send', documentData, {}, transportRegistry);

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });
});
