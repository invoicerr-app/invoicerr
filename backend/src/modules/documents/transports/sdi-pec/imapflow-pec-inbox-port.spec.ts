/**
 * `toPecInboundMessage` in isolation — the ONLY part of `imapflow-pec-inbox-port.ts` this task can
 * prove without a real IMAP server (see that file's own header, "STATUS: implemented-awaiting-
 * credentials"). `client.download` is a hand-built fake here, never a real `ImapFlow` instance —
 * exactly the "real unit tests against a mocked ... IMAP port" this transport's engineering
 * constraints ask for, one layer below `PecInboxPort` itself (`pec-inbox-poller.service.spec.ts`
 * already covers that layer with an even simpler mock).
 */
import { Readable } from 'node:stream';

import { toPecInboundMessage } from './imapflow-pec-inbox-port';

function bufferStream(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
}

describe('toPecInboundMessage', () => {
  it("extracts the From address, subject, and every attachment part's decoded content", async () => {
    const download = jest.fn().mockResolvedValue({ content: bufferStream('<ricevutaConsegna/>') });
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
    const download = jest.fn();
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
    const client = { download: jest.fn() };
    const message = await toPecInboundMessage(client, { uid: 1, envelope: undefined } as never);
    expect(message.from).toBe('');
  });

  it('a download that returns no content for a part is skipped, not treated as an empty attachment', async () => {
    const download = jest.fn().mockResolvedValue({});
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
    const download = jest.fn().mockResolvedValue({ content: bufferStream('data') });
    const client = { download };

    const message = await toPecInboundMessage(client, {
      uid: 9,
      envelope: { from: [{ address: 'x@pec.example.it' }] },
      bodyStructure: { part: '1.2', type: 'application/xml', disposition: 'attachment' },
    } as never);

    expect(message.attachments).toEqual([{ filename: 'part-1.2', content: Buffer.from('data') }]);
  });
});
