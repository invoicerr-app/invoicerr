/**
 * The SuperPDP adapter's wire shapes, checked against the published OpenAPI (read 2026-11-07) with a
 * stubbed client: no live sandbox credential is available in this environment, so the gated live
 * spec is the only place a real round-trip may be claimed.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import { DeclaredInvoice, DeclaredPayment } from '../declaration-provider';
import { buildSuperPdpEReportingAdapter } from './superpdp-ereporting-adapter';

const credentials = {
  baseUrl: 'https://api.superpdp.tech',
  clientId: 'client',
  clientSecret: 'secret',
};

function channelCredentials(resolved: unknown): ChannelCredentialsService {
  return { resolveActive: vi.fn().mockResolvedValue(resolved) } as unknown as ChannelCredentialsService;
}

function invoice(overrides: Partial<DeclaredInvoice> = {}): DeclaredInvoice {
  return {
    documentId: 'doc-1',
    typeId: 'invoice',
    number: 'INV-2026-0001',
    issueDate: '2027-10-01',
    currency: 'EUR',
    seller: {
      name: 'Seller',
      countryCode: 'FR',
      vatNumber: 'FR123',
      legalId: '123',
      address: '1 rue',
      city: 'Paris',
      postalCode: '75001',
    },
    buyer: {
      name: 'Buyer',
      countryCode: 'FR',
      vatNumber: undefined,
      legalId: undefined,
      address: '2 rue',
      city: 'Paris',
      postalCode: '75002',
    },
    lines: [
      {
        description: 'Service',
        quantity: 1,
        unitPrice: 100,
        vatRatePercent: 20,
        netAmount: 100,
        vatAmount: 20,
        grossAmount: 120,
      },
      {
        description: 'Service 2',
        quantity: 1,
        unitPrice: 100,
        vatRatePercent: 20,
        netAmount: 100,
        vatAmount: 20,
        grossAmount: 120,
      },
    ],
    lineNatures: ['service', 'service'],
    netTotal: 200,
    vatTotal: 40,
    grossTotal: 240,
    ...overrides,
  };
}

function adapter(client: Record<string, unknown>) {
  return buildSuperPdpEReportingAdapter({
    channelCredentials: channelCredentials({ config: credentials }),
    buildClient: () => client as never,
  });
}

describe('SuperPDP e-reporting adapter  -  B2C transaction', () => {
  it('sends the published b2c_transaction shape for a service invoice', async () => {
    const createB2cTransactions = vi
      .fn()
      .mockResolvedValue([{ id: 42, date: '2027-10-01', currency: 'EUR', category_code: 'TPS1' }]);
    const result = await adapter({ createB2cTransactions }).declareTransaction('company-1', invoice());

    expect(createB2cTransactions).toHaveBeenCalledWith([
      {
        date: '2027-10-01',
        currency: 'EUR',
        role_code: 'SE',
        category_code: 'TPS1',
        tax_exclusive_amount: '200.00',
        tax_total: '40.00',
        tax_subtotals: [{ tax_percent: '20.00', taxable_amount: '200.00', tax_total: '40.00' }],
      },
    ]);
    expect(result.authorityId).toBe('42');
    expect(result.statusCode).toBe('SUBMITTED');
    expect(result.statusText).toContain("platform's own record");
    expect(result.observedAt).toBeInstanceOf(Date);
  });

  it('groups subtotals by VAT rate and uses TLB1 for a goods-only invoice', async () => {
    const createB2cTransactions = vi.fn().mockResolvedValue([{ id: 7 }]);
    await adapter({ createB2cTransactions }).declareTransaction(
      'company-1',
      invoice({
        lineNatures: ['goods'],
        lines: [
          {
            description: 'Goods',
            quantity: 1,
            unitPrice: 100,
            vatRatePercent: 20,
            netAmount: 100,
            vatAmount: 20,
            grossAmount: 120,
          },
          {
            description: 'Goods 2',
            quantity: 1,
            unitPrice: 50,
            vatRatePercent: 5.5,
            netAmount: 50,
            vatAmount: 2.75,
            grossAmount: 52.75,
          },
        ],
        netTotal: 150,
        vatTotal: 22.75,
        grossTotal: 172.75,
      }),
    );

    const payload = (createB2cTransactions.mock.calls[0][0] as Record<string, unknown>[])[0];
    expect(payload.category_code).toBe('TLB1');
    expect(payload.tax_subtotals).toEqual([
      { tax_percent: '5.50', taxable_amount: '50.00', tax_total: '2.75' },
      { tax_percent: '20.00', taxable_amount: '100.00', tax_total: '20.00' },
    ]);
  });

  it('uses TMA1 for a mixed invoice', async () => {
    const createB2cTransactions = vi.fn().mockResolvedValue([{ id: 8 }]);
    await adapter({ createB2cTransactions }).declareTransaction(
      'company-1',
      invoice({ lineNatures: ['goods', 'service'] }),
    );
    expect((createB2cTransactions.mock.calls[0][0] as Record<string, unknown>[])[0].category_code).toBe(
      'TMA1',
    );
  });

  it('refuses a line with no article rather than guessing its category', async () => {
    const createB2cTransactions = vi.fn();
    await expect(
      adapter({ createB2cTransactions }).declareTransaction('company-1', invoice({ lineNatures: undefined })),
    ).rejects.toThrow(/cannot be classified as goods/);
    expect(createB2cTransactions).not.toHaveBeenCalled();
  });

  it('refuses an accepted declaration with no record id', async () => {
    await expect(
      adapter({ createB2cTransactions: vi.fn().mockResolvedValue([{}]) }).declareTransaction(
        'company-1',
        invoice(),
      ),
    ).rejects.toThrow(/without returning a record id/);
  });
});

describe('SuperPDP e-reporting adapter  -  B2C payment', () => {
  it('sends the published b2c_payment shape with one subtotal per VAT rate', async () => {
    const createB2cPayments = vi.fn().mockResolvedValue([{ id: 99 }]);
    const payment: DeclaredPayment = {
      documentId: 'doc-1',
      paymentId: 'pay-1',
      paidAt: '2027-10-05',
      currency: 'EUR',
      amount: 120,
      invoice: invoice(),
      subtotals: [{ vatRatePercent: 20, taxableAmount: 100, vatAmount: 20 }],
    };

    const result = await adapter({ createB2cPayments }).declarePayment('company-1', payment);

    expect(createB2cPayments).toHaveBeenCalledWith([
      {
        date: '2027-10-05',
        subtotals: [{ category_code: 'TPS1', tax_percent: '20.00', amount: '120.00', currency_code: 'EUR' }],
      },
    ]);
    expect(result.authorityId).toBe('99');
  });
});

describe('SuperPDP e-reporting adapter  -  VAT regime sync', () => {
  it('maps the company profile regime to the platform vocabulary', async () => {
    const updateCompanyVatRegime = vi.fn().mockResolvedValue({});
    await adapter({ updateCompanyVatRegime }).syncCompanyProfile?.('company-1', {
      vatRegime: 'REAL_QUARTERLY',
      vatOnDebits: true,
    });
    expect(updateCompanyVatRegime).toHaveBeenCalledWith({
      vat_regime: 'quarterly',
      has_vat_on_debits: true,
    });
  });

  it('refuses a regime with no published equivalent instead of leaving the platform on a wrong schedule', async () => {
    await expect(
      adapter({ updateCompanyVatRegime: vi.fn() }).syncCompanyProfile?.('company-1', {
        vatRegime: 'SOMETHING_ELSE',
        vatOnDebits: false,
      }),
    ).rejects.toThrow(/no published SuperPDP equivalent/);
  });
});
