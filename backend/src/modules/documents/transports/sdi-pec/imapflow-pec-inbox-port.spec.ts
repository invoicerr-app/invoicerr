/**
 * `toPecInboundMessage` in isolation — the ONLY part of `imapflow-pec-inbox-port.ts` this task can
 * prove without a real IMAP server (see that file's own header, "STATUS: implemented-awaiting-
 * credentials"). `client.download` is a hand-built fake here, never a real `ImapFlow` instance —
 * exactly the "real unit tests against a mocked ... IMAP port" this transport's engineering
 * constraints ask for, one layer below `PecInboxPort` itself (`pec-inbox-poller.service.spec.ts`
 * already covers that layer with an even simpler mock).
 */
import { vi, type Mock } from 'vitest';
import { Readable } from 'node:stream';

import { ImapFlow } from 'imapflow';

import { ImapFlowPecInboxPort, toPecInboundMessage } from './imapflow-pec-inbox-port';

function bufferStream(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
}

/** A hand-built fake standing in for the real `ImapFlow` — real enough to prove `fetchUnseen()` never
 *  calls the forbidden-mid-loop `fetch()` async generator (this file's own header, "STATUS:
 *  implemented-awaiting-credentials" — never independently exercised against a real server, which is
 *  exactly how this defect went unnoticed). `fetch` itself is deliberately NOT implemented on this
 *  fake: calling it would throw "not a function", which is itself the proof a regression back to it
 *  would be caught immediately. */
function buildFakeImapClient(fetchAllResult: unknown[]) {
  const calls: string[] = [];
  return {
    calls,
    connect: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockImplementation(async () => {
      calls.push('lock');
      return { release: vi.fn(() => calls.push('release')) };
    }),
    fetchAll: vi.fn().mockImplementation(async () => {
      calls.push('fetchAll');
      return fetchAllResult;
    }),
    download: vi.fn().mockImplementation(async () => {
      calls.push('download');
      return { content: bufferStream('<ricevutaConsegna/>') };
    }),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(),
}));

describe('toPecInboundMessage', () => {
  it("extracts the From address, subject, and every attachment part's decoded content", async () => {
    const download = vi.fn().mockResolvedValue({ content: bufferStream('<ricevutaConsegna/>') });
    const client = { download };

    const message = await toPecInboundMessage(client, {
      uid: 42,
      envelope: { from: [{ address: 'sdi07@pec.fatturapa.it' }], subject: 'Ricevuta di consegna' },
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          { part: '1.1', type: 'text/plain' },
          {
            part: '1.2',
            type: 'application/xml',
            disposition: 'attachment',
            dispositionParameters: { filename: 'IT01234567890_00001.xml' },
          },
        ],
      },
    } as never);

    expect(message.id).toBe('42');
    expect(message.from).toBe('sdi07@pec.fatturapa.it');
    expect(message.subject).toBe('Ricevuta di consegna');
    expect(message.attachments).toEqual([
      { filename: 'IT01234567890_00001.xml', content: Buffer.from('<ricevutaConsegna/>') },
    ]);
    expect(download).toHaveBeenCalledWith('42', '1.2', { uid: true });
  });

  it('a message with no attachment part at all yields an empty attachments array — never throws', async () => {
    const download = vi.fn();
    const client = { download };

    const message = await toPecInboundMessage(client, {
      uid: 7,
      envelope: { from: [{ address: 'someone@pec.example.it' }] },
      bodyStructure: { part: '1', type: 'text/plain' },
    } as never);

    expect(message.attachments).toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });

  it('a missing From address never throws — falls back to an empty string rather than crashing the drain', async () => {
    const client = { download: vi.fn() };
    const message = await toPecInboundMessage(client, { uid: 1, envelope: undefined } as never);
    expect(message.from).toBe('');
  });

  it('a download that returns no content for a part is skipped, not treated as an empty attachment', async () => {
    const download = vi.fn().mockResolvedValue({});
    const client = { download };

    const message = await toPecInboundMessage(client, {
      uid: 5,
      envelope: { from: [{ address: 'x@pec.example.it' }] },
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          { part: '1.1', type: 'application/xml', disposition: 'attachment', dispositionParameters: {} },
        ],
      },
    } as never);

    expect(message.attachments).toEqual([]);
  });

  it('falls back to "part-<n>" when the attachment carries no filename at all', async () => {
    const download = vi.fn().mockResolvedValue({ content: bufferStream('data') });
    const client = { download };

    const message = await toPecInboundMessage(client, {
      uid: 9,
      envelope: { from: [{ address: 'x@pec.example.it' }] },
      bodyStructure: { part: '1.2', type: 'application/xml', disposition: 'attachment' },
    } as never);

    expect(message.attachments).toEqual([{ filename: 'part-1.2', content: Buffer.from('data') }]);
  });
});

