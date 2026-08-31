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
 * "request-deposit": the MINIMAL, honest replacement for the old, removed "deposit invoice" concept
 * (see the root TODO's item 6). Creates a brand-new DRAFT invoice whose single line is
 * "Deposit (N% of <quote's own display number>)", for an amount equal to N% of the QUOTE's own
 * gross (TTC) total — recomputed here via `computeDocumentTotals`, in MINOR units, never trusted from
 * a stale, client-submitted figure.
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
        const depositAmountMinor = Math.round((quoteTotals.grossMinor * percent) / 100);
        const depositUnitPrice = fromMinor(depositAmountMinor, currency);

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
