/**
 * `buildFaceStatusPoller` in isolation — `FaceClient` is mocked wholesale (a real FACe round-trip
 * needs a FACe-registered certificate this checkout does not have and a WS-Security signature this
 * codebase does not implement — see `transports/face/face-client.ts`'s own header, and this poller's
 * own header for the honesty note on what `consultarFactura`'s response shape is NOT independently
 * live-verified against). Same shape `chorus-pro-status-poller.spec.ts` already establishes.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { ChannelNotConnectedError } from '../authority-status-poller';
import { buildFaceStatusPoller } from './face-status-poller';

const mockConsultarFactura = jest.fn();

jest.mock('../../transports/face/face-client', () => {
  const actual = jest.requireActual('../../transports/face/face-client');
  return {
    ...actual,
    FaceClient: jest.fn().mockImplementation(() => ({ consultarFactura: mockConsultarFactura })),
  };
});

const CONNECTED_CONFIG = {
  providerId: 'face',
  channel: 'FACE',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    certificate: Buffer.from('fake-pfx').toString('base64'),
    certificatePassword: 'x',
    notificationEmail: 'facturacion@empresa.es',
  },
};

function buildChannelCredentials(resolveActive = jest.fn().mockResolvedValue(CONNECTED_CONFIG)) {
  return { resolveActive } as unknown as ChannelCredentialsService;
}

describe('buildFaceStatusPoller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws ChannelNotConnectedError when no FACe channel is connected', async () => {
    const poller = buildFaceStatusPoller({
      channelCredentials: buildChannelCredentials(jest.fn().mockResolvedValue(null)),
    });
    await expect(poller.poll('company-1', '2026/000001')).rejects.toBeInstanceOf(ChannelNotConnectedError);
    expect(mockConsultarFactura).not.toHaveBeenCalled();
  });

  it('maps a PENDING tramitacion (1200 Registrada) into one event, not terminal, no reason', async () => {
    mockConsultarFactura.mockResolvedValue({
      codigo: '0',
      descripcion: '',
      numeroRegistro: '2026/000001',
      tramitacion: { codigo: '1200', descripcion: 'Registrada' },
      anulacion: { codigo: '4100', descripcion: 'No solicita anulación' },
    });
    const poller = buildFaceStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '2026/000001');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ statusCode: '1200', reason: undefined });
    expect(poller.isTerminal(events[0].statusCode)).toBe(false);
    expect(mockConsultarFactura).toHaveBeenCalledWith('2026/000001');
  });

  it('maps a CLEARED tramitacion (2400 Contabilizada) into a terminal event, no reason', async () => {
    mockConsultarFactura.mockResolvedValue({
      codigo: '0',
      descripcion: '',
      numeroRegistro: '2026/000001',
      tramitacion: { codigo: '2400', descripcion: 'Contabilizada' },
    });
    const poller = buildFaceStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '2026/000001');

    expect(events[0].reason).toBeUndefined();
    expect(poller.isTerminal('2400')).toBe(true);
  });

  it('maps a REJECTED tramitacion (2600 Rechazada) into a terminal event, carrying a reason', async () => {
    mockConsultarFactura.mockResolvedValue({
      codigo: '0',
      descripcion: '',
      numeroRegistro: '2026/000001',
      tramitacion: { codigo: '2600', descripcion: 'Rechazada' },
    });
    const poller = buildFaceStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '2026/000001');

    expect(events[0].statusCode).toBe('2600');
    expect(events[0].reason).toContain('2600');
    expect(poller.isTerminal('2600')).toBe(true);
  });

  it('keeps the raw payload verbatim', async () => {
    const raw = {
      codigo: '0',
      numeroRegistro: '2026/000001',
      tramitacion: { codigo: '1300', descripcion: 'Registrada en RCF' },
    };
    mockConsultarFactura.mockResolvedValue(raw);
    const poller = buildFaceStatusPoller({ channelCredentials: buildChannelCredentials() });

    const events = await poller.poll('company-1', '2026/000001');

    expect(events[0].rawPayload).toEqual(raw);
  });
});
