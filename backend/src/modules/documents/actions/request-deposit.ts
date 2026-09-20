import { BadRequestException } from '@nestjs/common';

import { fromMinor } from '@/utils/financial';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ActionRegistry } from './action-registry';
import { createDraftInvoiceFromQuote } from './quote-to-invoice';

/**
 * The quote's OWN base descriptor, imported directly rather than resolved through
 * `DocumentTypeRegistry` — the exact same, already-established choice invoice-actions.ts makes for
 * `INVOICE_DESCRIPTOR`, and for the same reason: this file is already 100% quote-specific (it only
 * ever reads a QUOTE's own `lines`/`currency` shape to compute its totals), so there is no
 * reusability lost by not going through the registry, and no risk either — nothing here mutates or
 * re-registers this descriptor, it only feeds `computeDocumentTotals` the field SHAPE it needs.
 */
const QUOTE_DESCRIPTOR = buildQuoteDescriptor();

/**
 * "request-deposit": the MINIMAL, honest replacement for the old, removed "deposit invoice" concept.
 * Creates a brand-new DRAFT invoice whose single line is
 * "Deposit (N% of <quote's own display number>)", so that the client is asked to pay N% of the
 * QUOTE's own gross (TTC) total — recomputed here via `computeDocumentTotals`, in MINOR units, never
 * trusted from a stale, client-submitted figure.
 *
 * ## Which total the percentage is taken against — and which slot the result goes into
 *
 * `unitPrice` on an invoice line is a NET (HT) amount: `computeDocumentTotals` multiplies it by the
 * quantity and then adds the line's own VAT rate on top of it to reach the gross the client actually
 * pays. So the number this handler writes there must be a NET, and the percentage is therefore taken
 * against the quote's own NET total — NOT against its gross. Taking N% of the GROSS and writing that
 * into `unitPrice` would hand the invoice a VAT-inclusive figure to charge VAT on a second time, and
 * the client would be billed N% of the quote's gross MULTIPLIED by (1 + rate) — an overcharge of
 * exactly the VAT rate on every single deposit.
 *
 * The two readings a "N% deposit" can have in the wild — N% of the net, N% of the gross — are the
 * SAME invoice here, so there is nothing to arbitrate between them: under the ONE rate a mono-rate
 * quote carries (the only case where this handler sets a rate at all — see just below), the invoice
 * this produces totals N% of the quote's net as its own net AND N% of the quote's gross as its own
 * gross, to the cent — a proportion holds on both sides of a single rate. The percentage is applied to the
 * net rather than the gross because that is the only base VAT may legitimately be computed on, and
 * because deriving a net back OUT of a gross would divide by (1 + rate) — a rounding trip whose
 * result, re-taxed by `computeDocumentTotals`, need not land back on the gross it came from. This is
 * the same reasoning computeMilestoneSplit (request-installments.ts) already documents for its own
 * split: grosses only reconcile when the single rate is applied on top of nets, never the other way
 * around.
 *
 * For a quote carrying zero or several rates the line is stored WITHOUT a rate (below), so the
 * deposit is N% of the quote's net and stays there until a human picks the rate the message asks them
 * for — at which point VAT is added to a net base, as an invoice line always does. No single number
 * could be N% of the gross of a quote that mixes rates and simultaneously a valid net line, which is
 * one more face of the very question this handler declines to answer.
 *
 * Only available once the quote is 'sent' (see quote.descriptor.ts) — which is also the quote's own
 * `numbering.onEnterStatus`, so by the time this action can run at all the quote is guaranteed to
 * already carry a `displayNumber` (the `?? quote.id` fallback below is only ever exercised by a
 * quote whose numbering somehow failed to take, never by the ordinary path).
 *
 * ## The VAT rate question this handler deliberately does NOT answer
 *
 * Which VAT rate applies to a deposit collected against a quote that mixes several rates across its
 * own lines is a genuine FISCAL question (does the deposit follow the "main" service's rate? a
 * pro-rata blend? the highest rate, conservatively?) — this module has no authority to invent an
 * answer, the same discipline every `country-policy/data/*.json` file in this directory already
 * holds for a claim it cannot source. So this handler answers a narrower, honest question instead:
 * "does the quote even present more than one choice?" —
 *  - EXACTLY ONE rate across every VAT-bearing line (`vatBreakdown.length === 1`): there is no
 *    ambiguity to punt on, so the deposit line reuses that ONE rate. This is not a guess among many
 *    equally-plausible answers; there was only ever one candidate.
 *  - ZERO or MORE THAN ONE rate: the deposit line's `vatRate` is left UNSET (never defaulted to "the
 *    first one found", which would be exactly the silently-wrong shortcut a mutation test for this
 *    file is meant to catch) and the action's own result `message` says so in plain words, so the
 *    person who just ran this sees immediately that a choice is waiting on them, rather than
 *    discovering an invented rate later on an issued invoice.
 *
 * Reuses the "load quote, guard it, persist a new draft invoice, envelope" skeleton from
 * quote-to-invoice.ts, shared with "convert-to-invoice" — see that file's header for why.
 */
