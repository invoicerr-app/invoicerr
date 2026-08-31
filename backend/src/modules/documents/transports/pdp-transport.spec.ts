/**
 * The "pdp" transport in isolation — root TODO item 10, wave 1. `PdpClient` and `@/prisma/
 * prisma.service` are mocked wholesale (the real HTTP round-trip is `pdp-live.spec.ts`'s job, gated
 * on real sandbox credentials — see that file's own header); this proves the ORCHESTRATION: the
 * preflight gate, the payload build, and — the two facts this task's mutations target — that an
 * empty deposit id is NEVER a success and that a disconnected channel blocks BEFORE any network call.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildPdpTransport } from './pdp-transport';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockAuthenticate = jest.fn();
const mockSendInvoice = jest.fn();

jest.mock('./pdp/pdp-client', () => ({
  PdpClient: jest.fn().mockImplementation(() => ({
    authenticate: mockAuthenticate,
    sendInvoice: mockSendInvoice,
  })),
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'pdp',
  channel: 'PDP',
  environment: 'TEST' as const,
  isActive: true,
  config: { baseUrl: 'https://api.superpdp.tech', clientId: 'id-1', clientSecret: 'secret-1' },
};

function buildDeps(overrides?: { resolveActive?: jest.Mock; build?: jest.Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const facturxFormatProvider: DocumentFormatProvider = {
    id: 'facturx',
    syntax: 'FACTURX',
    mime: 'application/pdf',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  return { channelCredentials, facturxFormatProvider };
}

const CTX: DocumentTransportContext = {
  companyId: 'company-1',
  label: 'Invoice',
  document: {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: { client: 'client-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'INV-2026-0001',
  },
};

describe('buildPdpTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    });
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Acme GmbH',
      address: 'Friedrichstraße 42',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
    });
  });

  describe('preflight() — the PREFLIGHT gate, before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no PDP channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildPdpTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/PDP channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing clientSecret)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { baseUrl: 'https://api.superpdp.tech', clientId: 'id-1' },
        }),
      });
      const transport = buildPdpTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected — never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildPdpTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });
  });

  describe('send() — delivery', () => {
    it('blocks (never calls the network) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildPdpTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildPdpTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });

    it('never deposits an artifact that failed EN 16931 validation', async () => {
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['BR-CO-26: seller VAT missing'] },
      });
      const deps = buildDeps({ build });
      const transport = buildPdpTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });

    it('succeeds and returns the REAL deposit id as `reference` once superpdp accepts the upload', async () => {
      mockAuthenticate.mockResolvedValue('bearer-token');
      mockSendInvoice.mockResolvedValue({ id: 375037, direction: 'out' });
      const deps = buildDeps();
      const transport = buildPdpTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('375037');
      expect(result.message).toContain('375037');
      expect(mockSendInvoice).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({ externalId: 'INV-2026-0001' }),
      );
    });

    // THE MUTATION TARGET (#1 in the task brief): an accepted upload with an EMPTY deposit id must
    // be a FAILURE, never a silent success — a reference nobody can look up on the platform is not a
    // reference at all (this task's own hard-success contract, LIVE_TESTING.md).
    it('treats an EMPTY deposit id as a FAILURE, never a success', async () => {
      mockAuthenticate.mockResolvedValue('bearer-token');
      mockSendInvoice.mockResolvedValue({ id: undefined });
      const deps = buildDeps();
      const transport = buildPdpTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no deposit id/);
    });

    it('wraps a network/auth failure from the PDP client into a named BadRequestException — never swallowed', async () => {
      mockAuthenticate.mockRejectedValue(new Error('ECONNREFUSED'));
      const deps = buildDeps();
      const transport = buildPdpTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/PDP deposit failed: ECONNREFUSED/);
    });
  });
});
