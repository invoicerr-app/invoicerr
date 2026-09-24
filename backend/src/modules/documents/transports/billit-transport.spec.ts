/**
 * The "billit" transport in isolation. `BillitClient` and `@/prisma/prisma.service` are mocked
 * wholesale (the real HTTP round-trip is `billit/billit.live.spec.ts`'s job, gated on real sandbox
 * credentials - see that file's own header); this proves the ORCHESTRATION: the preflight gate, the
 * payload build, and the two facts that matter most - that an empty InboxItemID is NEVER a success
 * and that a disconnected channel blocks BEFORE any network call.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildBillitTransport, extractBillitCredentials } from './billit-transport';
import { DocumentTransportContext } from './transport-registry';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

const mockSendPeppolXml = vi.fn();
const capturedCredentials: unknown[] = [];

vi.mock('./billit/billit-client', () => ({
  // A `function` expression, NOT an arrow function - production code does `new BillitClient(...)`,
  // and Vitest's mocks really `[[Construct]]` their implementation, which an arrow function has no
  // slot for (the same trap `pdp-transport.spec.ts` documents for `PdpClient`).
  // biome-ignore lint/complexity/useArrowFunction: must stay a function expression - an arrow function has no [[Construct]] and breaks `new BillitClient(...)` under Vitest, see above.
  BillitClient: vi.fn().mockImplementation(function (credentials: unknown) {
    capturedCredentials.push(credentials);
    return { sendPeppolXml: mockSendPeppolXml };
  }),
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  client: { findFirst: Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'billit',
  channel: 'Billit',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    baseUrl: 'https://api.sandbox.billit.be/v1',
    apiKey: 'key-1',
    partyId: '1234567',
  },
};

function buildDeps(overrides?: { resolveActive?: Mock; build?: Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? vi.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const peppolBisFormatProvider: DocumentFormatProvider = {
    id: 'peppol-bis',
    syntax: 'PEPPOL_BIS_BILLING_3',
    mime: 'application/xml',
    build:
      overrides?.build ??
      vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<Invoice/>'),
        validation: { valid: true, errors: [] },
      }),
  };
  return { channelCredentials, peppolBisFormatProvider };
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

describe('buildBillitTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCredentials.length = 0;
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    });
    mockedPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Acme BV',
      address: 'Oktrooiplein 1',
      city: 'Gent',
      postalCode: '9000',
      country: 'Belgium',
      partyIdentifiers: [{ scheme: 'VAT', value: 'BE0563846944' }],
    });
  });

  describe('extractBillitCredentials - what "complete enough to try" means', () => {
    it('accepts a config carrying all three fields', () => {
      expect(extractBillitCredentials(CONNECTED_CONFIG)).toEqual({
        baseUrl: 'https://api.sandbox.billit.be/v1',
        apiKey: 'key-1',
        partyId: '1234567',
      });
    });

    // The PartyID differs between sandbox and production, and one account covering several companies
    // has one per company - so there is no honest default to fall back to.
    it('refuses a config with no partyId rather than defaulting one', () => {
      expect(
        extractBillitCredentials({
          ...CONNECTED_CONFIG,
          config: { baseUrl: 'https://api.sandbox.billit.be/v1', apiKey: 'key-1' },
        }),
      ).toBeNull();
    });
  });

  describe('preflight() - the PREFLIGHT gate, before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no Billit channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildBillitTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/Billit channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing apiKey)', async () => {
      const deps = buildDeps({
        resolveActive: vi.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { baseUrl: 'https://api.sandbox.billit.be/v1', partyId: '1234567' },
        }),
      });
      const transport = buildBillitTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected - never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildBillitTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockSendPeppolXml).not.toHaveBeenCalled();
    });
  });

  describe('send() - delivery', () => {
    it('blocks (never calls the network) when the channel is not connected - re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildBillitTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockSendPeppolXml).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildBillitTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockSendPeppolXml).not.toHaveBeenCalled();
    });

    it('never deposits an artifact that failed the Peppol BIS gates', async () => {
      const build = vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['PEPPOL-EN16931-R003: buyer reference missing'] },
      });
      const deps = buildDeps({ build });
      const transport = buildBillitTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockSendPeppolXml).not.toHaveBeenCalled();
    });

    it('succeeds and returns the REAL InboxItemID as `reference` once Billit accepts the deposit', async () => {
      mockSendPeppolXml.mockResolvedValue({ inboxItemId: '3327952', raw: { InboxItemID: 3327952 } });
      const deps = buildDeps();
      const transport = buildBillitTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('3327952');
      expect(result.providerId).toBe('billit');
      expect(result.message).toContain('3327952');
      expect(result.artifacts).toEqual([
        { role: 'peppol-bis', mime: 'application/xml', bytes: new TextEncoder().encode('<Invoice/>') },
      ]);
      // The document deposited is the UBL, decoded from the SAME bytes that are archived.
      expect(mockSendPeppolXml).toHaveBeenCalledWith('<Invoice/>');
      // The PartyID the company configured reaches the client - never a constant.
      expect(capturedCredentials[0]).toEqual({
        baseUrl: 'https://api.sandbox.billit.be/v1',
        apiKey: 'key-1',
        partyId: '1234567',
      });
    });

    // An accepted deposit with an EMPTY identifier must be a FAILURE, never a silent success - a
    // reference nobody can look up on the platform is not a reference at all (the hard-success
    // contract, documentation/docs/developer-guide/live-testing.md).
    it('treats an EMPTY InboxItemID as a FAILURE, never a success', async () => {
      mockSendPeppolXml.mockResolvedValue({ inboxItemId: '', raw: {} });
      const deps = buildDeps();
      const transport = buildBillitTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no InboxItemID/);
    });

    it('wraps a network/refusal failure from the Billit client into a named BadRequestException - never swallowed', async () => {
      mockSendPeppolXml.mockRejectedValue(new Error('ECONNREFUSED'));
      const deps = buildDeps();
      const transport = buildBillitTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/Billit deposit failed: ECONNREFUSED/);
    });
  });
});
