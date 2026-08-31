/**
 * The "sdi" transport in isolation — root TODO item 10, wave 2. `@/prisma/prisma.service` is mocked
 * wholesale, same discipline `pdp-transport.spec.ts`/`ksef-transport.spec.ts` hold. Two distinct
 * things are proven here:
 *
 *  1. The REAL production wiring (no `httpPort` override) genuinely fails, honestly, the moment
 *     `send()` is reached — `UNACCREDITED_SDI_HTTP_PORT` (`sdi/sdi-client.ts`) is what a deployment
 *     gets today, pending AdE accreditation (see `sdi-transport.ts`'s own header). This is NOT a bug
 *     this spec papers over: it is the honest, current state, asserted rather than assumed.
 *  2. The ORCHESTRATION around a (mocked) accredited client — preflight gate, FatturaPA payload
 *     build+gate, and this task's mutation #2-adjacent fact for THIS channel: an empty `idSdI` is
 *     NEVER a success — using an injected mock `SdiHttpPort`, the seam a real SOAP client plugs into
 *     once accreditation lands. The real wire is `sdi/sdi-live.spec.ts`, gated `SDI_LIVE=1`.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildSdiTransport } from './sdi-transport';
import { SdiHttpPort } from './sdi/sdi-client';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'sdi',
  channel: 'SDI',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    idTrasmittente: 'IT01234567890',
    certificate: 'base64-pfx-contents',
    certificatePassword: 'secret',
  },
};

function buildDeps(overrides?: { resolveActive?: jest.Mock; build?: jest.Mock; httpPort?: SdiHttpPort }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const fatturapaFormatProvider: DocumentFormatProvider = {
    id: 'fatturapa',
    syntax: 'FATTURAPA',
    mime: 'application/xml',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  return { channelCredentials, fatturapaFormatProvider, httpPort: overrides?.httpPort };
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

describe('buildSdiTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Rossi SRL',
      address: 'Via Roma 10',
      city: 'Milano',
      postalCode: '20100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT12345678901' }],
    });
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Bianchi SpA',
      address: 'Corso Italia 20',
      city: 'Roma',
      postalCode: '00100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
    });
  });

  describe('preflight() — the PREFLIGHT gate, before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no SdI channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildSdiTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/SdI channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing certificate)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { idTrasmittente: 'IT01234567890' },
        }),
      });
      const transport = buildSdiTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected', async () => {
      const deps = buildDeps();
      const transport = buildSdiTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
    });
  });

  describe('send() — the REAL production wiring (no httpPort override)', () => {
    it('genuinely fails — AdE accreditation is not obtained today, and this transport never pretends otherwise', async () => {
      const deps = buildDeps();
      const transport = buildSdiTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/SdI submission failed/);
      await expect(transport.send(CTX)).rejects.toThrow(/AdE|accreditation/i);
    });
  });

  describe('send() — orchestration, with a mocked (future-accredited) SdiHttpPort', () => {
    it('blocks (never calls the port) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const submit = jest.fn();
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue(null),
        httpPort: { submit, getStatus: jest.fn(), sendEsito: jest.fn() },
      });
      const transport = buildSdiTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(submit).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const submit = jest.fn();
      const deps = buildDeps({ httpPort: { submit, getStatus: jest.fn(), sendEsito: jest.fn() } });
      const transport = buildSdiTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(submit).not.toHaveBeenCalled();
    });

    it('never submits an artifact that failed XSD validation', async () => {
      const submit = jest.fn();
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['Data element missing'] },
      });
      const deps = buildDeps({ build, httpPort: { submit, getStatus: jest.fn(), sendEsito: jest.fn() } });
      const transport = buildSdiTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed XSD validation/);
      expect(submit).not.toHaveBeenCalled();
    });

    it('succeeds and returns the idSdI as `reference` once (a mocked, future-accredited) SdI accepts the submission', async () => {
      const submit = jest
        .fn()
        .mockResolvedValue({ idSdI: 4242, idTrasmittente: 'IT01234567890', filename: 'x.xml' });
      const deps = buildDeps({ httpPort: { submit, getStatus: jest.fn(), sendEsito: jest.fn() } });
      const transport = buildSdiTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('4242');
      expect(result.message).toContain('4242');
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          idTrasmittente: 'IT01234567890',
          xmlBytes: expect.any(Buffer),
          filename: expect.stringMatching(/^IT01234567890_.*\.xml$/),
        }),
      );
    });

    it('treats an EMPTY idSdI as a FAILURE, never a success', async () => {
      const submit = jest
        .fn()
        .mockResolvedValue({ idSdI: undefined, idTrasmittente: 'IT01234567890', filename: 'x.xml' });
      const deps = buildDeps({ httpPort: { submit, getStatus: jest.fn(), sendEsito: jest.fn() } });
      const transport = buildSdiTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no usable idSdI/);
    });

    it('wraps a network/protocol failure from the SdI port into a named BadRequestException — never swallowed', async () => {
      const submit = jest.fn().mockRejectedValue(new Error('SOAP fault: certificate rejected'));
      const deps = buildDeps({ httpPort: { submit, getStatus: jest.fn(), sendEsito: jest.fn() } });
      const transport = buildSdiTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/SdI submission failed: SOAP fault/);
    });
  });
});
