/**
 * `buildChorusProStatusPoller` in isolation — `ChorusProClient` is mocked wholesale (the real PISTE
 * round-trip is `chorus-pro/choruspro.live.spec.ts`'s job — proven live in qualification 2026-09-14,
 * see that file's own header, and this poller's own header for the honesty note on the ONE thing that
 * round-trip surfaced as actually wrong: `mapChorusProStatus`'s value vocabulary).
 */
import { vi, type Mock } from 'vitest';

import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError } from '../authority-status-poller';
import { buildChorusProStatusPoller } from './chorus-pro-status-poller';

const mockConsulterCr = vi.fn();

vi.mock('../../transports/chorus-pro/choruspro-client', async () => {
  const actual = await vi.importActual('../../transports/chorus-pro/choruspro-client');
  return {
    ...actual,
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new ChorusProClient(...)` under Vitest (Jest's own mock never actually invoked [[Construct]], so an arrow function silently "worked" there).
    ChorusProClient: vi.fn().mockImplementation(function () {
      return { consulterCr: mockConsulterCr };
    }),
  };
});

// Explicit factory mock (not automock): lets the UNKNOWN-status test below assert `logger.error` was
// actually called, without a real Prisma write attempt — the same "mock the singleton, assert on it"
// approach this module's OWN production code (`poll()`'s `logger.error` call) is meant to be caught by.
vi.mock('@/logger/logger.service', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const mockLoggerError = logger.error as Mock;

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

function buildChannelCredentials(resolveActive = vi.fn().mockResolvedValue(CONNECTED_CONFIG)) {
  return { resolveActive } as unknown as ChannelCredentialsService;
}

describe('buildChorusProStatusPoller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps a PENDING statutFlux (EN_COURS_DE_TRAITEMENT) into one event, not terminal, no reason', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'EN_COURS_DE_TRAITEMENT',
      raw: { numeroFluxDepot: '375037', statutFlux: 'EN_COURS_DE_TRAITEMENT' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '375037');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ statusCode: 'EN_COURS_DE_TRAITEMENT', reason: undefined });
    expect(poller.isTerminal(events[0].statusCode)).toBe(false);
  });

  it('maps a CLEARED statutFlux (VALIDE) into a terminal event, no reason', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'VALIDE',
      raw: { numeroFluxDepot: '375037', statutFlux: 'VALIDE' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '375037');

    expect(events[0]).toMatchObject({ statusCode: 'VALIDE', reason: undefined });
    expect(poller.isTerminal('VALIDE')).toBe(true);
  });

  it('maps a REJECTED statutFlux (REJETE) with no structured errors into a terminal event, falling back to the statutFlux itself as reason', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'REJETE',
      raw: { numeroFluxDepot: '375037', statutFlux: 'REJETE' },
      // No erreursDP/erreursTechniques — a mocked client predating those fields (or a real response
      // that genuinely carries none) must not crash `poll()`'s own `?? []` guard.
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '375037');

    expect(events[0]).toMatchObject({ statusCode: 'REJETE', reason: 'REJETE' });
    expect(poller.isTerminal('REJETE')).toBe(true);
  });

  it("prefers consulterCRDetaille's own structured errors over the bare status code for a REJECTED reason", async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'REJETE',
      erreursDP: [{ numeroDP: 'DP1', libelleErreurDP: 'Destinataire inconnu' }],
      erreursTechniques: [{ codeErreur: 'E01', libelleErreur: 'Flux irrecevable' }],
      raw: {},
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '375037');

    expect(events[0].statusCode).toBe('REJETE');
    expect(events[0].reason).toBe('Flux irrecevable; Destinataire inconnu');
  });

  it('keeps the raw payload verbatim', async () => {
    const raw = { numeroFluxDepot: '42', statutFlux: 'MISE_EN_PAIEMENT', extra: 'field' };
    mockConsulterCr.mockResolvedValue({ numeroFluxDepot: '42', statutFlux: 'MISE_EN_PAIEMENT', raw });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '42');
    expect(events[0].rawPayload).toEqual(raw);
  });

  // ---------------------------------------------------------------------------------------------
  // The three REAL, `IN_`-prefixed statutFlux values live-measured against the PISTE sandbox,
  // 2026-09-14 (see `mapChorusProStatus`'s own doc comment for the full provenance). Every assertion
  // in this block FAILS on the pre-fix `mapChorusProStatus` table, where all three fell through to
  // PENDING — a real rejection silently read as pending forever, a real terminal success never read
  // as CLEARED.
  // ---------------------------------------------------------------------------------------------

  it('maps IN_INTEGRE (real terminal accepted state, CPP0011117000000000425903) into a terminal CLEARED event, no reason, no unknown-status log', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: 'CPP0011117000000000425903',
      statutFlux: 'IN_INTEGRE',
      erreursDP: [],
      erreursTechniques: [],
      raw: { etatCourantDepotFlux: 'IN_INTEGRE' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'CPP0011117000000000425903');

    expect(events[0]).toMatchObject({ statusCode: 'IN_INTEGRE', reason: undefined });
    expect(poller.isTerminal('IN_INTEGRE')).toBe(true);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('maps IN_REJETE (real rejection, CPP0011117000000000425895) into a terminal REJECTED event, falling back to the statutFlux itself when no structured errors are attached', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: 'CPP0011117000000000425895',
      statutFlux: 'IN_REJETE',
      erreursDP: [],
      erreursTechniques: [],
      raw: { etatCourantDepotFlux: 'IN_REJETE' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'CPP0011117000000000425895');

    expect(events[0]).toMatchObject({ statusCode: 'IN_REJETE', reason: 'IN_REJETE' });
    expect(poller.isTerminal('IN_REJETE')).toBe(true);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('maps IN_REJETE with structured errors into a terminal REJECTED event whose reason names the actual cause', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: 'CPP0011117000000000425895',
      statutFlux: 'IN_REJETE',
      erreursDP: [{ numeroDP: 'DP1', libelleErreurDP: 'IBAN du fournisseur manquant' }],
      erreursTechniques: [{ codeErreur: 'E01', libelleErreur: 'Cadre de facturation invalide' }],
      raw: { etatCourantDepotFlux: 'IN_REJETE' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'CPP0011117000000000425895');

    expect(events[0].statusCode).toBe('IN_REJETE');
    expect(events[0].reason).toBe('Cadre de facturation invalide; IBAN du fournisseur manquant');
    expect(poller.isTerminal('IN_REJETE')).toBe(true);
  });

  it('maps IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP (observed immediately after every deposit) into a non-terminal event, no reason, no unknown-status log', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: 'CPP0011117000000000425899',
      statutFlux: 'IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP',
      erreursDP: [],
      erreursTechniques: [],
      raw: { etatCourantDepotFlux: 'IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', 'CPP0011117000000000425899');

    expect(events[0]).toMatchObject({
      statusCode: 'IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP',
      reason: undefined,
    });
    expect(poller.isTerminal('IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP')).toBe(false);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('logs an unrecognized statutFlux, persisted, via LoggerService — the event itself stays non-terminal, never silently PENDING', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET',
      erreursDP: [],
      erreursTechniques: [],
      raw: { etatCourantDepotFlux: 'IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-9', '375037');

    // The raw statusCode is still journaled verbatim (dedup/visibility at the DB level) — this
    // function never invents a fallback value, only a persisted log is added on top.
    expect(events[0].statusCode).toBe('IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET');
    expect(poller.isTerminal('IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET')).toBe(false);

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [message, options] = mockLoggerError.mock.calls[0];
    expect(message).toContain('IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET');
    expect(options).toMatchObject({
      category: 'documents',
      details: expect.objectContaining({
        companyId: 'company-9',
        providerId: 'chorus-pro',
        transportRef: '375037',
        statutFlux: 'IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET',
      }),
    });
  });

  // The measured defect this de-dup fixes: a poller retried every 60s over a multi-day give-up
  // window used to write ONE `Log` row per pass for as long as the SAME unrecognized status kept
  // coming back — on the order of ten thousand near-identical rows for a single deposit.
  it('never re-logs the SAME unrecognized statutFlux for the SAME deposit across repeated polls', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET',
      erreursDP: [],
      erreursTechniques: [],
      raw: {},
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    await poller.poll('company-9', '375037');
    await poller.poll('company-9', '375037');
    await poller.poll('company-9', '375037');

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it('logs AGAIN when the unrecognized statutFlux for the SAME deposit changes to a different one', async () => {
    mockConsulterCr.mockResolvedValueOnce({
      numeroFluxDepot: '375037',
      statutFlux: 'IN_UNKNOWN_ONE',
      erreursDP: [],
      erreursTechniques: [],
      raw: {},
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });
    await poller.poll('company-9', '375037');

    mockConsulterCr.mockResolvedValueOnce({
      numeroFluxDepot: '375037',
      statutFlux: 'IN_UNKNOWN_TWO',
      erreursDP: [],
      erreursTechniques: [],
      raw: {},
    });
    await poller.poll('company-9', '375037');

    expect(mockLoggerError).toHaveBeenCalledTimes(2);
    expect(mockLoggerError.mock.calls[1][0]).toContain('IN_UNKNOWN_TWO');
  });

  it('de-dup is scoped PER DEPOSIT — a different transportRef with the same unrecognized status still logs', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: 'x',
      statutFlux: 'IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET',
      erreursDP: [],
      erreursTechniques: [],
      raw: {},
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    await poller.poll('company-9', '375037');
    await poller.poll('company-9', '999999'); // a DIFFERENT deposit, first sighting for IT

    expect(mockLoggerError).toHaveBeenCalledTimes(2);
  });

  it('throws ChannelNotConnectedError when chorus-pro has no connected credentials for this company', async () => {
    const poller = buildChorusProStatusPoller({
      channelCredentials: buildChannelCredentials(vi.fn().mockResolvedValue(null)),
    });
    await expect(poller.poll('company-1', '375037')).rejects.toBeInstanceOf(ChannelNotConnectedError);
    expect(mockConsulterCr).not.toHaveBeenCalled(); // never even reaches the network call
  });

  it('throws ChannelNotConnectedError for an incomplete config too (e.g. missing technicalAccountPassword)', async () => {
    const incomplete = {
      ...CONNECTED_CONFIG,
      config: {
        clientId: 'piste-id-1',
        clientSecret: 'piste-secret-1',
        technicalAccountLogin: 'TECH_1_abcdef@cpro.fr',
      },
    };
    const poller = buildChorusProStatusPoller({
      channelCredentials: buildChannelCredentials(vi.fn().mockResolvedValue(incomplete)),
    });
    await expect(poller.poll('company-1', '375037')).rejects.toBeInstanceOf(ChannelNotConnectedError);
  });

  describe('isTerminal', () => {
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    it('every CLEARED/REJECTED status is terminal — bare vocabulary and the real IN_-prefixed one alike', () => {
      expect(poller.isTerminal('VALIDE')).toBe(true);
      expect(poller.isTerminal('MISE_EN_PAIEMENT')).toBe(true);
      expect(poller.isTerminal('MANDATEE')).toBe(true);
      expect(poller.isTerminal('COMPTABILISEE')).toBe(true);
      expect(poller.isTerminal('REJETE')).toBe(true);
      expect(poller.isTerminal('IN_INTEGRE')).toBe(true);
      expect(poller.isTerminal('IN_REJETE')).toBe(true);
    });

    it('every PENDING/unknown status is NOT terminal — bare, IN_-prefixed pending, and unrecognized alike', () => {
      expect(poller.isTerminal('DEPOSE')).toBe(false);
      expect(poller.isTerminal('EN_COURS_DE_TRAITEMENT')).toBe(false);
      expect(poller.isTerminal('SUSPENDU')).toBe(false);
      expect(poller.isTerminal('IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP')).toBe(false);
      expect(poller.isTerminal('poll:blocked')).toBe(false);
      // UNKNOWN (never recognized by mapChorusProStatus) has no more basis to be read as terminal
      // than a genuinely PENDING code does — see `mapChorusProStatus`'s own doc comment.
      expect(poller.isTerminal('IN_SOME_FUTURE_STATE_NOBODY_HAS_SEEN_YET')).toBe(false);
    });
  });
});
