/**
 * The "chorus-pro" transport in isolation — makes the B2G FR routing rule's own `transportId:
 * "chorus-pro"` (`b2g-routing/data/fr.json`) actually resolve to something real. `ChorusProClient` and
 * `@/prisma/prisma.service` are mocked wholesale (the real PISTE round-trip is `chorus-pro/
 * choruspro.live.spec.ts`'s job — proven live in qualification 2026-09-14, see that file's own
 * header); this proves the ORCHESTRATION, mirroring `pdp-transport.spec.ts`'s own
 * structure exactly: the preflight gate, the recipient (SIRET) gate, the payload build/gate, and —
 * the two named mutation guards — that an empty `numeroFluxDepot` is NEVER a success and that an
 * artifact that failed the Factur-X/EN 16931 gate is NEVER deposited.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { buildChorusProTransport } from './chorus-pro-transport';
import { DocumentFormatProvider } from '../formats/format-provider';
import { listCompanyPaymentMethods } from '../payment-methods/persistence';
import { DocumentTransportContext } from './transport-registry';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

// THE PAYMENT MEANS GATE now reads a company's own CONFIGURED payment methods, never
// `Company.iban` alone — see `chorus-pro-transport.ts`'s own header. Mocked wholesale (rather than
// exercising the real `payment-methods/persistence.ts` DB reads through a fuller prisma mock): this
// spec proves the TRANSPORT's own orchestration/gating, not `listCompanyPaymentMethods` itself, which
// already has its own coverage (`payment-methods/persistence.spec.ts`).
vi.mock('../payment-methods/persistence', () => ({
  listCompanyPaymentMethods: vi.fn(),
}));

const mockDeposerFlux = vi.fn();

vi.mock('./chorus-pro/choruspro-client', async () => {
  // `vi.importActual` is ASYNC (unlike Jest's synchronous `requireActual`) — the factory MUST be
  // `async` and this MUST be `await`ed, or `...actual` spreads a Promise's own (empty) enumerable
  // properties instead of the real module's exports, silently discarding every real export.
  const actual = await vi.importActual('./chorus-pro/choruspro-client');
  return {
    ...actual,
    // A `function` expression, NOT an arrow function — production code does
    // `new ChorusProClient(...)` (`chorus-pro-transport.ts`'s own `buildClient`). Jest's mocks never
    // really `[[Construct]]` their implementation (they call it plainly and use the return value), so
    // an arrow function "worked" there; Vitest's mocks DO construct it for real, and an arrow function
    // has no `[[Construct]]` at all — "TypeError: ... is not a constructor".
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new ChorusProClient(...)` under Vitest, see above.
    ChorusProClient: vi.fn().mockImplementation(function () {
      return { deposerFlux: mockDeposerFlux };
    }),
  };
});

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  client: { findFirst: Mock };
};
const mockedListCompanyPaymentMethods = listCompanyPaymentMethods as Mock;

/** THE PAYMENT MEANS GATE's own happy path: only "Bank transfer" configured and enabled — the ONE
 *  built-in method Chorus Pro's own strict allowlist accepts (`CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID`'s
 *  own header). */
const BANK_TRANSFER_ONLY = [
  { id: 'bank_transfer', label: 'Bank transfer', fields: [], enabled: true, config: {} },
];

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

