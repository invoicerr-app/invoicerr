/**
 * The WIRING-LEVEL proof this defect's own report names as missing: `tax-engine.spec.ts` already
 * proves the pure ENGINE handles `taxScheme: 'FRANCHISE_BASE'` correctly when called directly, but
 * that test called the engine directly — it could never have caught that nothing in the real send
 * path ever SET `taxScheme` in the first place. These tests instead go through
 * `resolveInvoiceCrossBorderTaxForCompany` (`load-and-resolve.ts`), the actual Prisma-aware entry
 * point `invoice-actions.ts`'s preflight/`deliver()` call, with `@/prisma/prisma.service` mocked to
 * return a company row exactly like one Prisma itself would — and then feeds the result through the
 * REAL `ciiFormatProvider.build`, judged by the real vendored EN 16931 Schematron
 * (`tax/cross-border-formats.spec.ts`'s own "master proof" style), so the assertion is about the
 * BUILT DOCUMENT a buyer would actually receive, not merely about the in-memory sidecar keys.
 */
import prisma from '@/prisma/prisma.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ciiFormatProvider } from '../formats/cii-provider';
import { DocumentFormatParty } from '../formats/format-provider';
import { resolveInvoiceCrossBorderTaxForCompany } from './load-and-resolve';
import { UnresolvedBuyerCountryError } from './resolve-invoice-tax';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findFirst: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findFirst: jest.Mock };
};

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const FR_PARTY: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'LEGAL_ID', value: '12345678900017' },
  ],
};

function frCompanyRow(exemptVat: boolean) {
  return { country: 'France', countryCode: 'FR', exemptVat };
}

function frClientRow() {
  return { country: 'France', countryCode: 'FR', partyIdentifiers: [] };
}

function draftData() {
  return {
    client: 'client-1',
    issueDate: '2026-09-13',
    dueDate: '2026-09-30',
    currency: 'EUR',
    lines: [
      { description: 'Conseil stratégique', quantity: 10, unit: 'hour', unitPrice: 100, vatRate: '20' },
    ],
  };
}

beforeEach(() => {
  mockedPrisma.company.findUnique.mockReset();
  mockedPrisma.client.findFirst.mockReset();
});

describe('resolveInvoiceCrossBorderTaxForCompany — Company.exemptVat actually reaches a domestic invoice', () => {
  it('exemptVat: true → the resolved data is 0%, category E, art. 293 B mention (never the engine called directly)', async () => {
    mockedPrisma.company.findUnique.mockResolvedValue(frCompanyRow(true));
    mockedPrisma.client.findFirst.mockResolvedValue(frClientRow());

    const data = draftData();
    const result = await resolveInvoiceCrossBorderTaxForCompany('company-1', data);

    expect(result.crossBorder).toBe(false); // still domestic — FR seller, FR buyer
    const lines = result.data.lines as Record<string, unknown>[];
    expect(lines[0].vatRate).toBe('0'); // never the drafted 20%
    expect(lines[0].__crossBorderCategory).toBe('E');
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.text)).toContain('TVA non applicable, art. 293 B du CGI');

    // The BUILT DOCUMENT itself — the exact thing the checkbox's own description in
    // `frontend/src/locales/en/translation.json` promises — judged by the real vendored EN 16931
    // Schematron, not a hand-asserted opinion of the XML.
    const document = {
      id: 'doc-fr-exempt',
      data: result.data,
      displayNumber: 'INV-2026-0001',
      status: 'sent',
    };
    const build = await ciiFormatProvider.build(descriptor, document, FR_PARTY, FR_PARTY);
    expect(build.validation.valid).toBe(true);
    expect(build.validation.errors).toEqual([]);
    const xml = Buffer.from(build.bytes).toString('utf-8');
    expect(xml).toMatch(/<ram:RateApplicablePercent>0<\/ram:RateApplicablePercent>/);
    expect(xml).toMatch(/<ram:CategoryCode>E<\/ram:CategoryCode>/);
    expect(xml).toContain('TVA non applicable, art. 293 B du CGI');
    // Totals actually reflect 0% VAT, not the originally-typed 20%.
    expect(xml).toMatch(/<ram:TaxTotalAmount currencyID="EUR">0\.00<\/ram:TaxTotalAmount>/);
    expect(xml).toMatch(/<ram:GrandTotalAmount>1000\.00<\/ram:GrandTotalAmount>/);
  });

  it('exemptVat: false (the ordinary case) — same object reference, standard 20% rate, NO exemption mention anywhere', async () => {
    mockedPrisma.company.findUnique.mockResolvedValue(frCompanyRow(false));
    mockedPrisma.client.findFirst.mockResolvedValue(frClientRow());

    const data = draftData();
    const result = await resolveInvoiceCrossBorderTaxForCompany('company-1', data);

    expect(result.data).toBe(data); // byte-identical to before this fix existed
    const lines = result.data.lines as Record<string, unknown>[];
    expect(lines[0].vatRate).toBe('20');
    expect(lines[0].__crossBorderCategory).toBeUndefined();

    const document = {
      id: 'doc-fr-standard',
      data: result.data,
      displayNumber: 'INV-2026-0002',
      status: 'sent',
    };
    const build = await ciiFormatProvider.build(descriptor, document, FR_PARTY, FR_PARTY);
    expect(build.validation.valid).toBe(true);
    const xml = Buffer.from(build.bytes).toString('utf-8');
    expect(xml).toMatch(/<ram:RateApplicablePercent>20<\/ram:RateApplicablePercent>/);
    expect(xml).not.toContain('293 B');
  });
});

