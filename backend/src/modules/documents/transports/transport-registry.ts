import { DocumentInstanceResult } from '../actions/action-registry';
import { ArchivedArtifactInput } from '../archive/hashing';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildOptions } from '../formats/format-provider';

/**
 * Issue #499 - what a transport that BUILDS a structured format (Factur-X, FatturaPA, Peppol BIS...)
 * builds from, when that is not the delivered document itself. The credit note's "send"
 * (`actions/credit-note-actions.ts`) is the one caller that sets it: a credit note owns neither a
 * client nor priced lines (`credit-note.descriptor.ts`, "Two shapes, one type"), so its electronic
 * form is built from the invoice it corrects, priced with the invoice descriptor and marked as a
 * credit note (`formats/credit-note-source.ts`), exactly as its own "download-xml" builds it
 * (`documents.service.ts#downloadDocumentFormat`). `document` keeps the credit note's own id and
 * number; only its `data` is the invoice-shaped, tax-resolved build input.
 */
export interface TransportFormatSource {
  descriptor: DocumentTypeDescriptor;
  document: DocumentInstanceResult;
  options?: DocumentFormatBuildOptions;
}

/**
 * The build input of a format-building transport: `ctx.formatSource` when the caller set one, the
 * delivered document built with the invoice descriptor otherwise (every invoice, exactly as before
 * issue #499). One helper so the seven transports that build a format cannot each read it differently.
 */
export function formatBuildInputOf(
  ctx: DocumentTransportContext,
  invoiceDescriptor: DocumentTypeDescriptor,
): Required<Pick<TransportFormatSource, 'descriptor' | 'document'>> & Pick<TransportFormatSource, 'options'> {
  return {
    descriptor: ctx.formatSource?.descriptor ?? invoiceDescriptor,
    document: ctx.formatSource?.document ?? ctx.document,
    options: ctx.formatSource?.options,
  };
}

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
  /**
   * OPTIONAL — a `formats/format-registry.ts` id this send must build INSTEAD OF whatever a transport
   * builds by DEFAULT. Exists for exactly one reason today: B2G routing (`b2g-routing/schema.ts`'s own
   * `B2gRoutingRuleFact.formatSyntax`) already decides, per COUNTRY, both the transport AND the format
   * a government recipient is owed — but a transport can be format-fixed (`transports/pdp-transport.ts`
   * only ever builds Factur-X, `sdi-transport.ts` only FatturaPA) while the SAME channel could
   * legitimately carry more than one content format. `actions/invoice-actions.ts`'s
   * `resolveB2gInvoiceTransport` sets this to `rule.formatSyntax` whenever a B2G rule is what selected
   * the transport for this send — NEVER for the seller-country mandate or the company's own free
   * choice, and never for a B2G rule whose format happens to equal the transport's own default
   * (chorus-pro/facturx, sdi/fatturapa, face/facturae, anaf/ubl — setting it there is harmless, just
   * redundant, since none of those transports ever reads this field at all).
   *
   * A transport is free to IGNORE this field entirely — the same "optional, ignored by default"
   * contract `text` above already holds — and EVERY transport registered today does exactly that: a
   * fixed-format transport builds its one format regardless of what this names, with NO change in
   * behavior and NO error. The one transport that used to understand this concept, "peppol"
   * (`b2g-routing/data/de.json` named it with `formatSyntax: "xrechnung"` — Germany's federal portal
   * accepted Peppol as a content-agnostic CHANNEL but § 4 Abs. 1 ERechV requires XRechnung, not generic
   * Peppol BIS, as CONTENT), was removed from the product on 2026-09-15 — see that JSON file's own
   * `notes` for the full, dated history. This field is left in place, dormant, for a future transport
   * that legitimately needs to build more than one format: whichever one implements it must still
   * never SILENTLY substitute its own default when it cannot honor a requested override — a named
   * refusal, the same discipline the removed `peppol-transport.ts#resolveFormatForSend` held (a
   * government invoice silently leaving in the wrong format would be worse than a block).
   */
  formatOverride?: string;
  /** Issue #499 - see `TransportFormatSource`. Absent for an invoice. */
  formatSource?: TransportFormatSource;
}