export function registerRequestDepositAction(registry: ActionRegistry): void {
  registry.register('quote', 'request-deposit', async ({ companyId, documentId, params }) => {
    const percent = params.percent as number; // already proven a finite 1..100 number by 'number' kind.
    if (!(percent > 0)) {
      throw new BadRequestException('The deposit percentage must be greater than zero.');
    }

    // Filled by `buildInvoiceData` below, read by `buildMessage` — safe because
    // `createDraftInvoiceFromQuote` always calls the former, synchronously, before the latter. Kept
    // as one shared computation rather than calling `computeDocumentTotals` twice: it is a pure,
    // cheap function either way, but this is the actual number the deposit's OWN amount was derived
    // from, so the message should describe that exact result, not a fresh recomputation of it.
    let ratesFoundOnQuote = 0;

    return createDraftInvoiceFromQuote(
      companyId,
      documentId,
      'request a deposit on',
      (quote, quoteData) => {
        const currency = typeof quoteData.currency === 'string' ? quoteData.currency : undefined;
        if (!currency) {
          throw new BadRequestException(
            `Quote "${quote.id}" has no currency recorded — cannot compute a deposit amount for it.`,
          );
        }

        const quoteTotals = computeDocumentTotals(QUOTE_DESCRIPTOR, quoteData);
        ratesFoundOnQuote = quoteTotals.vatBreakdown.length;
        // N% of the quote's NET, in minor units, one single rounding at the end — the line this feeds
        // is a NET slot the document's own VAT is then computed on top of. See this file's own header,
        // "Which total the percentage is taken against": the invoice this produces still totals N% of
        // the quote's GROSS, because that is what the rate carried over below puts back on.
        const depositNetMinor = Math.round((quoteTotals.netMinor * percent) / 100);
        const depositUnitPrice = fromMinor(depositNetMinor, currency);

        // See this file's own header, "The VAT rate question this handler deliberately does NOT
        // answer" — exactly one candidate rate is reused; anything else leaves `vatRate` unset.
        const vatRate = ratesFoundOnQuote === 1 ? String(quoteTotals.vatBreakdown[0].ratePercent) : undefined;

        const quoteLabel = quote.displayNumber ?? quote.id;

        return {
          client: quoteData.client,
          issueDate: new Date().toISOString(),
          currency,
          notes: quoteData.notes,
          origin: { entity: 'quote', id: quote.id },
          lines: [
            {
              description: `Deposit (${percent}% of ${quoteLabel})`,
              quantity: 1,
              unit: 'unit',
              unitPrice: depositUnitPrice,
              ...(vatRate !== undefined ? { vatRate } : {}),
            },
          ],
        };
      },
      (quote, invoice) => {
        const baseMessage = `Deposit invoice ${invoice.id} created from quote ${quote.displayNumber ?? quote.id}.`;
        if (ratesFoundOnQuote === 1) return baseMessage;
        // Two genuinely different "no single answer" cases (see this file's own header) get two
        // genuinely different notes — "multiple" is never stretched to also mean "none at all".
        const rateNote =
          ratesFoundOnQuote === 0
            ? "no VAT rate found on the quote — pick the deposit's rate yourself."
            : "multiple VAT rates on the quote — pick the deposit's rate yourself.";
        return `${baseMessage} ${rateNote}`;
      },
    );
  });
}
