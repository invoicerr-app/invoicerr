/**
 * ChannelCredentialsService in isolation — national transports (`transports nationaux`). Mocks
 * `@/prisma/prisma.service` at its own entry point (the same discipline `company-transport.spec.ts`
 * already holds), so this proves the SERVICE's own logic (encryption round-trip, what a GET is and
 * is not allowed to carry, the "at most one active environment" invariant) — never a real database.
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is set here, in-process, to a FIXED test value — the same pattern the
 * removed compliance engine's own `pdp-live.spec.ts` used
 * (`process.env.CREDENTIALS_ENCRYPTION_KEY ??= '...'`): this is
 * `utils/secret-crypto.ts`'s real AES-256-GCM, exercised for real, never mocked away.
 */

import { vi, type Mock } from 'vitest';

process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { resolveB2gRoutingRule } from '@/modules/documents/b2g-routing/b2g-routing';
import { encryptJson } from '@/utils/secret-crypto';
import { ChannelEnvironment } from '../../../../prisma/generated/prisma/client';
import { ChannelCredentialsService } from './channels.service';

// Issue #527 - `legalChannels()`'s own "automatic" flag reads the DATABASE-backed B2G routing rule
// (`b2g-routing.ts#resolveB2gRoutingRule`), never the in-memory catalog `boot-upsert.ts` alone
// consults (see that module's own header) - mocked WHOLESALE here, the same convention
// `actions/invoice-channel-mandate.spec.ts` already holds for `channel-policy/mandate.ts`.
vi.mock('@/modules/documents/b2g-routing/b2g-routing', () => ({
  resolveB2gRoutingRule: vi.fn(),
}));
const mockedResolveB2gRoutingRule = resolveB2gRoutingRule as unknown as Mock;

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companyChannelConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    company: { findUnique: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  companyChannelConfig: {
    findUnique: Mock;
    findMany: Mock;
    upsert: Mock;
    update: Mock;
    updateMany: Mock;
    deleteMany: Mock;
  };
  company: { findUnique: Mock };
};

