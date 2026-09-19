import { DocumentFieldDescriptor } from '../descriptors/types';

/**
 * A PAYMENT METHOD descriptor — the whole contract for one way a company can accept payment (bank
 * transfer, PayPal, cash, ...), declared as DATA, on the exact same model `DocumentTypeDescriptor`
 * (descriptors/types.ts) already holds for a document type: nothing downstream (the registry,
 * persistence.ts, the PDF/email renderers, the frontend screen) names a specific method —
 * they only ever read a descriptor. Adding a method means writing one of these and adding it to
 * `built-in.ts` — no bespoke persistence code (see persistence.ts's one documented
 * exception for "bank_transfer"), no new frontend screen.
 *
 * A method carries PRESENTATION and ROUTING only, never money: `compute-settlement.ts`/
 * `compute-totals.ts` stay the only source of truth for what is owed, and `record-payment`'s own
 * `amount`/`currency` params (invoice.descriptor.ts) are untouched by any of this — a method only
 * ever describes how a company is paid, never how much.
 */
export interface PaymentMethodDescriptor {
  /** Stable identifier: the registry key, the value stored on `CompanyPaymentMethodConfig.methodId`,
   *  and — reused verbatim — the value `record-payment`'s own `method` param has always accepted for
   *  "bank_transfer"/"cash" (see built-in.ts's own header on why those two ids were kept unchanged
   *  rather than renamed). */
  id: string;
  /** Human-facing name — plain data, not an i18n key, the SAME convention
   *  `DocumentTypeDescriptor.label` already holds: this never names a language, so a plugin can name
   *  its own method in whatever language it likes. */
  label: string;
  /**
   * The COMPANY-level fields this method needs (an IBAN, a PayPal e-mail...) — reuses the exact same
   * `DocumentFieldDescriptor` vocabulary + `FieldKindRegistry` a document's own `fields` (and an
   * action's own `params`) already use, never a second, bespoke shape (see persistence.ts,
   * which validates a write against these through `validateAgainstDescriptor`, unchanged). Empty for
   * a method with nothing to configure — cash.descriptor.ts and stripe.descriptor.ts both prove the
   * empty case works, for two different reasons (see each file's own header).
   */
  fields: DocumentFieldDescriptor[];
  /**
   * Resolves what this method shows a payer, given this company's own configured values (and,
   * optionally, one document's own amount/currency/reference — see `PaymentMethodRenderContext`).
   * Deliberately PURE and synchronous: no I/O of its own. A method whose real "pay now" link needs a
   * live, authenticated call (Stripe's own checkout session — payments/payment-sessions.service.ts)
   * does not build one here at all — see stripe.descriptor.ts's own header for why embedding one into
   * a static, possibly-resent PDF/email would be actively wrong, not merely out of scope.
   */
  present(ctx: PaymentMethodRenderContext): PaymentMethodPresentation;
}

/**
 * Everything a method's `present()` may read to render itself for ONE specific document — never a
 * second data source it reaches for on its own. `amountMinor`/`currency`/`reference` are OPTIONAL as
 * a group: the payment-methods screen's own preview (frontend) has no document to anchor to at all,
 * and hands a context with all three absent — every built-in method degrades to "no link" rather than
 * guessing an amount, the same "never invent a rule" discipline `sepaPaymentQrFor` already holds for
 * its own, narrower set of gates.
 */
export interface PaymentMethodRenderContext {
  /** This company's own configured field values for this method — already validated against `fields`
   *  at write time (persistence.ts), never re-validated here. Empty object for a method
   *  that declares no fields, or one nobody has configured yet. */
  config: Record<string, unknown>;
  /** The amount to request, in MINOR units — e.g. the invoice's own outstanding balance
   *  (settlement/compute-settlement.ts's `outstandingMinor`), never a re-derived figure. */
  amountMinor?: number;
  /** ISO 4217 currency of `amountMinor`. */
  currency?: string;
  /** A short reconciliation hint a link may attach — the document's own display number, the same role
   *  `remittance` already plays in rendering/sepa-qr.ts's own EPC069-12 payload. */
  reference?: string;
}

/**
 * What one method shows for ONE company (and, optionally, one document) — the PDF's own "Payment
 * methods" section (rendering/render-instance-pdf.ts) and the covering email
 * (actions/send-document-email.ts) both render a list of these, unchanged by which method produced
 * them: neither ever branches on `id`.
 */
export interface PaymentMethodPresentation {
  /** Mirrors the descriptor's own `id` — lets a consumer key off it without a second lookup (e.g. the
   *  frontend's preview, keying its own "no fields" empty-state off this). */
  id: string;
  /** Mirrors the descriptor's own `label`. */
  label: string;
  /** "IBAN: FR76... / BIC: ..." style lines, in the method's own `fields` order — built from whichever
   *  of them actually carry a value (see `presentFromFields`, the shared helper most methods reuse).
   *  Empty for a method with nothing beyond its own label to show (cash, an unconfigured method). */
  lines: string[];
  /** A URL the payer can follow to pay directly — present ONLY when this method can actually build
   *  one for the company/amount at hand (PayPal, once an e-mail is on file AND a document context was
   *  given); absent for cash/cheque (no such concept) and for Stripe (see stripe.descriptor.ts's own
   *  header on why that absence is deliberate, not a gap). */
  link?: string;
}

/**
 * The shared, default `present()` body most built-in methods reuse verbatim: one line per configured
 * field, `"<field label>: <value>"`, in declaration order — skipping a field with no value on file,
 * the same "only show what's actually set" rule `render-html.ts`'s own field loop holds for an
 * OPTIONAL document field (never for a REQUIRED one, which is exactly what makes this safe: every
 * built-in method's own required fields are enforced at WRITE time by `validateAgainstDescriptor`, so
 * a genuinely ENABLED method never reaches this with a required field missing). A method whose
 * presentation needs more than this (PayPal's own link) calls this for the `lines` half and adds its
 * own on top — see paypal.descriptor.ts.
 */
export function presentFromFields(
  descriptor: Pick<PaymentMethodDescriptor, 'id' | 'label' | 'fields'>,
  config: Record<string, unknown>,
): PaymentMethodPresentation {
  const lines: string[] = [];
  for (const field of descriptor.fields) {
    const value = config[field.key];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${field.label}: ${String(value)}`);
  }
  return { id: descriptor.id, label: descriptor.label, lines };
}