describe('buildChorusProTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListCompanyPaymentMethods.mockResolvedValue(BANK_TRANSFER_ONLY);
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      // THE PAYMENT MEANS GATE's own happy path — see this file's own header. A syntactically valid
      // (mod-97 checksum verified) French IBAN; most tests below only care that ONE is on file.
      iban: 'FR7630006000011234567890189',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    });
    // A GOVERNMENT client on file, SIRET (LEGAL_ID) present — the recipient gate's own happy path.
    mockedPrisma.client.findFirst.mockResolvedValue({
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
      const deps = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildChorusProTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/Chorus Pro channel is not connected/);
    });

    it('throws when connected but the config is incomplete (missing technicalAccountPassword)', async () => {
      const deps = buildDeps({
        resolveActive: vi.fn().mockResolvedValue({
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
      const deps = buildDeps({ resolveActive: vi.fn().mockResolvedValue(null) });
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);
      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    // THE RECIPIENT GATE (this file's own header) — REGRESSION for the existing B2G refusal: a client
    // with no SIRET/SIREN (LEGAL_ID) on file is refused, named, BEFORE any network call — the same
    // "named refusal before any network call" shape every sibling transport's own recipient gate holds.
    it('refuses, naming the SIRET/LEGAL_ID gap, when the client has no LEGAL_ID identifier on file', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue({
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

    // THE PAYMENT MEANS GATE (this file's own header) — REGRESSION for the real 2026-09-14 rejection
    // (`flux CPP0011117000000000425895`, DEPOSE→IN_REJETE, "TypeCode.value est obligatoire"): a company
    // with no IBAN on file is refused, named, BEFORE any network call — same shape as the SIRET gate
    // test just above.
    it('refuses, naming the missing IBAN, when the company has no IBAN on file', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Dupont Consulting SARL',
        address: '12 Rue de la Paix',
        city: 'Paris',
        postalCode: '75002',
        country: 'France',
        iban: null,
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
      });
      const deps = buildDeps();
      const transport = buildChorusProTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/has no IBAN on file/);
      expect(mockDeposerFlux).not.toHaveBeenCalled();
    });

    // THE PAYMENT MEANS GATE's own STRICT ALLOWLIST (owner's decision, 2026-09-14) — one test per
    // built-in payment method: `CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID`'s own header for the full
    // per-method sourcing (which are admitted by UNTDID 4461 vs meaningful in the public payment
    // circuit — two DIFFERENT reasons, never conflated).
    describe('the STRICT ALLOWLIST — one built-in payment method passes, four are refused, named', () => {
      it('passes for "bank_transfer" alone (the ONLY allowed method) — reaches the network', async () => {
        mockedListCompanyPaymentMethods.mockResolvedValue(BANK_TRANSFER_ONLY);
        mockDeposerFlux.mockResolvedValue({
          numeroFluxDepot: '375037',
          statut: 'DEPOSE',
          httpStatus: 200,
          raw: {},
        });
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);

        await expect(transport.send(CTX)).resolves.toMatchObject({ reference: '375037' });
      });

      it.each([
        ['PayPal', 'paypal'],
        ['Cash', 'cash'],
        ['Cheque', 'cheque'],
        ['Stripe', 'stripe'],
      ])('refuses, naming "%s", when that is the only payment method enabled — never reaches the network', async (label, id) => {
        mockedListCompanyPaymentMethods.mockResolvedValue([
          { id, label, fields: [], enabled: true, config: {} },
        ]);
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);

        await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
        await expect(transport.send(CTX)).rejects.toThrow(new RegExp(label));
        await expect(transport.send(CTX)).rejects.toThrow(/bank transfer/i);
        expect(mockDeposerFlux).not.toHaveBeenCalled();
      });

      it('refuses with a generic message when NO payment method is configured at all', async () => {
        mockedListCompanyPaymentMethods.mockResolvedValue([]);
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);

        await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
        await expect(transport.send(CTX)).rejects.toThrow(/no payment method configured/);
        expect(mockDeposerFlux).not.toHaveBeenCalled();
      });

      it('refuses (never reaches the IBAN check) when "bank_transfer" is CONFIGURED but not ENABLED', async () => {
        mockedListCompanyPaymentMethods.mockResolvedValue([
          { id: 'bank_transfer', label: 'Bank transfer', fields: [], enabled: false, config: {} },
        ]);
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);

        await expect(transport.send(CTX)).rejects.toThrow(/no payment method configured/);
      });
    });

    // THE INVOICE NUMBER LENGTH GATE (this file's own header) — REGRESSION for the real 2026-09-14
    // rejection (`flux CPP0011117000000000425899`, "ne doit pas depasser 20 caracteres").
    describe('THE INVOICE NUMBER LENGTH GATE', () => {
      it('refuses, naming the number, when displayNumber is over 20 characters', async () => {
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);
        const ctx: DocumentTransportContext = {
          ...CTX,
          document: { ...CTX.document, displayNumber: 'INV-CPR-1789417592601' }, // 21 chars
        };

        await expect(transport.send(ctx)).rejects.toThrow(BadRequestException);
        await expect(transport.send(ctx)).rejects.toThrow(/INV-CPR-1789417592601/);
        await expect(transport.send(ctx)).rejects.toThrow(/20 characters/);
        expect(mockDeposerFlux).not.toHaveBeenCalled();
        // Never even reaches the DB — see this file's own "checked FIRST" comment.
        expect(mockedPrisma.company.findUnique).not.toHaveBeenCalled();
      });

      it('refuses when displayNumber carries a character Chorus Pro does not allow (e.g. ".")', async () => {
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);
        const ctx: DocumentTransportContext = {
          ...CTX,
          document: { ...CTX.document, displayNumber: 'INV.2026.0001' },
        };

        await expect(transport.send(ctx)).rejects.toThrow(BadRequestException);
        await expect(transport.send(ctx)).rejects.toThrow(/20 characters/);
      });

      it('accepts a displayNumber at the exact 20-character boundary, with every allowed special character', async () => {
        mockDeposerFlux.mockResolvedValue({
          numeroFluxDepot: '375037',
          statut: 'DEPOSE',
          httpStatus: 200,
          raw: {},
        });
        const deps = buildDeps();
        const transport = buildChorusProTransport(deps);
        const ctx: DocumentTransportContext = {
          ...CTX,
          document: { ...CTX.document, displayNumber: 'IN V-2026+A_B/000001' }, // exactly 20 chars
        };

        await expect(transport.send(ctx)).resolves.toMatchObject({ reference: '375037' });
      });
    });

    // MUTATION GUARD #2 — "the transport skips the facturx gate" — this test fails the instant
    // `send()` stops checking `buildResult.validation.valid` before depositing: an artifact that
    // failed the EN 16931 Schematron gate must NEVER reach `deposerFlux`, only be refused, named.
    it('MUTATION GUARD #2 — never deposits an artifact that failed the Factur-X/EN 16931 gate', async () => {
      const build = vi.fn().mockResolvedValue({
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
        // IN_DP_E2_CII_FACTURX, not IN_DP_E3_FACTUR_X_10 — see choruspro-client.ts's own header,
        // "CORRECTED 2026-09-14 (second correction, same day)": the old value was never a member of
        // the Swagger's own `DeposerFluxFactureParam.syntaxeFlux` enum.
        'IN_DP_E2_CII_FACTURX',
      );
    });

    // MUTATION GUARD #1 — "empty deposit id accepted" — the hard-success
    // contract (documentation/docs/developer-guide/live-testing.md): an accepted deposit with an EMPTY numeroFluxDepot must be a
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
