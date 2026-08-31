/**
 * The "ksef" transport in isolation — root TODO item 10, wave 2. `KsefClient` and `@/prisma/
 * prisma.service` are mocked wholesale (the real KSeF round-trip is `ksef/ksef-live.spec.ts`'s job,
 * gated on real credentials — see that file's own header, and on `KSEF_LIVE`/`KSEF_AUTH_TOKEN`/
 * `KSEF_NIP`, absent today); this proves the ORCHESTRATION: the preflight gate, the FA(3) payload
 * build+gate, and — the two facts this task's mutation #2 targets — that an empty session/invoice
 * reference is NEVER a success and that a disconnected channel blocks BEFORE any network call.
 * `ksef-crypto.spec.ts`/`ksef-client.spec.ts` are reprised unchanged and prove the crypto/client
 * pieces this transport composes; this file only proves the composition.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildKsefTransport } from './ksef-transport';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockAuthChallenge = jest.fn();
const mockAuthKsefToken = jest.fn();
const mockAuthStatus = jest.fn();
const mockAuthRedeem = jest.fn();
const mockOpenOnlineSession = jest.fn();
const mockSendInvoice = jest.fn();
const mockCloseSession = jest.fn();

jest.mock('./ksef/ksef-client', () => {
  const actual = jest.requireActual('./ksef/ksef-client');
  return {
    ...actual,
    KsefClient: jest.fn().mockImplementation(() => ({
      authChallenge: mockAuthChallenge,
      authKsefToken: mockAuthKsefToken,
      authStatus: mockAuthStatus,
      authRedeem: mockAuthRedeem,
      openOnlineSession: mockOpenOnlineSession,
      sendInvoice: mockSendInvoice,
      closeSession: mockCloseSession,
    })),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'ksef',
  channel: 'KSEF',
  environment: 'TEST' as const,
  isActive: true,
  config: { nip: '5260001246', ksefToken: 'ksef-token-value' },
};

function buildDeps(overrides?: { resolveActive?: jest.Mock; build?: jest.Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const fa3FormatProvider: DocumentFormatProvider = {
    id: 'fa3',
    syntax: 'FA_VAT_3',
    mime: 'application/xml',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  return { channelCredentials, fa3FormatProvider };
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

/** The nominal happy path a real KSeF handshake goes through — one call each, auth status 200 on
 *  the first poll. Individual tests override whichever step they care about. */
function mockNominalKsefRoundTrip() {
  mockAuthChallenge.mockResolvedValue({
    challenge: 'chal-1',
    timestamp: '2026-01-01',
    timestampMs: 1,
    clientIp: '',
  });
  mockAuthKsefToken.mockResolvedValue({
    referenceNumber: 'auth-ref-1',
    authenticationToken: { token: 'auth-token-1', validUntil: '' },
  });
  mockAuthStatus.mockResolvedValue({
    startDate: '',
    authenticationMethod: 'Token',
    status: { code: 200, description: 'OK' },
  });
  mockAuthRedeem.mockResolvedValue({
    accessToken: { token: 'access-token-1', validUntil: '' },
    refreshToken: { token: 'refresh-token-1', validUntil: '' },
  });
  mockOpenOnlineSession.mockResolvedValue({ referenceNumber: 'session-ref-1', validUntil: '' });
  mockSendInvoice.mockResolvedValue({ referenceNumber: 'invoice-ref-1' });
  mockCloseSession.mockResolvedValue(undefined);
}

describe('buildKsefTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Kowalski Consulting Sp. z o.o.',
      address: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'Poland',
      partyIdentifiers: [{ scheme: 'VAT', value: 'PL5260001246' }],
    });
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Nowak Sp. z o.o.',
      address: 'ul. Kupiecka 2',
      city: 'Kraków',
      postalCode: '31-010',
      country: 'Poland',
      partyIdentifiers: [{ scheme: 'VAT', value: 'PL9876543210' }],
    });
  });

  describe('preflight() — the PREFLIGHT gate, before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no KSeF channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildKsefTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/KSeF channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing ksefToken)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({ ...CONNECTED_CONFIG, config: { nip: '5260001246' } }),
      });
      const transport = buildKsefTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected — never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockAuthChallenge).not.toHaveBeenCalled();
    });
  });

  describe('send() — delivery', () => {
    it('blocks (never calls the network) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildKsefTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockAuthChallenge).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockAuthChallenge).not.toHaveBeenCalled();
    });

    it('never submits an artifact that failed XSD validation', async () => {
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['NIP does not match required pattern'] },
      });
      const deps = buildDeps({ build });
      const transport = buildKsefTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed XSD validation/);
      expect(mockAuthChallenge).not.toHaveBeenCalled();
    });

    it('succeeds and returns "sessionRef|invoiceRef" as `reference` once KSeF accepts the submission', async () => {
      mockNominalKsefRoundTrip();
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('session-ref-1|invoice-ref-1');
      expect(result.message).toContain('session-ref-1');
      expect(result.message).toContain('invoice-ref-1');
      expect(result.artifacts).toEqual([
        { role: 'fa3', mime: 'application/xml', bytes: new Uint8Array([1]) },
      ]);
      expect(mockCloseSession).toHaveBeenCalledWith('session-ref-1', 'access-token-1');
    });

    // THE MUTATION TARGET (#2 in the task brief): an accepted submission with an EMPTY session or
    // invoice reference must be a FAILURE, never a silent success.
    it('treats an EMPTY invoice reference as a FAILURE, never a success', async () => {
      mockNominalKsefRoundTrip();
      mockSendInvoice.mockResolvedValue({ referenceNumber: '' });
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no usable session\/invoice reference/);
    });

    it('treats an EMPTY session reference as a FAILURE, never a success', async () => {
      mockNominalKsefRoundTrip();
      mockOpenOnlineSession.mockResolvedValue({ referenceNumber: '', validUntil: '' });
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/no usable session\/invoice reference/);
    });

    it('wraps a rejected authentication into a named BadRequestException — never swallowed', async () => {
      mockNominalKsefRoundTrip();
      mockAuthStatus.mockResolvedValue({
        startDate: '',
        authenticationMethod: 'Token',
        status: { code: 400, description: 'invalid token' },
      });
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/KSeF submission failed/);
      expect(mockOpenOnlineSession).not.toHaveBeenCalled();
    });

    it('wraps a network failure from the KSeF client into a named BadRequestException — never swallowed', async () => {
      mockAuthChallenge.mockRejectedValue(new Error('ECONNREFUSED'));
      const deps = buildDeps();
      const transport = buildKsefTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/KSeF submission failed: ECONNREFUSED/);
    });
  });
});
