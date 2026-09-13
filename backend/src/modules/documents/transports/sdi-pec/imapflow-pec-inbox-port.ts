/**
 * The REAL `PecInboxPort` — built on `imapflow` (MIT, npm `imapflow`), a well-established third-party
 * IMAP client library. Unlike `sdi/sdicoop-client.ts`'s bespoke SOAP client (hand-rolled deliberately —
 * that file's own header: "no SOAP library" — because the FatturaPA WSDL is a narrow, bespoke contract
 * no existing library speaks), IMAP plus MIME multipart decoding is a large, well-solved, fiddly
 * protocol surface with a mature library ecosystem already available to this project (nodemailer is
 * already a dependency for the SMTP half of PEC; nothing in `package.json` covered the IMAP half
 * before this file). `imapflow` handles the wire protocol AND multipart/MIME decoding
 * (`bodyStructure`/`download()` below) — this file only maps its results onto `PecInboxPort`'s own
 * small contract, never re-implementing either protocol by hand.
 *
 * STATUS: **implemented-awaiting-credentials** — the same honest posture `sdi/sdicoop-client.ts` holds
 * for SDICoop: no PEC mailbox exists for this project today, so this adapter has never been run
 * against a real IMAP server. `pec.live.spec.ts` (gated `PEC_LIVE=1`) is what would prove it; every
 * OTHER spec in this directory tests `pec-notifiche.service.ts`/`pec-inbox-poller.service.ts` against a
 * hand-built MOCK `PecInboxPort` instead (see `pec-inbox-port.ts`'s own header on why that split makes
 * the receipt-handling LOGIC fully testable without a mailbox). This file's own spec covers only the
 * PURE mapping from imapflow's own message shape to `PecInboundMessage` — never a live connection.
 *
 * A fresh IMAP connection is opened and closed for EACH `fetchUnseen()`/`markSeen()` call, rather than
 * held open across the object's lifetime — a deliberate simplification, not an oversight: at the
 * volume one company's own invoicing mailbox actually sees (a handful of messages a day, not
 * thousands), reconnecting per operation costs nothing that matters, and it sidesteps every
 * connection-lifecycle bug a long-lived, shared connection would risk (a stale session across two
 * calls, a lock left held) — the same trade a `pdp-transport.ts`-style stateless per-call client
 * already makes for its own HTTPS calls. A future high-volume deployment reusing one connection across
 * a whole poll cycle is a real optimization, just not one this task's own scope needs.
 */
import { FetchMessageObject, ImapFlow, MessageStructureObject } from 'imapflow';

import { PecInboundAttachment, PecInboundMessage, PecInboxPort } from './pec-inbox-port';

export interface ImapFlowPecInboxPortConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

/** Every leaf body part carrying `Content-Disposition: attachment` — the FatturaPA notifica XML SdI
 *  attaches, and (harmlessly) anything else a message happens to carry. Depth-first, so a nested
 *  multipart (rare, but valid MIME) is still walked completely. */
function collectAttachmentParts(node: MessageStructureObject | undefined): MessageStructureObject[] {
  if (!node) return [];
  const own = node.disposition?.toLowerCase() === 'attachment' && node.part ? [node] : [];
  const children = (node.childNodes ?? []).flatMap(collectAttachmentParts);
  return [...own, ...children];
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Maps ONE imapflow `FetchMessageObject` (already carrying `envelope` + `bodyStructure`) into a
 *  `PecInboundMessage`, downloading and decoding every attachment part via `client.download()` —
 *  exported (not just used internally) so `imapflow-pec-inbox-port.spec.ts` can exercise this pure
 *  mapping against a hand-built fixture, without ever opening a real connection. */
export async function toPecInboundMessage(
  client: Pick<ImapFlow, 'download'>,
  message: FetchMessageObject,
): Promise<PecInboundMessage> {
  const attachments: PecInboundAttachment[] = [];
  for (const part of collectAttachmentParts(message.bodyStructure)) {
    const { content } = await client.download(String(message.uid), part.part, { uid: true });
    if (!content) continue;
    const buffer = await streamToBuffer(content);
    const filename = part.dispositionParameters?.filename ?? `part-${part.part}`;
    attachments.push({ filename, content: buffer });
  }
  return {
    id: String(message.uid),
    from: message.envelope?.from?.[0]?.address ?? '',
    subject: message.envelope?.subject,
    attachments,
  };
}

export class ImapFlowPecInboxPort implements PecInboxPort {
  constructor(private readonly config: ImapFlowPecInboxPortConfig) {}

  private buildClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.username, pass: this.config.password },
      // imapflow's own pino-based logger is off by default in production use; this project's own
      // `logger` (`@/logger/logger.service`) is the one place log lines should go through.
      logger: false,
    });
  }

  async fetchUnseen(): Promise<PecInboundMessage[]> {
    const client = this.buildClient();
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages: PecInboundMessage[] = [];
        for await (const message of client.fetch(
          { seen: false },
          { uid: true, envelope: true, bodyStructure: true },
        )) {
          messages.push(await toPecInboundMessage(client, message));
        }
        return messages;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async markSeen(id: string): Promise<void> {
    const client = this.buildClient();
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        await client.messageFlagsAdd({ uid: id }, ['\\Seen']);
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}