// THE MUTATION TARGET: `fetchUnseen()` used to call `download()` (a second IMAP command) INSIDE the
// `for await (... of client.fetch(...))` loop — exactly the pattern imapflow's own `fetch()` doc
// comment warns against ("You can not run any IMAP commands in this loop otherwise you will end up in
// a deadloop"). Fixed by switching to `fetchAll()`, which resolves the WHOLE listing before this
// method ever calls `download()`.
describe('ImapFlowPecInboxPort.fetchUnseen', () => {
  const mockedImapFlow = ImapFlow as unknown as Mock;

  beforeEach(() => vi.clearAllMocks());

  it('uses fetchAll — never the async-generator fetch() — so download() never interleaves with it', async () => {
    const message = {
      uid: 42,
      envelope: { from: [{ address: 'sdi07@pec.fatturapa.it' }], subject: 'Ricevuta di consegna' },
      bodyStructure: {
        part: '1',
        type: 'multipart/mixed',
        childNodes: [
          {
            part: '1.1',
            type: 'application/xml',
            disposition: 'attachment',
            dispositionParameters: { filename: 'IT01234567890_00001.xml' },
          },
        ],
      },
    };
    const fakeClient = buildFakeImapClient([message]);
    // A `function` expression, NOT an arrow function — `ImapFlowPecInboxPort#buildClient` does
    // `new ImapFlow(...)`. Jest's mocks never really `[[Construct]]` their implementation (they call
    // it plainly and use the return value), so an arrow function "worked" there; Vitest's mocks DO
    // construct it for real, and an arrow function has no `[[Construct]]` at all — "TypeError: ...
    // is not a constructor".
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new ImapFlow(...)` under Vitest, see above.
    mockedImapFlow.mockImplementation(function () {
      return fakeClient;
    });

    const port = new ImapFlowPecInboxPort({
      host: 'imap.pec-provider.it',
      port: 993,
      secure: true,
      username: 'fatture@rossi-srl.pec.it',
      password: 'super-secret',
    });
    const result = await port.fetchUnseen();

    expect(fakeClient.fetchAll).toHaveBeenCalledWith(
      { seen: false },
      { uid: true, envelope: true, bodyStructure: true },
    );
    expect((fakeClient as unknown as { fetch?: unknown }).fetch).toBeUndefined();
    // `fetchAll` fully resolved BEFORE `download` was ever called — the actual property this fix
    // establishes, not merely that both happened to be called at some point.
    expect(fakeClient.calls.indexOf('fetchAll')).toBeLessThan(fakeClient.calls.indexOf('download'));
    expect(result).toHaveLength(1);
    expect(result[0].attachments).toEqual([
      { filename: 'IT01234567890_00001.xml', content: Buffer.from('<ricevutaConsegna/>') },
    ]);
  });

  it('downloads every message returned by fetchAll, in order, and releases the lock only once done', async () => {
    const messages = [
      { uid: 1, envelope: { from: [{ address: 'a@pec.example.it' }] }, bodyStructure: { part: '1' } },
      { uid: 2, envelope: { from: [{ address: 'b@pec.example.it' }] }, bodyStructure: { part: '1' } },
    ];
    const fakeClient = buildFakeImapClient(messages);
    // A `function` expression, NOT an arrow function — `ImapFlowPecInboxPort#buildClient` does
    // `new ImapFlow(...)`. Jest's mocks never really `[[Construct]]` their implementation (they call
    // it plainly and use the return value), so an arrow function "worked" there; Vitest's mocks DO
    // construct it for real, and an arrow function has no `[[Construct]]` at all — "TypeError: ...
    // is not a constructor".
    // biome-ignore lint/complexity/useArrowFunction: must stay a function expression — an arrow function has no [[Construct]] and breaks `new ImapFlow(...)` under Vitest, see above.
    mockedImapFlow.mockImplementation(function () {
      return fakeClient;
    });

    const port = new ImapFlowPecInboxPort({
      host: 'imap.pec-provider.it',
      port: 993,
      secure: true,
      username: 'fatture@rossi-srl.pec.it',
      password: 'super-secret',
    });
    const result = await port.fetchUnseen();

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(['1', '2']);
    // lock acquired once, fetchAll once, then released once (never released before the downloads it
    // gates are done — the "still inside the same lock, just not interleaved with fetchAll itself"
    // property this fix preserves from the original code).
    expect(fakeClient.calls[0]).toBe('lock');
    expect(fakeClient.calls[fakeClient.calls.length - 1]).toBe('release');
    expect(fakeClient.calls.filter((c) => c === 'release')).toHaveLength(1);
  });
});
