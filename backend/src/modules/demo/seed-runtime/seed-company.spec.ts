import { vi } from 'vitest';

import { toMinor } from '@/utils/financial';
import { buildInvoiceDescriptor } from '@/modules/documents/descriptors/invoice.descriptor';
import { ROW_ID_KEY } from '@/modules/documents/row-selection/row-selection';
import { computeSettlement } from '@/modules/documents/settlement/compute-settlement';
import { computeDocumentTotals } from '@/modules/documents/totals/compute-totals';
import { resolveInvoiceCrossBorderTax } from '@/modules/documents/tax/resolve-invoice-tax';

import prisma from '@/prisma/prisma.service';
import { companyLawMentions } from '@/modules/documents/company-law/company-law';

import { createRng } from '../generators/rng';
import { DEMO_SEED_VAT_SOURCE, domesticCurrencyFor, seedCountryCompany } from './seed-company';

vi.mock('@/prisma/prisma.service', () => ({
  default: {
    company: { create: vi.fn(async () => ({ id: 'company-1' })) },
    userCompany: { create: vi.fn() },
    partyIdentifier: { create: vi.fn() },
  },
}));
vi.mock('./move-to-sent', () => ({
  moveDraftToSent: vi.fn(async (_companyId: string, _typeId: string, id: string, data: unknown) => ({
    id,
    data,
    status: 'sent',
  })),
}));

describe('domesticCurrencyFor', () => {
  it.each([
    ['DE', 'EUR'],
    ['DZ', 'DZD'],
    ['FR', 'EUR'],
    ['IT', 'EUR'],
    ['PL', 'PLN'],
    ['PT', 'EUR'],
  ] as const)('%s bills its domestic documents in %s', (countryCode, currency) => {
    expect(domesticCurrencyFor({ countryCode })).toBe(currency);
  });

  it('refuses a country with no currency on file', () => {
    expect(() => domesticCurrencyFor({ countryCode: 'XX' } as never)).toThrow(/XX declares neither/);
  });
});

type Lines = Record<string, unknown>[];
type Doc = { id: string; typeId: string; data: Record<string, unknown> };

/** Stands in for `DocumentsService` with the real totals and settlement arithmetic: a credit note is
 *  worth the gross of the invoice lines it corrects, a payment what was recorded. */
function fakeDocumentsService() {
  const docs = new Map<string, Doc>();
  const payments: { documentId: string; amount: number; currency: string }[] = [];
  const credits: { invoiceId: string; correctedLines: string[] }[] = [];
  const invoiceDescriptor = buildInvoiceDescriptor();

  const grossOf = (data: Record<string, unknown>) => computeDocumentTotals(invoiceDescriptor, data);

  const getSettlement = async (_companyId: string, _typeId: string, id: string) => {
    const invoice = docs.get(id)!;
    const totals = grossOf(invoice.data);
    const currency = totals.currency ?? '';
    const lines = (invoice.data.lines as Lines) ?? [];
    return {
      totals,
      settlement: computeSettlement(
        totals.grossMinor,
        payments
          .filter((p) => p.documentId === id)
          .map((p) => ({ amountMinor: toMinor(p.amount, p.currency) })),
        credits
          .filter((c) => c.invoiceId === id)
          .map((c, index) => ({
            id: `credit-${index}`,
            amountMinor: grossOf({
              currency,
              lines: lines.filter((line) => c.correctedLines.includes(line[ROW_ID_KEY] as string)),
            }).grossMinor,
          })),
      ),
    };
  };

  const runAction = async (
    _companyId: string,
    typeId: string,
    actionId: string,
    payload: { documentId?: string; data?: Record<string, unknown>; params?: Record<string, unknown> },
  ) => {
    if (actionId === 'record-payment') {
      const params = payload.params as { amount: number; currency: string };
      payments.push({ documentId: payload.documentId!, amount: params.amount, currency: params.currency });
      return { document: docs.get(payload.documentId!) };
    }
    if (payload.documentId) return { document: docs.get(payload.documentId) };
    const id = `${typeId}-${docs.size + 1}`;
    const data = { ...(payload.data ?? {}) };
    if (Array.isArray(data.lines)) {
      data.lines = (data.lines as Lines).map((line, index) => ({
        ...line,
        [ROW_ID_KEY]: `${id}-row-${index}`,
      }));
    }
    if (typeId === 'credit-note' && typeof data.invoice === 'string') {
      credits.push({ invoiceId: data.invoice, correctedLines: (data.correctedLines as string[]) ?? [] });
    }
    const doc = { id, typeId, data };
    docs.set(id, doc);
    return { document: doc };
  };

  return { docs, payments, credits, service: { runAction, getSettlement } };
}

async function seedWithFake(countryCode: 'DE' | 'DZ' | 'FR' | 'IT' | 'PL' | 'PT' = 'DE') {
  const fake = fakeDocumentsService();
  let clientCount = 0;

  await seedCountryCompany(
    {
      documentsService: fake.service as never,
      articlesService: { create: vi.fn() } as never,
      clientsService: { createClient: vi.fn(async () => ({ id: `client-${++clientCount}` })) } as never,
    },
    {
      userId: 'user-1',
      userEmail: 'demo@example.test',
      countryCode,
      rng: createRng('spec'),
      now: new Date(),
    },
  );
  return fake;
}

