/**
 * The seam between "a PEC message arrived" and "here is what was in it" — the same `XxxPort`
 * abstraction `sdi/sdi-client.ts#SdiHttpPort` already establishes for the SOAP route, adapted for a
 * mailbox rather than a web service: nothing in this module talks IMAP/SMTP wire protocol directly, a
 * `PecInboxPort` implementation does. `imapflow-pec-inbox-port.ts` is the REAL implementation (a
 * well-established third-party IMAP library — see that file's own header for why, unlike
 * `sdi/sdicoop-client.ts`'s bespoke SOAP envelope, this is NOT hand-rolled); every unit test in this
 * directory uses a hand-built MOCK implementing this exact interface instead, so the receipt-handling
 * LOGIC (`pec-notifiche.service.ts`) is fully testable without a PEC mailbox, exactly as the
 * engineering constraints for this transport require.
 */

export interface PecInboundAttachment {
  /** The attachment's own filename as carried by the message — read, never trusted as SdI's own
   *  canonical name for the underlying notifica type (the XML root element is what actually decides
   *  that, in `sdi/sdi-notifiche.ts#parseSdiNotifica`). */
  filename: string;
  content: Buffer;
}

export interface PecInboundMessage {
  /** An opaque id THIS port assigns (e.g. an IMAP UID, stringified) — passed back to `markSeen`
   *  unchanged; never parsed or interpreted by anything outside the port implementation itself. */
  id: string;
  /** The PEC envelope's own From address — what `pec-notifiche.service.ts` learns as the address
   *  future sends must target (see `pec-protocol.ts#resolvePecRecipient`) once this message turns out
   *  to actually be an SdI notifica. */
  from: string;
  subject?: string;
  attachments: PecInboundAttachment[];
}

/**
 * What a company's OWN PEC mailbox connection exposes — resolved per-company by the caller (a real
 * caller builds this from `ChannelCredentialsService`'s own decrypted "sdi-pec" config, the exact same
 * per-company channel-credentials mechanism every other transport in this module already uses; see
 * `sdi-pec-transport.ts`'s own header). Two operations only — this is a drain, not a general-purpose
 * mailbox client.
 */
export interface PecInboxPort {
  /** Every message not yet marked seen, oldest first — a full re-fetch each call (no "since" cursor):
   *  the same "cheaper API doesn't exist, so re-fetch and let dedup absorb repeats" reasoning
   *  `conformity/authority-status-poller.ts#poll`'s own header already documents for PDP's polling. */
  fetchUnseen(): Promise<PecInboundMessage[]>;
  /** Marks one message seen — called only AFTER it has been successfully handed to
   *  `pec-notifiche.service.ts`, so a crash between fetch and processing leaves the message unseen for
   *  the NEXT drain rather than silently losing it. */
  markSeen(id: string): Promise<void>;
}
