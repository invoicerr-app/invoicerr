/**
 * InboxPort — abstraction for inbound document delivery channels that push via
 * SFTP mailbox, IMAP, or a proprietary polling endpoint (e.g. SdI SDICoop SFTP,
 * a generic IMAP mailbox, or a pull-based queue).
 *
 * Design: offline-safe by default.  The `NullInboxPort` returns an empty list and
 * never connects to any external system.  Real transports (SdI SFTP, IMAP, …) are
 * wired in by replacing the port in the DI container when credentials are available.
 *
 * Each message returned by `poll()` should be idempotent: `messageId` is the dedup
 * key fed into `InboundRouter.receive()`.  The implementation marks messages as
 * "seen" (UIDL tracking for SFTP/IMAP, or a cursor) so a second poll is a no-op.
 */

import type { ChannelType } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single inbound document retrieved from the inbox.
 */
export interface InboxMessage {
  /**
   * Stable unique identifier for this message (dedup key).
   * Examples: SFTP filename, IMAP UID, queue message ID.
   */
  messageId: string;

  /** Channel this message belongs to (determines how it is routed). */
  channel: ChannelType;

  /**
   * The correlation key used to match a `CallbackRegistration`.
   * For SdI: the `idSdI` string.  For Peppol: the AP message ID.  For PDP: the invoiceId.
   */
  correlationKey: string;

  /** Canonical status string (same semantics as `InboundInput.status`). */
  status: string;

  /** Optional raw provider reference (used as dedup rawRef in the router). */
  rawRef?: string;

  /** Raw bytes of the inbound document (optional; for future parsing/archival). */
  documentBytes?: Buffer;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * Port for inbox-based inbound transport.
 * Implement this to add SFTP/IMAP/queue support; inject a `NullInboxPort` when
 * no credentials are configured to keep the system offline-safe.
 */
export interface InboxPort {
  /**
   * Poll the inbox for new messages.
   * Implementations MUST be idempotent: calling poll() twice should not return
   * the same message twice (use server-side "seen" flags, UIDL, or a local cursor).
   *
   * Returns an empty array when:
   *   - No messages are available.
   *   - The transport is unconfigured (NullInboxPort).
   *   - Network is unavailable (implementations should catch and return []).
   */
  poll(): Promise<InboxMessage[]>;

  /**
   * Human-readable identifier (used in logs, e.g. "sftp:sdi", "imap:default").
   */
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Null implementation (offline-safe default)
// ---------------------------------------------------------------------------

/**
 * No-op inbox: always returns an empty list and never opens any connection.
 * Used when no inbox credentials are configured.
 */
export class NullInboxPort implements InboxPort {
  readonly id = 'null';

  async poll(): Promise<InboxMessage[]> {
    return [];
  }
}