describe('seedCountryCompany: credit notes', () => {
  it('seeds only credit notes that correct an invoice, so each one has a client to be sent to', async () => {
    const fake = await seedWithFake();

    const creditNotes = [...fake.docs.values()].filter((doc) => doc.typeId === 'credit-note');
    expect(creditNotes.length).toBeGreaterThanOrEqual(2);
    for (const note of creditNotes) {
      const invoice = fake.docs.get(note.data.invoice as string);
      expect(invoice?.typeId, `credit note ${note.id} corrects an invoice`).toBe('invoice');
      expect(invoice?.data.client).toEqual(expect.any(String));
    }
  });
});

describe('seedCountryCompany: invoice balances', () => {
  it('leaves no invoice with an excess: one paid in full, one settled by a partial credit plus a payment', async () => {
    const fake = await seedWithFake();

    const invoices = [...fake.docs.values()].filter((doc) => doc.typeId === 'invoice');
    const settlements = await Promise.all(
      invoices.map(
        async (doc) => (await fake.service.getSettlement('company-1', 'invoice', doc.id)).settlement,
      ),
    );

    expect(settlements.map((s) => s.excessMinor)).toEqual(settlements.map(() => 0));
    const creditedAndPaid = settlements.find((s) => s.creditedMinor > 0 && s.paidMinor > 0);
    expect(creditedAndPaid).toMatchObject({ settled: true, outstandingMinor: 0, excessMinor: 0 });
    const paidInFull = settlements.find((s) => s.creditedMinor === 0 && s.settled);
    expect(paidInFull).toMatchObject({ paidMinor: paidInFull?.totalGrossMinor, excessMinor: 0 });
  });
});

describe('seedCountryCompany: company-law details', () => {
  it.each([
    'DE',
    'DZ',
    'FR',
    'IT',
    'PL',
    'PT',
  ] as const)('a %s demo company can issue an invoice: nothing its company law requires is missing', async (countryCode) => {
    vi.mocked(prisma.company.create).mockClear();
    vi.mocked(prisma.partyIdentifier.create).mockClear();
    await seedWithFake(countryCode);

    const created = vi.mocked(prisma.company.create).mock.calls[0][0].data;
    const identifiers = vi
      .mocked(prisma.partyIdentifier.create)
      .mock.calls.map(([call]) => call.data as { scheme: string; value: string });
    const mentions = companyLawMentions({
      countryCode,
      documentTypeId: 'invoice',
      language: 'en',
      details: created.companyLaw,
      identifiers,
    });

    expect(mentions.missing).toEqual([]);
    expect(mentions.lines.length).toBeGreaterThan(0);
  });
});

describe('seedCountryCompany: the cross-border client is a verified business (#797)', () => {
  it('a FR demo invoice of two services to its DE client is reverse-charged, even with VIES answering INVALID', async () => {
    vi.mocked(prisma.partyIdentifier.create).mockClear();
    // Stands in for `ClientsService.createClient` with VIES answering INVALID for every VAT number it
    // is handed, which is what the real VIES says about a generated one.
    const created: { id: string; countryCode: string; vat?: { value: string; validationStatus: string } }[] =
      [];
    const createClient = vi.fn(
      async (
        _companyId: string,
        dto: { countryCode: string; identifiers: { scheme: string; value: string }[] },
      ) => {
        const vat = dto.identifiers.find((entry) => entry.scheme === 'VAT');
        const id = `client-${created.length + 1}`;
        created.push({
          id,
          countryCode: dto.countryCode,
          vat: vat ? { value: vat.value, validationStatus: 'INVALID' } : undefined,
        });
        return { id };
      },
    );

    await seedCountryCompany(
      {
        documentsService: fakeDocumentsService().service as never,
        articlesService: { create: vi.fn() } as never,
        clientsService: { createClient } as never,
      },
      {
        userId: 'user-1',
        userEmail: 'demo@example.test',
        countryCode: 'FR',
        rng: createRng('spec'),
        now: new Date(),
      },
    );

    const german = created.find((client) => client.countryCode === 'DE');
    expect(german, 'the FR company has a DE client').toBeDefined();
    // Never handed to the VIES-backed path...
    expect(german?.vat).toBeUndefined();
    // ...but written by the seed itself, as verified.
    const vatRows = vi
      .mocked(prisma.partyIdentifier.create)
      .mock.calls.map(([args]) => (args as { data: Record<string, unknown> }).data)
      .filter((data) => data.clientId === german?.id);
    expect(vatRows).toEqual([
      expect.objectContaining({
        scheme: 'VAT',
        validationStatus: 'VALID',
        validationSource: DEMO_SEED_VAT_SOURCE,
      }),
    ]);

    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: {
        value: vatRows[0].value as string,
        validationStatus: vatRows[0].validationStatus as string,
      },
      data: {
        client: german?.id,
        currency: 'EUR',
        lines: [
          { description: 'Consulting', quantity: 1, unitPrice: 1500, vatRate: '20', supplyType: 'SERVICES' },
          { description: 'Training', quantity: 1, unitPrice: 600, vatRate: '20', supplyType: 'SERVICES' },
        ],
      },
    });

    const lines = result.data.lines as Record<string, unknown>[];
    expect(lines.map((line) => [line.vatRate, line.__crossBorderCategory])).toEqual([
      ['0', 'AE'],
      ['0', 'AE'],
    ]);
    const mentions = result.data.__crossBorderMentions as { code: string }[];
    expect(mentions.map((mention) => mention.code)).toContain('REVERSE_CHARGE');
    expect(result.warnings).toEqual([]);
  });
});
