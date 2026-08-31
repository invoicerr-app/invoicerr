import { DocumentInstanceResult } from '../actions/action-registry';

/** Everything a transport needs to deliver one document — deliberately NOT an email-shaped context
 *  (no `to`, no `subject`): a transport decides for itself how to address and format the delivery
 *  from the company/document it is handed, the same way a 'reference' field kind never assumes what
 *  its target entity looks like. `text` is OPTIONAL and, as of the built-in "email" transport,
 *  unused: that transport now composes its own subject/body from the document type's `email`
 *  template (descriptors/types.ts, actions/send-document-email.ts) and attaches the rendered PDF
 *  itself, rather than trusting a plain-text body an action pre-built. Left here, optional, for a
 *  hypothetical transport that still wants a caller-supplied plain-text fallback — a transport is
 *  free to use it, wrap it, or ignore it entirely. */
export interface DocumentTransportContext {
  companyId: string;
  document: DocumentInstanceResult;
  /** Plain data (not an i18n key), the same convention as DocumentTypeDescriptor.label — e.g. "Invoice". */
  label: string;
  text?: string;
}

export interface DocumentTransportResult {
  /** Human-facing outcome string — same convention as ActionResult.message. */
  message: string;
}

/**
 * What a THIRD PARTY implements to make a new way of delivering a document. Registered under an id
 * (TransportRegistry.register) that a company then CHOOSES (Company.invoiceTransportId) — the
 * registry never picks one on a company's behalf, and never falls back to one when none is chosen.
 * See invoice-actions.ts's "send" for the one caller today.
 */
export interface DocumentTransport {
  send(ctx: DocumentTransportContext): Promise<DocumentTransportResult>;
}

export class UnknownTransportError extends Error {
  constructor(public readonly transportId: string) {
    super(`Unknown transport "${transportId}".`);
    this.name = 'UnknownTransportError';
  }
}

/**
 * Registry of document transports, keyed by id — open by design, the same shape as
 * EntityReferenceRegistry and FieldKindRegistry: a third party registers a new transport under a new
 * id (documents.module.ts is the only place that wires the built-in "email" one today) and a
 * company's `invoiceTransportId` is free to name it. Nothing here, and nothing in
 * invoice-actions.ts, ever hard-codes which transport a company should use — that is read from the
 * company's OWN configuration, not decided by this registry or by the country the company is in.
 */
export class TransportRegistry {
  private readonly transports = new Map<string, { label: string; transport: DocumentTransport }>();

  register(id: string, label: string, transport: DocumentTransport): void {
    if (this.transports.has(id)) {
      throw new Error(`Transport "${id}" is already registered.`);
    }
    this.transports.set(id, { label, transport });
  }

  /** Every registered transport, id and label only — what a company's settings screen offers to
   *  choose from, the same shape DocumentTypeRegistry.list() offers document types in. */
  list(): { id: string; label: string }[] {
    return [...this.transports.entries()].map(([id, { label }]) => ({ id, label }));
  }

  has(id: string): boolean {
    return this.transports.has(id);
  }

  /** Throws UnknownTransportError for an id nobody registered — never returns undefined, mirroring
   *  DocumentTypeRegistry.resolve()/EntityReferenceRegistry.resolve(). */
  resolve(id: string): DocumentTransport {
    const entry = this.transports.get(id);
    if (!entry) {
      throw new UnknownTransportError(id);
    }
    return entry.transport;
  }
}
