/**
 * The "face" transport in isolation — makes the B2G ES routing rule's own `transportId: "face"`
 * (`b2g-routing/data/es.json`) actually resolve to something real. `FaceClient` and
 * `@/prisma/prisma.service` are mocked wholesale (a real FACe round-trip needs a FACe-registered
 * certificate this checkout does not have, and a WS-Security signature this codebase does not
 * implement — see `face/face-client.ts`'s own header); this proves the ORCHESTRATION, mirroring
 * `chorus-pro-transport.spec.ts`'s own structure exactly: the preflight gate, the DIR3 gate, the
 * payload build/signature gate, and — this task's own two named mutations — that an empty
 * `numeroRegistro` is NEVER a success and that an unsigned Facturae artifact is NEVER deposited.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { buildFaceTransport } from './face-transport';
import { FacturaeSigningRequiredError } from '../formats/national/facturae-provider';
import { DocumentFormatProvider } from '../formats/format-provider';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockEnviarFactura = jest.fn();

jest.mock('./face/face-client', () => {
  const actual = jest.requireActual('./face/face-client');
  return {
    ...actual,
    FaceClient: jest.fn().mockImplementation(() => ({
      enviarFactura: mockEnviarFactura,
    })),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'face',
  channel: 'FACE',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    certificate: Buffer.from('fake-pfx-bytes').toString('base64'),
    certificatePassword: 'cert-password-1',
    notificationEmail: 'facturacion@empresa.es',
  },
};

function buildDeps(overrides?: { resolveActive?: jest.Mock; build?: jest.Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const facturaeFormatProvider: DocumentFormatProvider = {
    id: 'facturae',
    syntax: 'ES_FACTURAE',
    mime: 'application/xml',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({ bytes: new Uint8Array([1]), validation: { valid: true, errors: [] } }),
  };
  return { channelCredentials, facturaeFormatProvider };
}

const DIR3_DATA = {
  client: 'client-1',
  dir3OrganoGestor: 'L01280796',
  dir3UnidadTramitadora: 'L01280796',
  dir3OficinaContable: 'L01280796',
};

const CTX: DocumentTransportContext = {
  companyId: 'company-1',
  label: 'Invoice',
  document: {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sending',
    data: DIR3_DATA,
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'INV-2026-0001',
  },
};

describe('buildFaceTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Consultoría Ibérica SL',
      address: 'Calle Mayor 10',
      city: 'Madrid',
      postalCode: '28013',
      country: 'Spain',
      partyIdentifiers: [{ scheme: 'VAT', value: 'ESB12345674' }],
    });
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Ayuntamiento de Testville',
      address: 'Plaza Mayor 1',
      city: 'Testville',
      postalCode: '28001',
      country: 'Spain',
      partyIdentifiers: [{ scheme: 'VAT', value: 'ESQ2817001J' }],
    });
  });

  describe('preflight() — before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no FACe channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildFaceTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/FACe channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing notificationEmail)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { certificate: CONNECTED_CONFIG.config.certificate, certificatePassword: 'x' },
        }),
      });
      const transport = buildFaceTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected — never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });
  });

  describe('send() — the DIR3 gate', () => {
    it('refuses, naming the missing DIR3 codes, when NONE are on the invoice — never attempted', async () => {
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);
      const ctx: DocumentTransportContext = {
        ...CTX,
        document: { ...CTX.document, data: { client: 'client-1' } },
      };

      await expect(transport.send(ctx)).rejects.toThrow(BadRequestException);
      await expect(transport.send(ctx)).rejects.toThrow(/DIR3 routing codes are incomplete/);
      await expect(transport.send(ctx)).rejects.toThrow(/Órgano Gestor/);
      await expect(transport.send(ctx)).rejects.toThrow(/Unidad Tramitadora/);
      await expect(transport.send(ctx)).rejects.toThrow(/Oficina Contable/);
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });

    it('refuses, naming ONLY the missing ones, when the DIR3 triad is PARTIALLY present', async () => {
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);
      const ctx: DocumentTransportContext = {
        ...CTX,
        document: { ...CTX.document, data: { client: 'client-1', dir3OrganoGestor: 'L01280796' } },
      };

      await expect(transport.send(ctx)).rejects.toThrow(/Unidad Tramitadora/);
      await expect(transport.send(ctx)).rejects.toThrow(/Oficina Contable/);
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });

    it('proceeds once all three DIR3 codes are present', async () => {
      mockEnviarFactura.mockResolvedValue({
        codigo: '0',
        descripcion: 'Correcto',
        numeroRegistro: '2026/000001',
      });
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);
      const result = await transport.send(CTX);
      expect(result.reference).toBe('2026/000001');
    });
  });

  describe('send() — delivery', () => {
    it('blocks (never calls the network) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildFaceTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });

    // MUTATION GUARD #1 — "la Facturae non signée passe quand même" — this test tombe the instant
    // `send()` stops propagating `FacturaeSigningRequiredError` as a named refusal: an unsigned
    // artifact (or the build failing to even attempt signing) must NEVER reach `enviarFactura`.
    it('MUTATION GUARD #1 — never deposits when the Facturae build refuses for lack of a signature', async () => {
      const build = jest.fn().mockRejectedValue(new FacturaeSigningRequiredError('no active XAdES cert'));
      const deps = buildDeps({ build });
      const transport = buildFaceTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no active XAdES cert/);
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });

    it('never deposits an artifact that failed the Facturae XSD gate', async () => {
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['TaxIdentificationNumber: minLength violation'] },
      });
      const deps = buildDeps({ build });
      const transport = buildFaceTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed XSD validation/);
      expect(mockEnviarFactura).not.toHaveBeenCalled();
    });

    it('succeeds and returns the REAL numeroRegistro as `reference` once FACe accepts the deposit', async () => {
      mockEnviarFactura.mockResolvedValue({
        codigo: '0',
        descripcion: 'Correcto',
        numeroRegistro: '2026/000001396',
      });
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('2026/000001396');
      expect(result.providerId).toBe('face');
      expect(result.message).toContain('2026/000001396');
      expect(result.artifacts).toEqual([
        { role: 'facturae', mime: 'application/xml', bytes: new Uint8Array([1]) },
      ]);
      expect(mockEnviarFactura).toHaveBeenCalledWith(
        expect.objectContaining({
          correo: 'facturacion@empresa.es',
          facturaNombre: expect.stringContaining('doc-1'),
        }),
      );
    });

    // MUTATION GUARD #2 — this task's own hard-success contract: an accepted enviarFactura with an
    // EMPTY numeroRegistro must be a FAILURE, never a silent success — a reference nobody can look
    // up is not a reference at all.
    it('MUTATION GUARD #2 — treats an EMPTY numeroRegistro as a FAILURE, never a success', async () => {
      mockEnviarFactura.mockResolvedValue({ codigo: '0', descripcion: 'Correcto', numeroRegistro: '' });
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no registry number \(numeroRegistro\)/);
    });

    it('a non-zero codigo (SSPP application error) is refused, naming the code and descripcion', async () => {
      mockEnviarFactura.mockResolvedValue({ codigo: '303', descripcion: 'no existe factura' });
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/codigo 303/);
    });

    it('wraps a network/SOAP failure into a named BadRequestException — never swallowed', async () => {
      mockEnviarFactura.mockRejectedValue(new Error('FACe SOAP fault: authentication failed'));
      const deps = buildDeps();
      const transport = buildFaceTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/FACe enviarFactura failed: FACe SOAP fault/);
    });
  });
});
