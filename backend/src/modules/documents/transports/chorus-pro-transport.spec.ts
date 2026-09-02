/**
 * The "chorus-pro" transport in isolation — makes the B2G FR routing rule's own `transportId:
 * "chorus-pro"` (`b2g-routing/data/fr.json`) actually resolve to something real. `ChorusProClient` and
 * `@/prisma/prisma.service` are mocked wholesale (the real PISTE round-trip is `chorus-pro/
 * choruspro-live.spec.ts`'s job, gated on real PISTE credentials this checkout does not have — see
 * that file's own header); this proves the ORCHESTRATION, mirroring `pdp-transport.spec.ts`'s own
 * structure exactly: the preflight gate, the recipient (SIRET) gate, the payload build/gate, and —
 * this task's own two named mutations — that an empty `numeroFluxDepot` is NEVER a success and that an
 * artifact that failed the Factur-X/EN 16931 gate is NEVER deposited.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { buildChorusProTransport } from './chorus-pro-transport';
import { DocumentFormatProvider } from '../formats/format-provider';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findUnique: jest.fn() },
  },
}));

const mockDeposerFlux = jest.fn();

jest.mock('./chorus-pro/choruspro-client', () => {
  const actual = jest.requireActual('./chorus-pro/choruspro-client');
  return {
    ...actual,
    ChorusProClient: jest.fn().mockImplementation(() => ({
      deposerFlux: mockDeposerFlux,
    })),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findUnique: jest.Mock };
};

const CONNECTED_CONFIG = {
  providerId: 'chorus-pro',
  channel: 'CHORUS-PRO',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    clientId: 'piste-id-1',
    clientSecret: 'piste-secret-1',
    technicalAccountLogin: 'TECH_1_abcdef@cpro.fr',
    technicalAccountPassword: 'tech-password-1',
  },
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

describe('buildChorusProTransport', () => {
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
    // A GOVERNMENT client on file, SIRET (LEGAL_ID) present — the recipient gate's own happy path.
    mockedPrisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      name: 'Mairie de Testville',
      address: '1 Place de la Mairie',
      city: 'Testville',
      postalCode: '75001',
      country: 'France',
      partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '21750001600017' }],
    });
  });

  describe('preflight() — the PREFLIGHT gate, before anything is persisted or queued', () => {
    it('throws (named, for THIS channel) when no Chorus Pro channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildChorusProTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/Chorus Pro channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing technicalAccountPassword)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: {
            clientId: 'piste-id-1',
            clientSecret: 'piste-secret-1',
            technicalAccountLogin: 'TECH_1_abcdef@cpro.fr',
          },
        }),
      });
      const transport = buildChorusProTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected — never touches the network', async () => {
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });
  });

  describe('send() — delivery', () => {
    it('blocks (never calls the network) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    // THE RECIPIENT GATE (this file's own header) — REGRESSION for the existing B2G refusal: a client
    // with no SIRET/SIREN (LEGAL_ID) on file is refused, named, BEFORE any network call — same shape
    // `peppol-transport.spec.ts`'s own "no Peppol endpoint on file" test already proves for Peppol.
    it('refuses, naming the SIRET/LEGAL_ID gap, when the client has no LEGAL_ID identifier on file', async () => {
      mockedPrisma.client.findUnique.mockResolvedValue({
        id: 'client-1',
        name: 'Mairie de Testville',
        address: '1 Place de la Mairie',
        city: 'Testville',
        postalCode: '75001',
        country: 'France',
        partyIdentifiers: [], // no LEGAL_ID at all
      });
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no SIRET\/SIREN \(LEGAL_ID\) on file/);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    // MUTATION GUARD #2 — "le transport saute le gate facturx" — this test tombe the instant
    // `send()` stops checking `buildResult.validation.valid` before depositing: an artifact that
    // failed the EN 16931 Schematron gate must NEVER reach `deposerFlux`, only be refused, named.
    it('MUTATION GUARD #2 — never deposits an artifact that failed the Factur-X/EN 16931 gate', async () => {
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['BR-CO-26: seller VAT missing'] },
      });
      const deps = buildDeps({ build });
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed EN 16931 validation/);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    it('succeeds and returns the REAL numeroFluxDepot as `reference` once PISTE accepts the deposit', async () => {
      mockDeposerFlux.mockResolvedValue({
        numeroFluxDepot: '375037',
        statut: 'DEPOSE',
        httpStatus: 200,
        raw: {},
      });
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);

      const result = await transport.send(CTX);

      expect(result.reference).toBe('375037');
      expect(result.providerId).toBe('chorus-pro');
      expect(result.message).toContain('375037');
      expect(result.artifacts).toEqual([
        { role: 'facturx', mime: 'application/pdf', bytes: new Uint8Array([1]) },
      ]);
      expect(mockDeposerFlux).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringContaining('doc-1'),
        'IN_DP_E3_FACTUR_X_10',
      );
    });

    // MUTATION GUARD #1 — "identifiant de dépôt vide accepté" — this task's own hard-success
    // contract (LIVE_TESTING.md): an accepted deposit with an EMPTY numeroFluxDepot must be a
    // FAILURE, never a silent success — a reference nobody can look up is not a reference at all.
    it('MUTATION GUARD #1 — treats an EMPTY numeroFluxDepot as a FAILURE, never a success', async () => {
      mockDeposerFlux.mockResolvedValue({ numeroFluxDepot: '', statut: 'DEPOSE', httpStatus: 200, raw: {} });
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/no deposit id \(numeroFluxDepot\)/);
    });

    it('wraps a network/auth failure from the Chorus Pro client into a named BadRequestException — never swallowed', async () => {
      mockDeposerFlux.mockRejectedValue(new Error('Chorus Pro PISTE authentication failed (HTTP 400)'));
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(
        /Chorus Pro deposit failed: Chorus Pro PISTE authentication failed \(HTTP 400\)/,
      );
    });
  });
});
