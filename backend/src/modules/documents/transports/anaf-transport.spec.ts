/**
 * The "anaf" transport in isolation — `AnafClient` and `@/prisma/prisma.service` are mocked wholesale
 * (the real HTTP round-trip is `anaf/anaf-client.spec.ts`'s job, against a real local HTTP stub); this
 * proves the ORCHESTRATION: the preflight gate, the format gate, and — the two facts this task's
 * mutations target — that an empty `index_incarcare` is NEVER a success and that a disconnected
 * channel blocks BEFORE any network call.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildAnafTransport } from './anaf-transport';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockUploadInvoice = jest.fn();

jest.mock('./anaf/anaf-client', () => ({
  AnafClient: jest.fn().mockImplementation(() => ({
    uploadInvoice: mockUploadInvoice,
  })),
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'anaf',
  channel: 'ANAF',
  environment: 'TEST' as const,
  isActive: true,
  config: { cif: '12345678', clientId: 'id-1', clientSecret: 'secret-1', refreshToken: 'refresh-1' },
};

function buildDeps(overrides?: { resolveActive?: jest.Mock; build?: jest.Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const ublFormatProvider: DocumentFormatProvider = {
    id: 'ubl',
    syntax: 'EN16931_UBL',
    mime: 'application/xml',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  return { channelCredentials, ublFormatProvider };
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

describe('buildAnafTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Bucuresti Consulting SRL',
      address: 'Calea Victoriei 1',
      city: 'Bucuresti',
      postalCode: '010071',
      country: 'Romania',
      partyIdentifiers: [{ scheme: 'VAT', value: 'RO12345678' }],
    });
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Cluj Trading SRL',
      address: 'Piata Unirii 2',
      city: 'Cluj-Napoca',
      postalCode: '400001',
      country: 'Romania',
      partyIdentifiers: [{ scheme: 'VAT', value: 'RO87654321' }],
    });
  });

  describe('preflight() — the PREFLIGHT gate, before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no ANAF channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildAnafTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/ANAF channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing refreshToken)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { cif: '12345678', clientId: 'id-1', clientSecret: 'secret-1' },
        }),
      });
      const transport = buildAnafTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected — never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildAnafTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockUploadInvoice).not.toHaveBeenCalled();
    });
  });

  describe('send() — delivery', () => {
    it('blocks (never calls the network) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildAnafTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockUploadInvoice).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildAnafTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockUploadInvoice).not.toHaveBeenCalled();
    });

    it('never uploads an artifact that failed EN 16931 validation — the FORMAT GATE', async () => {
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['BR-CO-26: seller VAT missing'] },
      });
      const deps = buildDeps({ build });
      const transport = buildAnafTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockUploadInvoice).not.toHaveBeenCalled();
    });

    it('succeeds and returns the REAL index_incarcare as `reference` once ANAF accepts the upload', async () => {
      mockUploadInvoice.mockResolvedValue({ idIncarcare: '5000000001', raw: '<header/>' });
      const deps = buildDeps();
      const transport = buildAnafTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('5000000001');
      expect(result.providerId).toBe('anaf');
      expect(result.message).toContain('5000000001');
      expect(result.artifacts).toEqual([
        { role: 'ubl', mime: 'application/xml', bytes: new Uint8Array([1]) },
      ]);
      expect(mockUploadInvoice).toHaveBeenCalledWith(expect.any(String));
    });

    // THE MUTATION TARGET (#1 in the task brief): an accepted upload with an EMPTY index_incarcare
    // must be a FAILURE, never a silent success — a reference nobody can look up on ANAF's own portal
    // is not a reference at all (this task's own hard-success contract, LIVE_TESTING.md). The client
    // itself already throws on this (`anaf-client.spec.ts`) — this proves the transport's OWN
    // defence-in-depth check holds too, for a hypothetical client implementation that didn't.
    it('treats an EMPTY index_incarcare as a FAILURE, never a success', async () => {
      mockUploadInvoice.mockResolvedValue({ idIncarcare: '', raw: '<header/>' });
      const deps = buildDeps();
      const transport = buildAnafTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no upload id/);
    });

    it('wraps a network/auth failure from the ANAF client into a named BadRequestException — never swallowed', async () => {
      mockUploadInvoice.mockRejectedValue(new Error('ANAF token: authentication failed (HTTP 400)'));
      const deps = buildDeps();
      const transport = buildAnafTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/ANAF upload failed:/);
    });
  });
});
