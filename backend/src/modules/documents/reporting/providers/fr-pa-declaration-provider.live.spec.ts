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
import { DeclaredInvoice } from '../declaration-provider';
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

describeLive('SuperPDP e-reporting live round-trip', () => {
  it('creates a B2C transaction the platform lists back', async () => {
    const adapter = buildSuperPdpEReportingAdapter({ channelCredentials: liveCredentials() });
    const result = await adapter.declareTransaction('live-company', invoice());

    expect(result.authorityId).toBeTruthy();
    expect(result.statusCode).toBe('SUBMITTED');

    const client = new SuperPdpClient({
      baseUrl: SUPERPDP_BASE_URL,
      clientId: process.env.SUPERPDP_CLIENT_ID as string,
      clientSecret: process.env.SUPERPDP_CLIENT_SECRET as string,
    });
    const listed = await client.request<{ data: { id: number }[] }>(
      'GET',
      '/v1.beta/b2c_transactions?limit=100&order=desc',
    );
    expect(listed.data.some((row) => String(row.id) === result.authorityId)).toBe(true);
  });

  it('syncs the VAT regime and reads it back from the platform company record', async () => {
    const adapter = buildSuperPdpEReportingAdapter({ channelCredentials: liveCredentials() });
    await adapter.syncCompanyProfile?.('live-company', { vatRegime: 'REAL_MONTHLY', vatOnDebits: false });

    const client = new SuperPdpClient({
      baseUrl: SUPERPDP_BASE_URL,
      clientId: process.env.SUPERPDP_CLIENT_ID as string,
      clientSecret: process.env.SUPERPDP_CLIENT_SECRET as string,
    });
    const company = await client.getCompany();
    expect((company as Record<string, unknown>).vat_regime).toBe('monthly');
  });
});
