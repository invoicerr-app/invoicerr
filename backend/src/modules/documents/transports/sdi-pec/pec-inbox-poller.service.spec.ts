/**
 * `PecInboxPollerService` against a fully MOCKED `PecInboxPort` and `PecNotificheService` — no IMAP,
 * no mailbox, exactly the "real unit tests against a mocked ... IMAP port" this transport's own
 * engineering constraints require. `imapflow-pec-inbox-port.spec.ts` covers the REAL adapter's own
 * (pure) mapping logic separately.
 */
import { vi, type Mock } from 'vitest';
import { PecInboundMessage, PecInboxPort } from './pec-inbox-port';
import { PecInboxPollerService } from './pec-inbox-poller.service';
import { HandlePecMessageResult, PecNotificheService } from './pec-notifiche.service';

function message(id: string): PecInboundMessage {
  return { id, from: 'sdi07@pec.fatturapa.it', attachments: [] };
}

function buildPort(messages: PecInboundMessage[]): PecInboxPort & { markSeen: Mock } {
  return {
    fetchUnseen: vi.fn().mockResolvedValue(messages),
    markSeen: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PecInboxPollerService.pollOnce', () => {
  it('feeds every fetched message to PecNotificheService, in order, then marks each one seen', async () => {
    const messages = [message('1'), message('2'), message('3')];
    const port = buildPort(messages);
    const handleMessage = vi
      // Vitest's `vi.fn<T>()` generic takes ONE function-type parameter, not Jest's own two-tuple
      // `fn<ReturnType, Args>()` shape.
      .fn<(id: string, message: PecInboundMessage) => Promise<HandlePecMessageResult>>()
      .mockResolvedValue({ handled: true });
    const notifiche = { handleMessage } as unknown as PecNotificheService;

    const poller = new PecInboxPollerService(notifiche);
    const result = await poller.pollOnce('company-1', port);

    expect(result).toEqual({ fetched: 3, handled: 3 });
    expect(handleMessage).toHaveBeenNthCalledWith(1, 'company-1', messages[0]);
    expect(handleMessage).toHaveBeenNthCalledWith(2, 'company-1', messages[1]);
    expect(handleMessage).toHaveBeenNthCalledWith(3, 'company-1', messages[2]);
    expect(port.markSeen).toHaveBeenCalledTimes(3);
    expect(port.markSeen).toHaveBeenCalledWith('1');
    expect(port.markSeen).toHaveBeenCalledWith('2');
    expect(port.markSeen).toHaveBeenCalledWith('3');
  });

  it('counts only messages PecNotificheService actually reports as handled', async () => {
    const messages = [message('1'), message('2')];
    const port = buildPort(messages);
    const handleMessage = vi
      // Vitest's `vi.fn<T>()` generic takes ONE function-type parameter, not Jest's own two-tuple
      // `fn<ReturnType, Args>()` shape.
      .fn<(id: string, message: PecInboundMessage) => Promise<HandlePecMessageResult>>()
      .mockResolvedValueOnce({ handled: true, notificaType: 'RC' })
      .mockResolvedValueOnce({ handled: false });
    const notifiche = { handleMessage } as unknown as PecNotificheService;

    const poller = new PecInboxPollerService(notifiche);
    const result = await poller.pollOnce('company-1', port);

    expect(result).toEqual({ fetched: 2, handled: 1 });
  });

  it('an empty mailbox is a genuine, harmless no-op — never calls handleMessage or markSeen', async () => {
    const port = buildPort([]);
    const handleMessage = vi.fn();
    const notifiche = { handleMessage } as unknown as PecNotificheService;

    const poller = new PecInboxPollerService(notifiche);
    const result = await poller.pollOnce('company-1', port);

    expect(result).toEqual({ fetched: 0, handled: 0 });
    expect(handleMessage).not.toHaveBeenCalled();
    expect(port.markSeen).not.toHaveBeenCalled();
  });

  it(
    'ONE message failing never stops the drain — the rest are still processed and marked seen, the ' +
      'failed one is left unseen for the next poll',
    async () => {
      const messages = [message('1'), message('2'), message('3')];
      const port = buildPort(messages);
      const handleMessage = vi
        .fn<(id: string, message: PecInboundMessage) => Promise<HandlePecMessageResult>>()
        .mockResolvedValueOnce({ handled: true })
        .mockRejectedValueOnce(new Error('database unreachable'))
        .mockResolvedValueOnce({ handled: true });
      const notifiche = { handleMessage } as unknown as PecNotificheService;

      const poller = new PecInboxPollerService(notifiche);
      const result = await poller.pollOnce('company-1', port);

      expect(result).toEqual({ fetched: 3, handled: 2 });
      expect(port.markSeen).toHaveBeenCalledTimes(2);
      expect(port.markSeen).toHaveBeenCalledWith('1');
      expect(port.markSeen).toHaveBeenCalledWith('3');
      expect(port.markSeen).not.toHaveBeenCalledWith('2');
    },
  );
});
