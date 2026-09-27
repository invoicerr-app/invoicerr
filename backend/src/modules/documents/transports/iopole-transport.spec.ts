/**
 * The "iopole" transport in isolation. `IopoleClient` and `@/prisma/prisma.service` are mocked
 * wholesale (the real HTTP round-trip is `iopole/iopole.live.spec.ts`'s job, gated on real sandbox
 * credentials - see that file's own header); this proves the ORCHESTRATION: the preflight gate, the
 * payload build, and the three facts that matter most - that an empty invoice id is NEVER a success,
 * that a disconnected channel blocks BEFORE any network call, and that a config missing the
 * `customerId` counts as disconnected rather than being discovered deep inside the client.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildIopoleTransport, extractIopoleCredentials, IOPOLE_URLS } from './iopole-transport';
import { DocumentTransportContext } from './transport-registry';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

const mockAuthenticate = vi.fn();
const mockSendInvoice = vi.fn();

vi.mock('./iopole/iopole-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./iopole/iopole-client')>();
  return {
    ...actual,
    // A `function` expression, NOT an arrow function - production code does `new IopoleClient(...)`
    // and Vitest's mocks really `[[Construct]]` their implementation, which an arrow function cannot
    // do. Same trap `pdp-transport.spec.ts` documents for itself.
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression - an arrow function has no [[Construct]] and breaks `new IopoleClient(...)` under Vitest, see above.
    IopoleClient: vi.fn().mockImplementation(function () {
      return { authenticate: mockAuthenticate, sendInvoice: mockSendInvoice };
    }),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  client: { findFirst: Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'iopole',
  channel: 'IOPOLE',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    clientId: 'pdp+iopole@example.test',
    clientSecret: 'secret-1',
    customerId: '00000000-0000-0000-0000-000000000000',
  },
};

function buildDeps(overrides?: { resolveActive?: Mock; build?: Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? vi.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const facturxFormatProvider: DocumentFormatProvider = {
    id: 'facturx',
    syntax: 'FACTURX',
    mime: 'application/pdf',
    build:
      overrides?.build ??
      vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
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

describe('extractIopoleCredentials', () => {
  it('reads the three fields and derives the environment from the ROW, never a config field', () => {
    expect(extractIopoleCredentials(CONNECTED_CONFIG)).toEqual({
      clientId: 'pdp+iopole@example.test',
      clientSecret: 'secret-1',
      customerId: '00000000-0000-0000-0000-000000000000',
      environment: 'sandbox',
    });
    expect(extractIopoleCredentials({ ...CONNECTED_CONFIG, environment: 'PROD' })?.environment).toBe('prod');
  });

  // The `customer-id` header is mandatory on EVERY Iopole call - see `iopole/iopole-client.ts`'s own
  // header, point 3. A config without one can do nothing at all, so it is incomplete in exactly the
  // same sense a missing secret is, and must be caught by the SAME gate.
  it.each(['clientId', 'clientSecret', 'customerId'])('returns null when %s is missing', (field) => {
    const config = { ...CONNECTED_CONFIG.config } as Record<string, unknown>;
    delete config[field];
    expect(extractIopoleCredentials({ ...CONNECTED_CONFIG, config })).toBeNull();
  });
});

describe('IOPOLE_URLS', () => {
  // Fixed per environment, never company-supplied - the whole reason `iopole-client.ts` can state it
  // has no SSRF primitive to close. A test, not a comment, so a later "make the base URL
  // configurable" change has to argue with something.
  it('pins both environments to Iopole hosts over https', () => {
    for (const urls of Object.values(IOPOLE_URLS)) {
      expect(urls.apiBaseUrl).toMatch(/^https:\/\/[^/]*iopole\.(fr|com)$/);
      expect(urls.tokenUrl).toMatch(/^https:\/\/[^/]*iopole\.(fr|com)\/realms\/iopole\//);
    }
  });
});

describe('buildIopoleTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      name: 'Acme SAS',
      address: '3 Rue du Bac',
      city: 'Lyon',
      postalCode: '69002',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR32123456789' }],
    });
  });

  describe('preflight() - before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no Iopole channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildIopoleTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/Iopole channel is not connected/);
    });

    it('throws when connected but the customerId is missing - mandatory on every call', async () => {
      const deps = buildDeps({
        resolveActive: vi.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { clientId: 'a@b.test', clientSecret: 's' },
        }),
      });
      const transport = buildIopoleTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected - never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildIopoleTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });
  });

  describe('send() - delivery', () => {
    it('blocks (never calls the network) when the channel is not connected - re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildIopoleTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildIopoleTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });

    it('never deposits an artifact that failed EN 16931 validation', async () => {
      const build = vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['BR-CO-26: seller VAT missing'] },
      });
      const deps = buildDeps({ build });
      const transport = buildIopoleTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockAuthenticate).not.toHaveBeenCalled();
      expect(mockSendInvoice).not.toHaveBeenCalled();
    });

    it('succeeds and returns the REAL invoice id as `reference` once Iopole accepts the upload', async () => {
      mockAuthenticate.mockResolvedValue('bearer-token');
      mockSendInvoice.mockResolvedValue({ type: 'INVOICE', id: '01a0d287-abe2-76ec-9507-cec389ebcf71' });
      const deps = buildDeps();
      const transport = buildIopoleTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('01a0d287-abe2-76ec-9507-cec389ebcf71');
      expect(result.providerId).toBe('iopole');
      expect(result.message).toContain('01a0d287-abe2-76ec-9507-cec389ebcf71');
      expect(result.artifacts).toEqual([
        { role: 'facturx', mime: 'application/pdf', bytes: new Uint8Array([1]) },
      ]);
      // The platform validates the uploaded file's own NAME against its `.pdf|.xml` pattern - see
      // `iopoleFileExtensionFor`'s own header. Derived from the provider's mime, never a literal.
      expect(mockSendInvoice).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({ mime: 'application/pdf', fileName: 'INV-2026-0001.pdf' }),
      );
    });

    // An accepted upload with an EMPTY invoice id must be a FAILURE, never a silent success - a
    // reference nobody can look up on the platform is not a reference at all (the hard-success
    // contract, documentation/docs/developer-guide/live-testing.md).
    it('treats an EMPTY invoice id as a FAILURE, never a success', async () => {
      mockAuthenticate.mockResolvedValue('bearer-token');
      mockSendInvoice.mockResolvedValue({ type: 'INVOICE', id: undefined });
      const deps = buildDeps();
      const transport = buildIopoleTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no invoice id/);
    });

    it('wraps a network/auth failure from the Iopole client into a named BadRequestException - never swallowed', async () => {
      mockAuthenticate.mockRejectedValue(new Error('ECONNREFUSED'));
      const deps = buildDeps();
      const transport = buildIopoleTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/Iopole deposit failed: ECONNREFUSED/);
    });
  });
});
