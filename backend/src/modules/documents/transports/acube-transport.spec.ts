/**
 * The "acube" transport in isolation - `@/prisma/prisma.service` is mocked wholesale, the same
 * discipline `pdp-transport.spec.ts`/`sdi-transport.spec.ts` hold. The REAL wire is
 * `acube/acube.live.spec.ts` (gated `ACUBE_LIVE=1`), which actually deposited a FatturaPA in the
 * sandbox and read the uuid back off the platform - nothing here claims to prove the integration.
 * What IS proven here is the orchestration a live run would never exercise on a good day:
 *
 *  1. `preflight()` refuses, by name, before anything is persisted or queued, when the channel is
 *     not connected or the stored config is incomplete.
 *  2. `send()` re-resolves the channel rather than trusting the preflight's result, refuses a
 *     document with no valid client, and never deposits an artifact that failed the XSD gate.
 *  3. The hard-success contract: an accepted deposit carrying no uuid is a FAILURE, never a silent
 *     success.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildAcubeTransport, extractAcubeCredentials } from './acube-transport';
import { DocumentTransportContext } from './transport-registry';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  client: { findFirst: Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'acube',
  channel: 'ACUBE',
  environment: 'TEST' as const,
  isActive: true,
  config: { email: 'account@example.test', password: 'generated-password' },
};

function buildDeps(overrides?: { resolveActive?: Mock; build?: Mock; sendInvoice?: Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? vi.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const fatturapaFormatProvider: DocumentFormatProvider = {
    id: 'fatturapa',
    syntax: 'FATTURAPA',
    mime: 'application/xml',
    build:
      overrides?.build ??
      vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  const sendInvoice = overrides?.sendInvoice ?? vi.fn().mockResolvedValue({ uuid: 'uuid-from-acube' });
  return {
    deps: {
      channelCredentials,
      fatturapaFormatProvider,
      clientFactory: () => ({
        sendInvoice,
        getBaseUrl: () => 'https://it-sandbox.api.acubeapi.com',
      }),
    },
    sendInvoice,
  };
}

const CTX: DocumentTransportContext = {
  companyId: 'company-1',
  label: 'Invoice',
  document: {
    id: 'doc-1234567890',
    typeId: 'invoice',
    status: 'sending',
    data: { client: 'client-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'FT-2026-0001',
  },
};

describe('extractAcubeCredentials', () => {
  it("maps the ROW's own environment onto the platform environment, never a second config field", () => {
    expect(extractAcubeCredentials({ ...CONNECTED_CONFIG })?.environment).toBe('sandbox');
    expect(extractAcubeCredentials({ ...CONNECTED_CONFIG, environment: 'PROD' as const })?.environment).toBe(
      'production',
    );
  });

  it('returns null when either half of the password exchange is missing', () => {
    expect(extractAcubeCredentials({ ...CONNECTED_CONFIG, config: { email: 'a@b.test' } })).toBeNull();
    expect(extractAcubeCredentials({ ...CONNECTED_CONFIG, config: { password: 'x' } })).toBeNull();
    expect(extractAcubeCredentials({ ...CONNECTED_CONFIG, config: { email: '', password: 'x' } })).toBeNull();
  });
});

describe('buildAcubeTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Rossi SRL',
      address: 'Via Roma 10',
      city: 'Milano',
      postalCode: '20100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT12345678901' }],
    });
    mockedPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Bianchi SpA',
      address: 'Corso Italia 20',
      city: 'Roma',
      postalCode: '00100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
    });
  });

  describe('preflight() - before anything is persisted or queued', () => {
    it('throws, named for THIS channel, when no A-Cube channel is connected at all', async () => {
      const { deps } = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildAcubeTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/A-Cube channel is not connected/);
    });

    it('throws when connected but the stored config is incomplete (no password)', async () => {
      const { deps } = buildDeps({
        resolveActive: vi
          .fn()
          .mockResolvedValue({ ...CONNECTED_CONFIG, config: { email: 'account@example.test' } }),
      });
      const transport = buildAcubeTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected', async () => {
      const { deps } = buildDeps();
      const transport = buildAcubeTransport(deps);

      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
    });
  });

  describe('send()', () => {
    it('blocks (never reaches the platform) when the channel is not connected - re-checked, not cached from preflight', async () => {
      const { deps, sendInvoice } = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildAcubeTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(sendInvoice).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      const { deps, sendInvoice } = buildDeps();
      const transport = buildAcubeTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no valid client on file/);
      expect(sendInvoice).not.toHaveBeenCalled();
    });

    it('never deposits an artifact that failed XSD validation', async () => {
      const build = vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['Element Numero: too long'] },
      });
      const { deps, sendInvoice } = buildDeps({ build });
      const transport = buildAcubeTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed XSD validation/);
      expect(sendInvoice).not.toHaveBeenCalled();
    });

    it('deposits the gated FatturaPA and returns the uuid as `reference`, archiving the very bytes sent', async () => {
      const { deps, sendInvoice } = buildDeps();
      const transport = buildAcubeTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('uuid-from-acube');
      expect(result.providerId).toBe('acube');
      expect(result.message).toContain('uuid-from-acube');
      expect(result.artifacts).toEqual([
        { role: 'fatturapa', mime: 'application/xml', bytes: Buffer.from([1]) },
      ]);
      expect(sendInvoice).toHaveBeenCalledWith(Buffer.from([1]));
    });

    it('treats an accepted deposit with NO uuid as a FAILURE, never a silent success', async () => {
      const { deps } = buildDeps({ sendInvoice: vi.fn().mockResolvedValue({}) });
      const transport = buildAcubeTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/returned no invoice uuid/);
    });

    it('wraps a platform/network failure into a named BadRequestException - never swallowed', async () => {
      const { deps } = buildDeps({
        sendInvoice: vi.fn().mockRejectedValue(new Error('A-Cube /invoices: 400 - invoice already sent')),
      });
      const transport = buildAcubeTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/A-Cube deposit failed: .*invoice already sent/);
    });
  });
});