describe('ChannelCredentialsService', () => {
  let service: ChannelCredentialsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveB2gRoutingRule.mockResolvedValue(undefined);
    service = new ChannelCredentialsService();
  });

  describe('upsertChannelConfig → resolve — the encryption round-trip', () => {
    it('encrypts on write, decrypts back to the EXACT same config on resolve()', async () => {
      const plainConfig = {
        baseUrl: 'https://api.superpdp.tech',
        clientId: 'id-1',
        clientSecret: 'shh-secret',
      };
      let storedEncrypted = '';

      mockedPrisma.companyChannelConfig.updateMany.mockResolvedValue({ count: 0 });
      mockedPrisma.companyChannelConfig.upsert.mockImplementation(async ({ create }) => {
        storedEncrypted = create.config;
        return {
          id: 'row-1',
          companyId: 'company-1',
          channel: create.channel,
          providerId: create.providerId,
          environment: create.environment,
          config: create.config,
          isActive: create.isActive,
        };
      });

      const status = await service.upsertChannelConfig('company-1', 'pdp', { config: plainConfig });

      // The RETURN VALUE of upsert is status-only — see the next describe block for the dedicated
      // proof; asserted again here in passing because a round-trip test that leaked the secret in
      // its own immediate response would be trivially misleading.
      expect(status).toEqual({
        providerId: 'pdp',
        channel: 'PDP',
        environment: ChannelEnvironment.TEST,
        isActive: true,
      });

      // What actually reached Prisma is CIPHERTEXT, never the plaintext secret verbatim.
      expect(storedEncrypted).not.toContain('shh-secret');
      expect(storedEncrypted).not.toEqual(JSON.stringify(plainConfig));

      // resolve() reads that SAME ciphertext back and decrypts it to the exact original object.
      mockedPrisma.companyChannelConfig.findUnique.mockResolvedValue({
        id: 'row-1',
        companyId: 'company-1',
        channel: 'PDP',
        providerId: 'pdp',
        environment: ChannelEnvironment.TEST,
        config: storedEncrypted,
        isActive: true,
      });

      const resolved = await service.resolve('company-1', 'pdp', 'TEST');
      expect(resolved).toEqual({
        providerId: 'pdp',
        channel: 'PDP',
        environment: ChannelEnvironment.TEST,
        config: plainConfig,
        isActive: true,
      });
    });

    it('resolve() returns null — never throws — for a row nobody ever created', async () => {
      mockedPrisma.companyChannelConfig.findUnique.mockResolvedValue(null);
      await expect(service.resolve('company-1', 'pdp', 'TEST')).resolves.toBeNull();
    });

    it('resolve() returns null for an INACTIVE row — a disconnect must never resolve', async () => {
      mockedPrisma.companyChannelConfig.findUnique.mockResolvedValue({
        id: 'row-1',
        companyId: 'company-1',
        channel: 'PDP',
        providerId: 'pdp',
        environment: ChannelEnvironment.TEST,
        config: 'irrelevant',
        isActive: false,
      });
      await expect(service.resolve('company-1', 'pdp', 'TEST')).resolves.toBeNull();
    });

    it('resolve()/resolveActive() are unavailable (not a crash) when the encryption key is absent', async () => {
      const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        await expect(service.resolve('company-1', 'pdp', 'TEST')).resolves.toBeNull();
        await expect(service.resolveActive('company-1', 'pdp')).resolves.toBeNull();
        expect(mockedPrisma.companyChannelConfig.findUnique).not.toHaveBeenCalled();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    });
  });

  describe('resolveActive() — "exactly one active environment" invariant', () => {
    it('returns null when nothing is active', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([]);
      await expect(service.resolveActive('company-1', 'pdp')).resolves.toBeNull();
    });

    it('refuses (null, never a guess) when more than one environment is somehow active at once', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'a',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: 'TEST',
          config: '{}',
          isActive: true,
        },
        {
          id: 'b',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: 'PROD',
          config: '{}',
          isActive: true,
        },
      ]);
      await expect(service.resolveActive('company-1', 'pdp')).resolves.toBeNull();
    });

    it('upsertChannelConfig deactivates any OTHER environment when activating a new one — never two active', async () => {
      mockedPrisma.companyChannelConfig.updateMany.mockResolvedValue({ count: 1 });
      mockedPrisma.companyChannelConfig.upsert.mockResolvedValue({
        id: 'row-2',
        companyId: 'company-1',
        channel: 'PDP',
        providerId: 'pdp',
        environment: ChannelEnvironment.PROD,
        config: 'cipher',
        isActive: true,
      });

      await service.upsertChannelConfig('company-1', 'pdp', {
        environment: 'PROD',
        config: { baseUrl: 'x', clientId: 'y', clientSecret: 'z' },
      });

      expect(mockedPrisma.companyChannelConfig.updateMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          providerId: 'pdp',
          environment: { not: ChannelEnvironment.PROD },
          isActive: true,
        },
        data: { isActive: false },
      });
    });
  });

  describe('listCompanyChannels() — the GET the settings screen calls: STATUS ONLY', () => {
    it('never returns a "config" field, and never contains the secret value anywhere in its output', async () => {
      const secretMarker = 'THIS-MUST-NEVER-LEAK-be3f9c';
      const encrypted = encryptJson({
        baseUrl: 'https://api.superpdp.tech',
        clientId: 'id-1',
        clientSecret: secretMarker,
      });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: ChannelEnvironment.TEST,
          config: encrypted,
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');

      expect(rows).toEqual([
        {
          providerId: 'pdp',
          channel: 'PDP',
          environment: ChannelEnvironment.TEST,
          isActive: true,
          // Issue #526 - "pdp" resolves to its one catalogued operator (SuperPDP) WITHOUT ever
          // decrypting `config` (see `resolveOperatorId`'s own header): a single candidate answers
          // unconditionally.
          operatorId: 'superpdp',
        },
      ]);
      for (const row of rows) {
        expect(Object.keys(row)).not.toContain('config');
      }
      // THE MUTATION PROOF: if this method were changed to decrypt and return the
      // blob, this is the assertion that would catch it — the secret must not appear ANYWHERE in the
      // serialized response, not just absent from a named field.
      expect(JSON.stringify(rows)).not.toContain(secretMarker);
      expect(JSON.stringify(rows)).not.toContain(encrypted);
    });

    // Issue #526 - the company's configured operator per channel, resolved server-side.
    it('resolves "operatorId" for a provider with its own dedicated transport (no ambiguity, no decrypt needed)', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'ACUBE',
          providerId: 'acube',
          environment: ChannelEnvironment.TEST,
          config: encryptJson({ email: 'a@b.com', password: 'x' }),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].operatorId).toBe('acube');
    });

    it('resolves "operatorId" to null for a provider this catalogue has no operator for', async () => {
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'EMAIL',
          providerId: 'email',
          environment: ChannelEnvironment.TEST,
          config: encryptJson({}),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].operatorId).toBeNull();
    });
  });

  describe('suggestedChannels() — reads the country file, never a hard-coded country check', () => {
    // France now MANDATES pdp (channel-policy/data/fr.json, mandatedFrom
    // 2026-09-01), not merely suggests it: this is the real, shipped shape, not a fixture, so the
    // test proves the SERVICE hands the mandate fields straight through, unmassaged.
    it("a French company's channel policy is pdp, MANDATED from 2026-09-01, with legal provenance", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      const facts = await service.suggestedChannels('company-1');
      expect(facts).toEqual([
        expect.objectContaining({
          providerId: 'pdp',
          requirement: 'mandated',
          mandatedFrom: '2026-09-01',
          provenance: expect.objectContaining({ kind: 'legal' }),
        }),
      ]);
    });

    it("a Polish company's channel policy is ksef, still merely SUGGESTED (no sourced mandate date yet)", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Poland', countryCode: 'PL' });
      const facts = await service.suggestedChannels('company-1');
      expect(facts).toEqual([
        expect.objectContaining({ providerId: 'ksef', requirement: 'suggested', effectiveNow: undefined }),
      ]);
    });

    it('a company whose country has no policy file gets an empty list, not a guess', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'United States', countryCode: 'US' });
      await expect(service.suggestedChannels('company-1')).resolves.toEqual([]);
    });
  });

  // "Declaration" — a NEW, categorically different concept from `suggestedChannels`
  // above: never a transport hint, always "declare this invoice's data to this authority". Reads
  // `documents/reporting/data/*.json`, the real, shipped files, not a fixture.
  describe('reportingObligations() — reads the country file, never a hard-coded country check', () => {
    // HU ("nav") and GR ("mydata") were the only two countries this mechanism ever shipped a
    // reporting obligation for — both removed by the 5-country prune (2026-09-10): the shipped
    // catalog is now honestly EMPTY (reporting/data/all.spec.ts's own
    // pin). Re-anchored here (not deleted) on that same fact, so this still proves the SERVICE reads
    // the real (now-empty) catalog rather than a hard-coded guess.
    it('a Hungarian or Greek company has no reporting obligation any more — the shipped catalog is now empty', async () => {
      for (const [country, countryCode] of [
        ['Hungary', 'HU'],
        ['Greece', 'GR'],
      ] as const) {
        mockedPrisma.company.findUnique.mockResolvedValue({ country, countryCode });
        await expect(service.reportingObligations('company-1')).resolves.toEqual([]);
      }
    });

    // reporting/data/fr.json now ships three facts (CGI art. 289 E, transport-discharged; two
    // scoped, unverified art. 290/290 A e-reporting facts) — `reportingObligations` returns
    // `factsFor()` UNFILTERED (unlike `list-declarations.ts#declarationProviderIds`, which narrows to
    // `dischargedBy === 'provider'` for the DB query), so all three now surface here. This is the
    // settings-screen read, never the send-time auto-trigger (`registry.ts#obligationFor` still
    // excludes the transport fact and both scoped facts — see that file's own header).
    it("a French company's reporting obligations reflect the real fr.json facts — not a hard-coded empty guess", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      const facts = await service.reportingObligations('company-1');
      expect(facts).toEqual([
        expect.objectContaining({
          providerId: 'pdp',
          appliesTo: 'invoice',
          provenance: expect.objectContaining({ kind: 'legal' }),
        }),
        expect.objectContaining({
          providerId: 'fr-ereporting',
          appliesTo: 'invoice',
          provenance: expect.objectContaining({ kind: 'unverified' }),
        }),
        expect.objectContaining({
          providerId: 'fr-ereporting',
          appliesTo: 'invoice',
          provenance: expect.objectContaining({ kind: 'unverified' }),
        }),
      ]);
    });
  });

  describe('deleteChannelConfig() — disconnect', () => {
    it('reports deleted:true when a row actually existed', async () => {
      mockedPrisma.companyChannelConfig.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.deleteChannelConfig('company-1', 'pdp')).resolves.toEqual({ deleted: true });
    });

    it('reports deleted:false — not an error — when there was nothing to disconnect', async () => {
      mockedPrisma.companyChannelConfig.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteChannelConfig('company-1', 'pdp')).resolves.toEqual({ deleted: false });
    });
  });

  describe('upsertChannelConfig() — encryption unavailable', () => {
    it('throws ServiceUnavailableException rather than saving a secret in the clear', async () => {
      const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        await expect(
          service.upsertChannelConfig('company-1', 'pdp', { config: { clientSecret: 'x' } }),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(mockedPrisma.companyChannelConfig.upsert).not.toHaveBeenCalled();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    });
  });

  // Issue #527 - the settings screen's level-1 nav (design C) + banner (design A). Reads the REAL,
  // shipped catalogs (channel-policy, operators, b2g-routing), the same "not a fixture" discipline
  // `suggestedChannels()`'s own tests above already hold.
  describe('legalChannels() - the settings screen level-1 nav + banner verdict', () => {
    it('discovers exactly the DELIVERY legal channels (excludes the pt-at declaration, which never emits)', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Germany', countryCode: 'DE' });
      const { channels } = await service.legalChannels('company-1');
      // "peppol" IS included: Billit's own Belgian offering has capabilities.emit: true (it runs
      // through the same wired "billit" transport as Billit's own French "pdp" offering - see
      // `operators/data/billit.json`) - a genuinely connectable legal channel, even though no
      // shipped `channel-policy/data/*.json` file names Belgium today (so it is "outside your
      // invoicing country" for every company this catalogue currently covers - see the next test).
      expect(channels.map((c) => c.id)).toEqual(['chorus-pro', 'ksef', 'pdp', 'peppol', 'sdi']);
    });

    it("a French company: pdp is MANDATED and lawful, chorus-pro is AUTOMATIC (b2g) and lawful, sdi is locked and says it is Italy's own mandate", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      mockedResolveB2gRoutingRule.mockResolvedValue({ transportId: 'chorus-pro' });

      const { banner, channels } = await service.legalChannels('company-1');

      expect(banner).toEqual(
        expect.objectContaining({
          countryCode: 'FR',
          tone: 'mandated',
          legalChannelId: 'pdp',
          mandatedFrom: '2026-09-01',
        }),
      );

      const byId = Object.fromEntries(channels.map((c) => [c.id, c]));
      expect(byId.pdp).toEqual(
        expect.objectContaining({
          requirement: 'mandated',
          mandatedFrom: '2026-09-01',
          automatic: false,
          lawful: true,
        }),
      );
      expect(byId['chorus-pro']).toEqual(
        expect.objectContaining({ requirement: undefined, automatic: true, lawful: true }),
      );
      expect(byId.sdi).toEqual(
        expect.objectContaining({
          requirement: undefined,
          automatic: false,
          lawful: false,
          mandatedElsewhere: [{ countryCode: 'IT', requirement: 'mandated' }],
        }),
      );
      expect(byId.ksef).toEqual(
        expect.objectContaining({
          lawful: false,
          mandatedElsewhere: [{ countryCode: 'PL', requirement: 'suggested' }],
        }),
      );
    });

    it('a German company: no legal channel is home, banner tone is "none" (facts: [], never an empty screen)', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Germany', countryCode: 'DE' });

      const { banner, channels } = await service.legalChannels('company-1');

      expect(banner).toEqual(
        expect.objectContaining({ countryCode: 'DE', tone: 'none', legalChannelId: undefined }),
      );
      const byId = Object.fromEntries(channels.map((c) => [c.id, c]));
      // Owner review of #527 - Germany enforces NO domestic mandate at all, so a channel no OTHER
      // country's law claims either (Peppol: no channel-policy fact, no B2G-routing fact anywhere)
      // is genuinely lawful - nothing forces a different one. pdp/sdi/ksef stay locked (each is
      // another specific country's own mandate/suggestion); chorus-pro stays locked too (it is
      // FRANCE's own automatic B2G portal, found via the b2g-routing cross-index, even though it
      // carries no channel-policy fact at all).
      expect(byId.peppol.lawful).toBe(true);
      expect(byId.pdp.lawful).toBe(false);
      expect(byId.sdi.lawful).toBe(false);
      expect(byId.ksef.lawful).toBe(false);
      expect(byId['chorus-pro'].lawful).toBe(false);

      // Owner review of #527, second instance of the same bug class the Peppol wording fix targets:
      // chorus-pro carries no channel-policy fact anywhere (`mandatedElsewhere` is empty for it from
      // EVERY viewer), so the frontend could not tell "France's own automatic B2G portal" apart from
      // a genuinely homeless cross-border network without this field - it must name FR here, exactly
      // like `mandatedElsewhere` already does for sdi/ksef above, so the settings screen keeps saying
      // "outside your invoicing country" for chorus-pro (correct) rather than switching to the new
      // "not accepted for your domestic invoices" wording (which would be wrong: chorus-pro is not a
      // cross-border network, it is specifically France's own portal).
      expect(byId['chorus-pro'].mandatedElsewhere).toEqual([]);
      expect(byId['chorus-pro'].automaticElsewhere).toEqual(['FR']);
      // Peppol has neither a channel-policy fact NOR a b2g-routing fact anywhere - genuinely homeless.
      expect(byId.peppol.mandatedElsewhere).toEqual([]);
      expect(byId.peppol.automaticElsewhere).toEqual([]);
    });

    it('a Polish company: ksef is home and SUGGESTED (not mandated - the mandate schema cannot express the real threshold/allowance calendar), still lawful (usable) at the settings level', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Poland', countryCode: 'PL' });

      const { banner, channels } = await service.legalChannels('company-1');

      expect(banner).toEqual(
        expect.objectContaining({ countryCode: 'PL', tone: 'suggested', legalChannelId: 'ksef' }),
      );
      const ksef = channels.find((c) => c.id === 'ksef');
      expect(ksef).toEqual(expect.objectContaining({ requirement: 'suggested', lawful: true }));

      // A merely-SUGGESTED fact is not an active mandate (`hasDomesticMandate` stays false) - so
      // Peppol (no country's own home anywhere) reads lawful here too, same as it would for Germany.
      const peppol = channels.find((c) => c.id === 'peppol');
      expect(peppol?.lawful).toBe(true);
    });

    it("a French company: PDP (this country's own mandate) is listed FIRST, chorus-pro (automatic) right after it - never Chorus Pro first (owner review of #527)", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      mockedResolveB2gRoutingRule.mockResolvedValue({ transportId: 'chorus-pro' });

      const { channels } = await service.legalChannels('company-1');

      expect(channels.map((c) => c.id)).toEqual(['pdp', 'chorus-pro', 'ksef', 'peppol', 'sdi']);
    });

    it("an Italian company: SdI (this country's own mandate) is listed FIRST", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Italy', countryCode: 'IT' });

      const { channels } = await service.legalChannels('company-1');

      expect(channels[0].id).toBe('sdi');
    });

    it('a company whose country cannot be resolved gets an honest "none" banner, never a guess', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: '', countryCode: null });
      const { banner } = await service.legalChannels('company-1');
      expect(banner).toEqual({ countryCode: undefined, tone: 'none', legalChannelId: undefined });
    });
  });

  describe('listCompanyChannels() - blockedBySend (issue #527)', () => {
    it("a connected channel that is NOT the country's current mandate is flagged blockedBySend", async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'ACUBE',
          providerId: 'acube',
          environment: ChannelEnvironment.PROD,
          config: encryptJson({ email: 'a@b.com', password: 'x' }),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].blockedBySend).toBe(true);
    });

    it('the mandated channel itself is never flagged blockedBySend', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'PDP',
          providerId: 'pdp',
          environment: ChannelEnvironment.PROD,
          config: encryptJson({ baseUrl: 'https://api.superpdp.tech', clientId: 'x', clientSecret: 'y' }),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].blockedBySend).toBe(false);
    });

    it('a connected operator implementing the SAME legal channel as the mandate (Iopole for "pdp") is never blockedBySend, even though its own transport id differs', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'IOPOLE',
          providerId: 'iopole',
          environment: ChannelEnvironment.PROD,
          config: encryptJson({ clientId: 'x@example.com', clientSecret: 'y', customerId: 'z' }),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].blockedBySend).toBe(false);
    });

    it('a channel this company\'s own B2G routing selects automatically ("chorus-pro" for France) is never blockedBySend, even though it never satisfies the "pdp" mandate either', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      mockedResolveB2gRoutingRule.mockResolvedValue({ transportId: 'chorus-pro' });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'CHORUS-PRO',
          providerId: 'chorus-pro',
          environment: ChannelEnvironment.PROD,
          config: encryptJson({
            clientId: 'x',
            clientSecret: 'y',
            technicalAccountLogin: 'TECH_1_x@cpro.fr',
            technicalAccountPassword: 'z',
          }),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].blockedBySend).toBe(false);
    });

    it('a connected channel for a country with NO active mandate is never flagged blockedBySend', async () => {
      mockedPrisma.company.findUnique.mockResolvedValue({ country: 'Germany', countryCode: 'DE' });
      mockedPrisma.companyChannelConfig.findMany.mockResolvedValue([
        {
          id: 'row-1',
          companyId: 'company-1',
          channel: 'ACUBE',
          providerId: 'acube',
          environment: ChannelEnvironment.PROD,
          config: encryptJson({ email: 'a@b.com', password: 'x' }),
          isActive: true,
        },
      ]);

      const rows = await service.listCompanyChannels('company-1');
      expect(rows[0].blockedBySend).toBeUndefined();
    });
  });
});
