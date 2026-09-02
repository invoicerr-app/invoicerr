/**
 * The generic DECLARE-side interface every declarative-reporting channel implements — the read/
 * report-side twin of `transports/transport-registry.ts`'s `DocumentTransport` (delivery) and a
 * close cousin of `conformity/authority-status-poller.ts`'s `AuthorityStatusPoller` (post-deposit
 * conformity polling): same "one small interface, a registry, a provider registers itself under its
 * own id" shape, same reuse of `RawAuthorityEvent`/`ChannelNotConnectedError` from that file (a
 * declaration outcome journals into the exact same `DocumentAuthorityEvent` table a poll result
 * does — see `reporting-runner.ts`'s own header for why that reuse, rather than a parallel table, is
 * the whole point of this mechanism).
 *
 * ## Why this is NOT `AuthorityStatusPoller` — a genuinely different shape, not a rename
 *
 * A poller answers "what does the platform now say about a deposit I ALREADY MADE" — it needs only
 * `(companyId, transportRef)`, because the deposit itself already happened through a TRANSPORT
 * (`transports/pdp-transport.ts`, …). A `DeclarationProvider` answers a different question: "declare
 * THIS invoice's data to the tax authority" — there is no prior deposit to reference (NAV/myDATA are
 * never how the invoice reaches the buyer, see `report-on-send.ts`'s own header), so it needs the
 * invoice's own DATA instead of a `transportRef`, and it produces exactly ONE event per call rather
 * than "every event the platform now reports".
 */
import { ChannelNotConnectedError, RawAuthorityEvent } from '../conformity/authority-status-poller';

export { ChannelNotConnectedError, RawAuthorityEvent };

/** One line's declared arithmetic — see `build-declared-invoice.ts`'s own header: every figure here
 *  comes from `totals/compute-totals.ts`, NEVER recomputed by a provider. Major currency units
 *  (e.g. 1200.50), matching `SemanticLineInput`'s own convention for `unitPrice`. */
export interface DeclaredInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  /** `null` when `totals/compute-totals.ts` could not resolve a usable rate for this line (see that
   *  file's own header) — a provider must treat this as "cannot be declared", never guess a rate. */
  vatRatePercent: number | null;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

/** One party's identity, as far as a declarative provider needs it — deliberately narrower than
 *  `formats/format-provider.ts`'s own `DocumentFormatParty` (no IBAN, no raw `partyIdentifiers`
 *  array): `build-declared-invoice.ts` extracts exactly the two identifiers (`vatNumber`/`legalId`)
 *  a tax-authority declaration ever needs, via the SAME `@/utils/entity-identifiers#getIdentifier`
 *  helper the CII/UBL bridge already uses, never a second, parallel extraction. */
export interface DeclaredParty {
  name: string;
  countryCode: string | undefined;
  vatNumber: string | undefined;
  legalId: string | undefined;
  address: string;
  city: string;
  postalCode: string;
}

/**
 * One invoice, ready to be declared — built ONCE by `build-declared-invoice.ts` from
 * `totals/compute-totals.ts` and the document's own data, handed identically to whichever provider
 * `reporting-runner.ts` resolves. Never re-derived by a provider itself: "mappe depuis compute-
 * totals/le document, jamais recalculé" is enforced by construction — a provider that wanted a
 * different number would have to lie about what is actually on the invoice.
 */
export interface DeclaredInvoice {
  documentId: string;
  typeId: string;
  /** The instance's own `displayNumber` — never re-formatted here. */
  number: string;
  /** ISO date-only ("yyyy-mm-dd") — see `formats/shared-build.ts#toDateOnly`, reused. */
  issueDate: string;
  currency: string;
  seller: DeclaredParty;
  buyer: DeclaredParty;
  lines: DeclaredInvoiceLine[];
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
}

/**
 * What `declare()` hands back — `RawAuthorityEvent` PLUS the one field this whole mechanism's own
 * hard contract turns on: `authorityId`, the authority's own non-empty identifier for THIS
 * declaration (NAV's `transactionId`; myDATA's `invoiceMark`, coerced to a string). A SEPARATE,
 * REQUIRED field rather than something the runner goes digging for inside `rawPayload` — see
 * `reporting-runner.ts#assertNonEmptyDeclarationResult` for the refusal this makes possible without
 * either provider having to agree on a shared JSON shape for their otherwise completely different
 * raw responses. Each provider ALSO includes the same value inside its own `rawPayload` (never only
 * here) — `rawPayload` is what a human reads back in the conformity timeline's raw-payload view;
 * `authorityId` is what THIS CODE asserts on before ever trusting the event enough to journal it.
 */
export interface DeclarationResult extends RawAuthorityEvent {
  authorityId: string;
}

/**
 * What a THIRD PARTY implements to add a declarative-reporting channel — registered under its own id
 * (`DeclarationProviderRegistry.register`), the SAME id a `reporting/data/*.json` fact's own
 * `providerId` names.
 */
export interface DeclarationProvider {
  readonly providerId: string;

  /**
   * Declares one invoice to the authority and returns the ONE resulting `DeclarationResult` —
   * `statusCode` drawn from the platform's own vocabulary (NAV: an `InvoiceStatusType` value, e.g.
   * "DONE"; myDATA: this bridge's own classification of the response — see each provider's own
   * header), `rawPayload` carrying the platform's own verbatim response, `authorityId` the
   * non-empty transactionId/MARK this mechanism's own hard contract requires.
   *
   * @throws ChannelNotConnectedError when this company has no usable credentials for `providerId`
   *   right now — caught by the runner and journaled as `report:blocked`, NEVER retried (retrying an
   *   absent credential achieves nothing — same posture `conformity/authority-status-poller.ts`
   *   already holds for its own `poll()`).
   * @throws Error (any other) for a genuine platform/network failure — left to PROPAGATE (never
   *   caught here): the runner lets BullMQ's own retry/backoff run first, exactly like an ordinary
   *   "send" action job (`actions/async-send.ts`), and only journals `report:failed` once every
   *   retry is exhausted.
   */
  declare(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult>;
}

/**
 * Registry of declaration providers, keyed by provider id — open by design, the exact same shape
 * `AuthorityStatusPollerRegistry`/`TransportRegistry` already hold. `reporting-runner.ts` asks this
 * registry for a provider by the id a `reporting/data/*.json` fact named — adding a THIRD
 * declarative channel is exactly one more `register()` call, never a change to the runner itself.
 */
export class DeclarationProviderRegistry {
  private readonly providers = new Map<string, DeclarationProvider>();

  register(provider: DeclarationProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`A declaration provider for "${provider.providerId}" is already registered.`);
    }
    this.providers.set(provider.providerId, provider);
  }

  /** Never throws for an unknown id — the runner treats `undefined` as "nothing to do" (defensive
   *  only: `report-on-send.ts` only ever enqueues a `providerId` a `reporting/data/*.json` fact
   *  named, and the registry below is built from the SAME set of ids production actually wires). */
  resolve(providerId: string): DeclarationProvider | undefined {
    return this.providers.get(providerId);
  }
}