/**
 * The multi-tenancy proof this fix exists for: `data.client` is read straight off the document's own
 * `data` — never checked against the entity for existence, let alone OWNERSHIP, at write time
 * (descriptors/field-kinds.ts's own comment on the 'reference' kind) — so before this fix,
 * `prisma.client.findUnique({ where: { id: clientId } })` resolved ANY company's client row, letting a
 * guessed or copy-pasted id from another tenant silently supply that tenant's own country/VAT to THIS
 * company's tax computation. The mock below stands in for what a REAL `findFirst({ where: { id,
 * companyId } })` actually does — a row comes back only when BOTH match — so this test would have
 * failed against the pre-fix `findUnique({ where: { id } })` call (which this mock shape cannot even
 * express: `findUnique` cares only about `id`) and passes now that the lookup is scoped.
 */
describe("resolveInvoiceCrossBorderTaxForCompany — data.client cannot resolve another company's client", () => {
  function scopedClientRow(row: { id: string; companyId: string } & Record<string, unknown>) {
    return ({ where }: { where: { id: string; companyId: string } }) =>
      Promise.resolve(where.id === row.id && where.companyId === row.companyId ? row : null);
  }

  it("a `data.client` naming another tenant's real client resolves to NOTHING — hard-blocks as an unresolved buyer, never that tenant's own country/VAT", async () => {
    mockedPrisma.company.findUnique.mockResolvedValue(frCompanyRow(false));
    const otherTenantsClient = {
      id: 'client-999',
      companyId: 'company-OTHER',
      country: 'Germany',
      countryCode: 'DE',
      partyIdentifiers: [{ value: 'DE123456789', validationStatus: 'VALID' }],
    };
    mockedPrisma.client.findFirst.mockImplementation(scopedClientRow(otherTenantsClient));

    const data = { ...draftData(), client: 'client-999' };

    // The pre-fix behavior would have resolved DE as the buyer country and happily computed a
    // cross-border OSS treatment off another tenant's data — never reaching this error at all.
    await expect(resolveInvoiceCrossBorderTaxForCompany('company-1', data)).rejects.toThrow(
      UnresolvedBuyerCountryError,
    );
    // Proves the query itself carries the ACTING company, not merely that this mock said no.
    expect(mockedPrisma.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'client-999', companyId: 'company-1' } }),
    );
  });

  it('the SAME id, when it genuinely belongs to the acting company, resolves normally — this closes a tenant leak, not a blanket block', async () => {
    mockedPrisma.company.findUnique.mockResolvedValue(frCompanyRow(false));
    const ownClient = { id: 'client-1', companyId: 'company-1', ...frClientRow() };
    mockedPrisma.client.findFirst.mockImplementation(scopedClientRow(ownClient));

    const result = await resolveInvoiceCrossBorderTaxForCompany('company-1', draftData());

    expect(result.crossBorder).toBe(false);
    const lines = result.data.lines as Record<string, unknown>[];
    expect(lines[0].vatRate).toBe('20');
  });
});