export interface DocumentTransportResult {
  /** Human-facing outcome string — same convention as ActionResult.message. */
  message: string;
  /** An authority/platform-assigned reference the transport got back on delivery — e.g. the PDP
   *  deposit id (`transports/pdp-transport.ts`). Optional: the "email" transport has no such concept
   *  and never sets it. When present, `actions/async-send.ts`'s phase-2 delivery persists it onto
   *  `DocumentInstance.transportRef` (see that column's own schema comment) on the SAME write that
   *  moves the record to "sent". */
  reference?: string;
  /**
   * This transport's OWN registered id (e.g. "pdp", "ksef") — set by every transport that has one
   * (never by "email", which has no provider-side conformity concept at all). Serves post-deposit
   * conformity tracking (`conformity/`): `actions/async-send.ts`'s
   * phase-2 delivery persists this onto `DocumentInstance.channelProviderId` on the SAME write as
   * `reference` above — the conformity sweep needs to know which channel THIS document actually went
   * through, which `Company.invoiceTransportId` alone cannot answer (it is the company's CURRENT
   * choice, free to change after this document was sent). A transport that registers no poller for
   * this id (e.g. "sdi" — push-only SOAP notifiche, see `conformity/pollers/`'s own header) still
   * sets this for the record's own honesty; the sweep simply never selects it, since eligibility is
   * gated on the POLLER REGISTRY knowing the id, not on this column's mere presence.
   */
  providerId?: string;
  /**
   * Legal archiving — the artifacts THIS transport actually delivered, in
   * delivery order: the human-readable PDF (already signed if it was — see
   * `signing/sign-instance-pdf.ts`) for "email", or the structured format actually
   * deposited/submitted for "pdp"/"ksef"/"sdi" (Factur-X/FA(3)/FatturaPA — see each transport's own
   * `send()`) — never both invented for a transport that only ever delivers one kind. Absent (or
   * empty) means nothing conservable came out of this delivery - not a failure, simply nothing to
   * archive. (The credit note's "send" used to be that case; since issue #499 it always archives at
   * least its rendered PDF, see `credit-note-actions.ts`.) `actions/async-send.ts`'s phase-2 delivery archives EXACTLY this list, immutably and
   * hash-wrapped (`archive/hashing.ts`), the moment delivery succeeds — see `archive/archive-on-send.ts`.
   */
  artifacts?: ArchivedArtifactInput[];
}

/**
 * What a THIRD PARTY implements to make a new way of delivering a document. Registered under an id
 * (TransportRegistry.register) that a company then CHOOSES (Company.invoiceTransportId) — the
 * registry never picks one on a company's behalf, and never falls back to one when none is chosen.
 * See invoice-actions.ts's "send" for the one caller today.
 */
export interface DocumentTransport {
  send(ctx: DocumentTransportContext): Promise<DocumentTransportResult>;
  /**
   * An OPTIONAL extra gate `invoice-actions.ts`'s own phase-1 preflight runs, in addition to (never
   * instead of) `resolveInvoiceTransport`'s "is a transport even chosen and registered" check — for a
   * transport whose OWN readiness is a separate fact the registry cannot see (e.g. "pdp": a company
   * can pick `invoiceTransportId: 'pdp'` without ever having connected PDP credentials —
   * `transports/pdp-transport.ts`'s own header). Absent for the "email" transport: nothing about an
   * email address is knowable before a specific document names a client, so there is nothing this
   * hook could check ahead of `send()` itself. Throwing here runs BEFORE the record is ever persisted
   * or queued — the exact same "blocked, and says so, before touching anything" behavior a missing/
   * unregistered transport already gets (see `async-send.ts`'s own `preflight` parameter).
   */
  preflight?(companyId: string): Promise<void>;
  /**
   * Issue #499 - whether this transport can deliver a CREDIT NOTE. A credit note is an invoice in law
   * (CGI art. 289, I, 5), so it travels on the channel the company's invoices travel on
   * (`credit-note-actions.ts`); a channel that cannot carry one refuses the send by name rather than
   * issuing a credit note nobody receives. A transport declaring it reads the buyer, and builds any
   * format, from `ctx.formatSource` (`formatBuildInputOf`), which the credit note's send always sets.
   */
  deliversCreditNotes?: boolean;
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
