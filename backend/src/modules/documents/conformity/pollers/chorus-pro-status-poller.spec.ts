/**
 * `buildChorusProStatusPoller` in isolation — `ChorusProClient` is mocked wholesale (the real PISTE
 * round-trip is `chorus-pro/choruspro-live.spec.ts`'s job, gated on real PISTE credentials this
 * checkout does not have — see that file's own header, and this poller's own header for the honesty
 * note on what `consulterCr`'s response shape is NOT independently live-verified against).
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError } from '../authority-status-poller';
import { buildChorusProStatusPoller } from './chorus-pro-status-poller';

const mockConsulterCr = jest.fn();

jest.mock('../../transports/chorus-pro/choruspro-client', () => {
  const actual = jest.requireActual('../../transports/chorus-pro/choruspro-client');
  return {
    ...actual,
    ChorusProClient: jest.fn().mockImplementation(() => ({ consulterCr: mockConsulterCr })),
  };
});

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

function buildChannelCredentials(resolveActive = jest.fn().mockResolvedValue(CONNECTED_CONFIG)) {
  return { resolveActive } as unknown as ChannelCredentialsService;
}

describe('buildChorusProStatusPoller', () => {
  beforeEach(() => jest.clearAllMocks());

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

  it('maps a REJECTED statutFlux (REJETE) into a terminal event, carrying the statutFlux as its own reason', async () => {
    mockConsulterCr.mockResolvedValue({
      numeroFluxDepot: '375037',
      statutFlux: 'REJETE',
      raw: { numeroFluxDepot: '375037', statutFlux: 'REJETE' },
    });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '375037');

    expect(events[0]).toMatchObject({ statusCode: 'REJETE', reason: 'REJETE' });
    expect(poller.isTerminal('REJETE')).toBe(true);
  });

  it('keeps the raw payload verbatim', async () => {
    const raw = { numeroFluxDepot: '42', statutFlux: 'MISE_EN_PAIEMENT', extra: 'field' };
    mockConsulterCr.mockResolvedValue({ numeroFluxDepot: '42', statutFlux: 'MISE_EN_PAIEMENT', raw });
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '42');
    expect(events[0].rawPayload).toEqual(raw);
  });

  it('throws ChannelNotConnectedError when chorus-pro has no connected credentials for this company', async () => {
    const poller = buildChorusProStatusPoller({
      channelCredentials: buildChannelCredentials(jest.fn().mockResolvedValue(null)),
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
      channelCredentials: buildChannelCredentials(jest.fn().mockResolvedValue(incomplete)),
    });
    await expect(poller.poll('company-1', '375037')).rejects.toBeInstanceOf(ChannelNotConnectedError);
  });

  describe('isTerminal', () => {
    const poller = buildChorusProStatusPoller({ channelCredentials: buildChannelCredentials() });

    it('every CLEARED/REJECTED status is terminal', () => {
      expect(poller.isTerminal('VALIDE')).toBe(true);
      expect(poller.isTerminal('MISE_EN_PAIEMENT')).toBe(true);
      expect(poller.isTerminal('MANDATEE')).toBe(true);
      expect(poller.isTerminal('COMPTABILISEE')).toBe(true);
      expect(poller.isTerminal('REJETE')).toBe(true);
    });

    it('every PENDING/unknown status is NOT terminal', () => {
      expect(poller.isTerminal('DEPOSE')).toBe(false);
      expect(poller.isTerminal('EN_COURS_DE_TRAITEMENT')).toBe(false);
      expect(poller.isTerminal('SUSPENDU')).toBe(false);
      expect(poller.isTerminal('poll:blocked')).toBe(false);
    });
  });
});
