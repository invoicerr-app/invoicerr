/**
 * REAL round-trip against the SuperPDP sandbox e-reporting routes  -  the acceptance proof the issue
 * asks for, gated so CI never pretends it ran.
 *
 *   SUPERPDP_LIVE=1 SUPERPDP_CLIENT_ID=... SUPERPDP_CLIENT_SECRET=... \
 *     npx vitest run src/modules/documents/reporting/providers/fr-pa-declaration-provider.live.spec.ts
 *
 * HONEST STATUS: skipped in every checkout that has no SuperPDP sandbox credential. The unit spec
 * checks the published wire shapes; only this file may claim a real B2C transaction or payment landed
 * on the platform.
 */
import { expect, it } from 'vitest';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import { DeclaredInvoice, DeclaredPayment } from '../declaration-provider';
import { SuperPdpClient } from '../../transports/superpdp/superpdp-client';
import { SUPERPDP_BASE_URL } from '../../transports/superpdp/superpdp-live-parties';
import { liveDescribe } from '../../transports/live-gate';
import { buildSuperPdpEReportingAdapter } from './superpdp-ereporting-adapter';

const describeLive = liveDescribe('SUPERPDP_LIVE', ['SUPERPDP_CLIENT_ID', 'SUPERPDP_CLIENT_SECRET']);

function liveCredentials(): ChannelCredentialsService {
  return {
    resolveActive: async () => ({
      providerId: 'pdp',
      channel: 'PDP',
      environment: 'SANDBOX',
      config: {
        baseUrl: SUPERPDP_BASE_URL,
        clientId: process.env.SUPERPDP_CLIENT_ID,
        clientSecret: process.env.SUPERPDP_CLIENT_SECRET,
      },
      isActive: true,
    }),
  } as unknown as ChannelCredentialsService;
}

function invoice(): DeclaredInvoice {
  const today = new Date().toISOString().slice(0, 10);
  return {
    documentId: `live-doc-${Date.now()}`,
    typeId: 'invoice',
    number: `LIVE-${Date.now()}`,
    issueDate: today,
    currency: 'EUR',
    seller: {
      name: 'Invoicerr Live Seller',
      countryCode: 'FR',
      vatNumber: 'FR12345678901',
      legalId: '123456789',
      address: '1 rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
    },
    buyer: {
      name: 'Private Buyer',
      countryCode: 'FR',
      vatNumber: undefined,
      legalId: undefined,
      address: '2 rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
    },
    lines: [
      {
        description: 'Live service',
        quantity: 1,
        unitPrice: 100,
        vatRatePercent: 20,
        netAmount: 100,
        vatAmount: 20,
        grossAmount: 120,
      },
    ],
    lineNatures: ['service'],
    netTotal: 100,
    vatTotal: 20,
    grossTotal: 120,
  };
}

function liveClient(): SuperPdpClient {
  return new SuperPdpClient({
    baseUrl: SUPERPDP_BASE_URL,
    clientId: process.env.SUPERPDP_CLIENT_ID as string,
    clientSecret: process.env.SUPERPDP_CLIENT_SECRET as string,
  });
}

interface ListedTransaction {
  id: number;
  category_code?: string;
  tax_exclusive_amount?: string;
  tax_total?: string;
  tax_subtotals?: { tax_percent?: string; taxable_amount?: string; tax_total?: string }[];
}

describeLive('SuperPDP e-reporting live round-trip', () => {
  it('creates a B2C transaction the platform lists back', async () => {
    const adapter = buildSuperPdpEReportingAdapter({ channelCredentials: liveCredentials() });
    // Production order: `fr-pa-declaration-provider.declare()` syncs the company VAT regime before
    // declaring, because the platform aggregates according to the regime it holds at that moment.
    // Setting it here is what makes this test independent of the order of the tests in this file.
    await adapter.syncCompanyProfile?.('live-company', { vatRegime: 'REAL_MONTHLY', vatOnDebits: false });
    const result = await adapter.declareTransaction('live-company', invoice());

    expect(result.authorityId).toBeTruthy();
    expect(result.statusCode).toBe('SUBMITTED');

    const listed = await liveClient().request<{ data: ListedTransaction[] }>(
      'GET',
      '/v1.beta/b2c_transactions?limit=100&order=desc',
    );
    const row = listed.data.find((candidate) => String(candidate.id) === result.authorityId);
    expect(row).toBeDefined();
  });

  it('lists the B2C transaction back with its category, rate and amounts', async () => {
    const adapter = buildSuperPdpEReportingAdapter({ channelCredentials: liveCredentials() });
    await adapter.syncCompanyProfile?.('live-company', { vatRegime: 'REAL_MONTHLY', vatOnDebits: false });
    const result = await adapter.declareTransaction('live-company', invoice());

    const listed = await liveClient().request<{ data: ListedTransaction[] }>(
      'GET',
      '/v1.beta/b2c_transactions?limit=100&order=desc',
    );
    const row = listed.data.find((candidate) => String(candidate.id) === result.authorityId);
    // A service-only invoice is category TPS1; one 20% subtotal of 100.00 taxable and 20.00 tax.
    expect(row?.category_code).toBe('TPS1');
    expect(row?.tax_exclusive_amount).toBe('100.00');
    expect(row?.tax_total).toBe('20.00');
    expect(row?.tax_subtotals).toEqual([
      expect.objectContaining({ tax_percent: '20.00', taxable_amount: '100.00', tax_total: '20.00' }),
    ]);
  });

  it('answers the e-reporting preview the platform aggregates declarations into', async () => {
    // The preview's body is the platform's own aggregate; the acceptance only asks that it is reachable
    // with the declared data, so this test pins that the route answers for the connected company.
    const preview = await liveClient().request<unknown>('GET', '/v1.beta/ereportings/preview');
    expect(preview).toBeDefined();
  });

  it('creates a B2C payment for a service invoice taxed on collection', async () => {
    const adapter = buildSuperPdpEReportingAdapter({ channelCredentials: liveCredentials() });
    await adapter.syncCompanyProfile?.('live-company', { vatRegime: 'REAL_MONTHLY', vatOnDebits: false });
    const declared = invoice();
    const payment: DeclaredPayment = {
      documentId: declared.documentId,
      paymentId: `live-payment-${Date.now()}`,
      paidAt: declared.issueDate,
      currency: 'EUR',
      amount: 120,
      invoice: declared,
      subtotals: [{ vatRatePercent: 20, taxableAmount: 100, vatAmount: 20 }],
    };
    const result = await adapter.declarePayment('live-company', payment);

    expect(result.authorityId).toBeTruthy();
    expect(result.statusCode).toBe('SUBMITTED');
    expect(result.referenceKind).toBe('platform');
  });

  it('syncs the VAT regime and reads it back from the platform company record', async () => {
    const adapter = buildSuperPdpEReportingAdapter({ channelCredentials: liveCredentials() });
    await adapter.syncCompanyProfile?.('live-company', { vatRegime: 'REAL_MONTHLY', vatOnDebits: false });

    const company = await liveClient().getCompany();
    expect((company as Record<string, unknown>).vat_regime).toBe('monthly');
    expect((company as Record<string, unknown>).has_vat_on_debits).toBe(false);
  });
});
