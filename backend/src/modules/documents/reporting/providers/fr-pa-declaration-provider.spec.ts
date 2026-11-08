/**
 * The generic French PA provider: the legal channel resolves a CONNECTED operator from the catalogue,
 * never a vendor name from country data, and refuses loudly when nothing can discharge the obligation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import * as countryPolicy from '../../country-policy/country-policy';
import { ChannelNotConnectedError, DeclaredInvoice } from '../declaration-provider';
import { EReportingAdapterRegistry } from '../ereporting-adapter';
import { buildFrenchPaDeclarationProvider } from './fr-pa-declaration-provider';

vi.mock('../../country-policy/country-policy');

const mockedCountry = countryPolicy.resolveCompanyCountryCode as unknown as ReturnType<typeof vi.fn>;
const mockedProfile = countryPolicy.resolveCompanyProfile as unknown as ReturnType<typeof vi.fn>;

const invoice = {
  documentId: 'doc-1',
  typeId: 'invoice',
  number: 'INV-1',
  issueDate: '2027-10-01',
  currency: 'EUR',
  seller: {},
  buyer: {},
  lines: [],
  netTotal: 100,
  vatTotal: 20,
  grossTotal: 120,
} as unknown as DeclaredInvoice;

function channels(rows: { providerId: string; isActive: boolean }[]): ChannelCredentialsService {
  return { listCompanyChannels: vi.fn().mockResolvedValue(rows) } as unknown as ChannelCredentialsService;
}

function registryWith(transportId: string) {
  const registry = new EReportingAdapterRegistry();
  const adapter = {
    transportId,
    declareTransaction: vi.fn().mockResolvedValue({
      statusCode: 'SUBMITTED',
      authorityId: '1',
      observedAt: new Date(),
      rawPayload: {},
    }),
    declarePayment: vi.fn(),
    syncCompanyProfile: vi.fn(),
  };
  registry.register(adapter);
  return { registry, adapter };
}

describe('buildFrenchPaDeclarationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCountry.mockResolvedValue('FR');
    mockedProfile.mockResolvedValue({ vatRegime: 'REAL_MONTHLY', vatDebitsOption: 'NOT_EXERCISED' });
  });

  it('delegates to the connected operator whose offering declares e-reporting', async () => {
    const { registry, adapter } = registryWith('pdp');
    const provider = buildFrenchPaDeclarationProvider({
      channelCredentials: channels([
        { providerId: 'email', isActive: true },
        { providerId: 'pdp', isActive: true },
      ]),
      adapters: registry,
    });

    await provider.declare('company-1', invoice);

    expect(adapter.syncCompanyProfile).toHaveBeenCalledWith('company-1', {
      vatRegime: 'REAL_MONTHLY',
      vatOnDebits: false,
    });
    expect(adapter.declareTransaction).toHaveBeenCalledWith('company-1', invoice);
  });

  it('is blocked when no channel is connected, never silently skipped', async () => {
    const provider = buildFrenchPaDeclarationProvider({
      channelCredentials: channels([]),
      adapters: new EReportingAdapterRegistry(),
    });
    await expect(provider.declare('company-1', invoice)).rejects.toBeInstanceOf(ChannelNotConnectedError);
  });

  it('is blocked when the connected transports declare no e-reporting capability', async () => {
    const provider = buildFrenchPaDeclarationProvider({
      channelCredentials: channels([{ providerId: 'email', isActive: true }]),
      adapters: new EReportingAdapterRegistry(),
    });
    await expect(provider.declare('company-1', invoice)).rejects.toBeInstanceOf(ChannelNotConnectedError);
  });

  it('is blocked with a named reason when the operator has e-reporting but this build has no adapter', async () => {
    const provider = buildFrenchPaDeclarationProvider({
      channelCredentials: channels([{ providerId: 'pdp', isActive: true }]),
      adapters: new EReportingAdapterRegistry(),
    });
    await expect(provider.declare('company-1', invoice)).rejects.toThrow(/no adapter for its API/);
  });
});
