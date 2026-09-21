import { BadRequestException } from '@nestjs/common';

import { fromMinor } from '@/utils/financial';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { findOwnedDocument, upsertDocument } from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ActionRegistry, DocumentInstanceResult } from './action-registry';

/**
 * The quote's OWN base descriptor — see request-deposit.ts's identical constant for why this is
 * imported directly rather than resolved through `DocumentTypeRegistry`: this file only ever reads a
 * QUOTE's own `lines`/`currency` shape to compute its totals, so there is nothing to gain from going
 * through the registry, and nothing at risk either (this file never mutates or re-registers it).
 */
const QUOTE_DESCRIPTOR = buildQuoteDescriptor();

export interface MilestoneInput {
  percent: number;
  dueDate: string;
}

export interface MilestoneSplitEntry {
  percent: number;
  dueDate: string;
  /** The amount the milestone's invoice carries as its single line's unit price — the ONLY one of
   *  these three the invoice actually stores. */
  netMinor: number;
  /** What that invoice's own totals will make of it (`grossForNet`), not a figure imposed on it:
   *  `vatMinor` is `round(netMinor × rate / 100)` and `grossMinor` their sum, exactly as
   *  `totals/compute-totals.ts` will recompute them. `grossMinor` is what the client is asked to pay,
   *  and therefore what the caller's own "these total the quote" claim is checked against. */
  vatMinor: number;
  grossMinor: number;
}

/**
 * What a milestone's OWN invoice will total, gross, once it exists: the exact arithmetic
 * `totals/compute-totals.ts` applies to a single line (net × quantity 1, then the ONE rate on the
 * aggregated base, rounded once). Deliberately the SAME formula rather than an approximation of it —
 * this whole split is only worth anything if it predicts, to the cent, what those N invoices will
 * each independently recompute for themselves.
 */
function grossForNet(netMinor: number, ratePercent: number): number {
  return netMinor + Math.round((netMinor * ratePercent) / 100);
}

/**
 * The inverse of `grossForNet`: the NET a milestone's single line must carry for its own invoice to
 * total exactly `grossMinor`.
 *
 * `grossForNet` is a STEP function, so that inverse does not always exist: at 20% every fifth cent of
 * net carries the gross up by two (a net of 32 totals 38, a net of 33 totals 40), which leaves
 * roughly one gross in six — 39 here — reachable by no net at all. So: start from the algebraic
 * inverse — one division, one rounding, the
 * money never leaving minor units — and keep it unless a neighbour lands EXACTLY on the target or
 * strictly closer to it. A target that stays unreachable is off by exactly one cent, and
 * `absorbUnreachableLastGross` below is what then places that cent.
 */
function netForGross(grossMinor: number, ratePercent: number): number {
  const start = Math.round((grossMinor * 100) / (100 + ratePercent));
  let best = start;
  let bestDistance = Math.abs(grossForNet(start, ratePercent) - grossMinor);
  // ±2 is already generous: the algebraic inverse can only miss by the rounding of its own division
  // plus the rounding of the VAT it could not know about, i.e. by at most a cent either way.
  for (let candidate = start - 2; candidate <= start + 2; candidate++) {
    const realized = grossForNet(candidate, ratePercent);
    if (realized === grossMinor) return candidate;
    const distance = Math.abs(realized - grossMinor);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The one cent the ordinary pass cannot place, placed. Called only when the LAST milestone's own
 * target gross — everything the quote still owes once the earlier milestones are settled — is one of
 * the values `grossForNet` simply skips (see `netForGross`): the last invoice then lands a cent to
 * one side of it and the plan no longer totals the quote.
 *
 * The fix is to move a cent onto a milestone that CAN take it: nudge one earlier milestone's net by a
 * single cent, which shifts its own gross by one or two, and re-solve the last milestone against what
 * is then left. Scanning backwards from the milestone just before the last keeps the adjustment as
 * close as possible to the one that could not settle, and an upward nudge is tried before a downward
 * one so the plan errs towards billing the earlier milestone, never towards shrinking it.
 *
 * Mutates `entries` in place and leaves them untouched if no combination works — the caller's own
 * invariant check is what refuses outright in that case, rather than this returning a plan that
 * quietly does not add up.
 */
function absorbUnreachableLastGross(
  entries: MilestoneSplitEntry[],
  quoteGrossMinor: number,
  ratePercent: number,
): void {
  const lastIndex = entries.length - 1;
  const allocatedGrossMinor = entries.reduce((sum, entry) => sum + entry.grossMinor, 0);

  for (let index = lastIndex - 1; index >= 0; index--) {
    for (const step of [1, -1]) {
      const nudgedNetMinor = entries[index].netMinor + step;
      const nudgedGrossMinor = grossForNet(nudgedNetMinor, ratePercent);
      const shiftMinor = nudgedGrossMinor - entries[index].grossMinor;
      const lastGrossMinor =
        quoteGrossMinor - (allocatedGrossMinor - entries[lastIndex].grossMinor + shiftMinor);
      const lastNetMinor = netForGross(lastGrossMinor, ratePercent);
      if (grossForNet(lastNetMinor, ratePercent) !== lastGrossMinor) continue;

      entries[index] = {
        ...entries[index],
        netMinor: nudgedNetMinor,
        vatMinor: nudgedGrossMinor - nudgedNetMinor,
        grossMinor: nudgedGrossMinor,
      };
      entries[lastIndex] = {
        ...entries[lastIndex],
        netMinor: lastNetMinor,
        vatMinor: lastGrossMinor - lastNetMinor,
        grossMinor: lastGrossMinor,
      };
      return;
    }
  }
}

/**
 * Pure math, unit-tested on its own (request-installments.spec.ts): splits a quote across N
 * milestones, in MINOR units, so that what the client is asked to PAY — the sum of the generated
 * invoices' own GROSS totals — comes back to the quote's own gross total, to the cent.
 *
 * Validates FIRST, before any arithmetic, and throws rather than silently coping:
 *  - fewer than two milestones — one milestone would just be the whole quote, not an installment plan;
 *  - a percent that is not strictly positive — a 0% "milestone" is not an installment, it is a
 *    generated invoice for nothing;
 *  - percents that do not sum to EXACTLY 100 — never normalized. A caller who typed "30/30/30" gets
 *    told so, not silently billed for 90% of the quote with a fourth invoice nobody asked for;
 *  - a quote whose own gross is not its own net taxed at the single rate found — i.e. part of its net
 *    carries no usable rate at all (`compute-totals.ts` counts such a line "in net only"). One line at
 *    20% next to one line at no rate leaves `vatBreakdown` with a single entry, so the caller's
 *    mono-rate check passes, yet no single-rate invoice can ever reproduce that quote: splitting it
 *    would silently tax the untaxed part.
 *
 * ## Which axis is made exact, and which one gives
 *
 * The generated invoice stores a NET unit price and nothing else: its VAT, and therefore its gross,
 * is re-derived by `compute-totals.ts` from that net and the rate (`grossForNet` above). So the only
 * number this function can actually PUT on an invoice is a net, and the only number the client
 * reconciles against the quote they accepted is the gross they are asked to pay. Those two do not
 * survive the same split:
 *  - splitting the NET makes the nets sum exactly and lets the grosses drift, because the sum of
 *    per-milestone rounded VAT is not the rounding of the whole quote's VAT (a third of 100.00 at 20%
 *    gives nets 33.33/33.33/33.34, whose own invoices total 40.00/40.00/40.01 = 120.01 against a
 *    120.00 quote — the client is asked for a cent nobody quoted);
 *  - splitting the GROSS and deriving each net back out of it (`netForGross`) makes what they pay sum
 *    exactly, at the price of the nets no longer summing to the quote's own net.
 *
 * This function does the second. The client's side of the document is the side made exact; the other
 * one gives by a few cents at most across the whole plan (the same 100.00 quote becomes three
 * invoices of 33.33 + 6.67 = 40.00, whose nets total 99.99 and whose VAT totals 20.01). Every invoice
 * stays internally exact — each one's VAT really is its own net at the rate, rounded once — and the
 * drift lands where nothing is owed on it: the quote's net was never a payable amount, and no VAT
 * return is built from a quote.
 *
 * ## Who carries the remainder
 *
 * The LAST milestone: it is handed whatever the quote still owes once the earlier ones are settled
 * (`quoteGrossMinor − allocated`), rather than a percentage of its own. An
 * installment plan whose final invoice does not close the account is the one failure a client
 * actually sees, so the final invoice is the one defined as "the rest", never as "33.34%".
 *
 * The one case that needs more than that is a final share `grossForNet` cannot produce at all —
 * `absorbUnreachableLastGross` above, which buys it back with a one-cent nudge on an earlier
 * milestone. Should even that fail, the whole split is refused rather than returned not adding up:
 * the caller's message says these invoices total the quote exactly, and that claim is this check.
 */
export function computeMilestoneSplit(
  quoteNetMinor: number,
  quoteGrossMinor: number,
  singleVatRatePercent: number,
  milestones: MilestoneInput[],
): MilestoneSplitEntry[] {
  if (milestones.length < 2) {
    throw new BadRequestException('At least two milestones are required to split a quote into installments.');
  }
  for (const milestone of milestones) {
    if (!(milestone.percent > 0)) {
      throw new BadRequestException('Each milestone percentage must be greater than zero.');
    }
  }

  const percentSum = milestones.reduce((sum, milestone) => sum + milestone.percent, 0);
  // A tiny epsilon absorbs ONLY the floating-point noise summing literal decimal percentages can
  // introduce (e.g. 33.33 + 33.33 + 33.34), never a genuine mismatch like 99 or 100.5 — see this
  // function's own header: a wrong sum is refused outright, never silently normalized to 100.
  if (Math.abs(percentSum - 100) > 1e-9) {
    throw new BadRequestException(`Milestone percentages must add up to exactly 100 (got ${percentSum}).`);
  }

  // See this function's own header, last validation bullet: part of this quote's net carries no
  // usable VAT rate, so no single-rate invoice can reproduce it and splitting it would tax what the
  // quote itself leaves untaxed.
  if (grossForNet(quoteNetMinor, singleVatRatePercent) !== quoteGrossMinor) {
    throw new BadRequestException(
      'This quote cannot be split into installments: part of its net total carries no usable VAT ' +
        'rate, so its gross total is not its net total at the single rate found. Give every line a ' +
        'rate first.',
    );
  }

  const entries: MilestoneSplitEntry[] = [];
  let allocatedGrossMinor = 0;
  milestones.forEach((milestone, index) => {
    const isLast = index === milestones.length - 1;

    // The last milestone is handed the REST, not a percentage of its own — see this function's own
    // header, "Who carries the remainder".
    const targetGrossMinor = isLast
      ? quoteGrossMinor - allocatedGrossMinor
      : Math.round((quoteGrossMinor * milestone.percent) / 100);

    // The net is derived FROM that gross, and the gross is then read back off it, so these three
    // numbers are what this milestone's own invoice will independently recompute — never a promise
    // made here that the invoice does not keep.
    const netMinor = netForGross(targetGrossMinor, singleVatRatePercent);
    const grossMinor = grossForNet(netMinor, singleVatRatePercent);
    allocatedGrossMinor += grossMinor;

    entries.push({
      percent: milestone.percent,
      dueDate: milestone.dueDate,
      netMinor,
      vatMinor: grossMinor - netMinor,
      grossMinor,
    });
  });

  if (allocatedGrossMinor !== quoteGrossMinor) {
    absorbUnreachableLastGross(entries, quoteGrossMinor, singleVatRatePercent);
  }

  const combinedGrossMinor = entries.reduce((sum, entry) => sum + entry.grossMinor, 0);
  if (combinedGrossMinor !== quoteGrossMinor) {
    throw new BadRequestException(
      `These milestones cannot be billed as whole cents at ${singleVatRatePercent}% VAT: their ` +
        `invoices would total ${combinedGrossMinor} against the quote's own ${quoteGrossMinor} ` +
        '(minor units). Change one percentage, or the number of milestones.',
    );
  }

  return entries;
}

/**
 * "request-installments" — from a SENT quote, generates N DRAFT invoices,
 * one per milestone, each due on its own date, whose gross totals sum to the quote's own gross (TTC)
 * EXACTLY (computeMilestoneSplit above). Only available once 'sent' — the same reasoning
 * request-deposit.ts's own header already holds ("one cannot ask for installments on a quote the
 * client hasn't even received"), and 'sent' is also this type's own `numbering.onEnterStatus`, so a
 * quote this action can run against is always already numbered.
 *
 * ## The single-VAT-rate constraint — a DELIBERATE divergence from request-deposit.ts
 *
 * request-deposit.ts, facing the exact same "which rate?" question for a multi-rate quote, chooses to
 * leave the deposit's own `vatRate` UNSET and say so in its result message — a deposit's amount is
 * still correct either way (N% of the quote's gross), only its own line's rate is left for a human to
 * pick. This action cannot make the same choice: its entire acceptance criterion is "the sum of the
 * generated invoices' gross totals equals the quote's gross, EXACTLY" — a promise that only holds
 * because ONE rate is known here, since each milestone's net is derived from the gross it must reach
 * THROUGH that rate (see computeMilestoneSplit's own header). A per-milestone UNKNOWN or GUESSED rate
 * would silently break that promise the moment the invoice is actually issued and its VAT gets
 * computed for real. So a quote whose lines carry MORE THAN ONE rate is refused outright here, named
 * plainly, rather than quietly generating invoices that will not actually sum to the quote's own TTC.
 *
 * Loads the quote ONCE (unlike calling quote-to-invoice.ts's `createDraftInvoiceFromQuote` N times,
 * which would reload it — and its totals — on every single call for no reason) and persists each
 * milestone's invoice directly through `findOwnedDocument`/`upsertDocument`, the same primitives
 * `createDraftInvoiceFromQuote` itself is built on.
 */
export function registerRequestInstallmentsAction(registry: ActionRegistry): void {
  registry.register('quote', 'request-installments', async ({ companyId, documentId, params }) => {
    if (!documentId) {
      // Unreachable in practice — the descriptor's own `availableWhen` already refuses this before
      // the handler runs (a never-saved record has no status to match) — but a handler never trusts
      // that alone, the same discipline quote-to-invoice.ts's own identical guard documents.
      throw new Error('Cannot generate installment invoices for a quote that has not been saved yet.');
    }

    // Already proven a well-formed list of { percent: number, dueDate: string } rows by the 'array'
    // param's own `fields` (percent: 'number', dueDate: 'date') — validateAgainstDescriptor recurses
    // into every row before this handler ever runs (descriptors/validate.ts). Only the shapes this
    // handler actually reads are picked back out here.
    const rawMilestones = Array.isArray(params.milestones)
      ? (params.milestones as Record<string, unknown>[])
      : [];
    const milestones: MilestoneInput[] = rawMilestones.map((row) => ({
      percent: row.percent as number,
      dueDate: row.dueDate as string,
    }));

    const quote = await findOwnedDocument(companyId, 'quote', documentId);
    const quoteData = (quote.data ?? {}) as Record<string, unknown>;

    const currency = typeof quoteData.currency === 'string' ? quoteData.currency : undefined;
    if (!currency) {
      throw new BadRequestException(
        `Quote "${quote.id}" has no currency recorded — cannot split it into installments.`,
      );
    }

    const quoteTotals = computeDocumentTotals(QUOTE_DESCRIPTOR, quoteData);

    // See this file's own header, "The single-VAT-rate constraint" — the honest refusal a per-
    // milestone unknown rate would otherwise force on us.
    if (quoteTotals.vatBreakdown.length > 1) {
      throw new BadRequestException(
        "la génération d'échéances nécessite un taux de TVA unique sur le devis — ce devis en " +
          "mélange plusieurs ; scindez-le d'abord",
      );
    }
    // Zero rates (no VAT anywhere on the quote) is a perfectly fine, unambiguous case: rate 0, no
    // choice was ever being punted on. Exactly one rate reuses that one candidate.
    const vatRatePercent =
      quoteTotals.vatBreakdown.length === 1 ? quoteTotals.vatBreakdown[0].ratePercent : 0;
    const vatRateStr = String(vatRatePercent);

    const split = computeMilestoneSplit(
      quoteTotals.netMinor,
      quoteTotals.grossMinor,
      vatRatePercent,
      milestones,
    );
    const quoteLabel = quote.displayNumber ?? quote.id;

    let firstInvoice: DocumentInstanceResult | undefined;
    for (let index = 0; index < split.length; index++) {
      const entry = split[index];
      const invoiceData = {
        client: quoteData.client,
        issueDate: new Date().toISOString(),
        dueDate: entry.dueDate,
        currency,
        notes: quoteData.notes,
        origin: { entity: 'quote', id: quote.id },
        lines: [
          {
            description: `Échéance ${index + 1}/${split.length} (${entry.percent}% de ${quoteLabel})`,
            quantity: 1,
            unit: 'unit',
            unitPrice: fromMinor(entry.netMinor, currency),
            vatRate: vatRateStr,
          },
        ],
      };
      // Each call creates a brand-new draft (documentId: undefined) — N milestones, N invoices, never
      // one invoice updated N times.
      const invoice = await upsertDocument(companyId, 'invoice', undefined, 'draft', invoiceData);
      if (!firstInvoice) firstInvoice = invoice;
    }

    // Read off the INVOICES (each entry's `grossMinor` is what its own invoice recomputes — see
    // `MilestoneSplitEntry`), never off the quote: the figure announced to whoever ran this action is
    // the one their client will be asked for. It equals the quote's own gross because
    // `computeMilestoneSplit` refuses to return a split where it would not, so the sentence below
    // states a checked fact rather than an assumption about how the division fell.
    const combinedGrossDisplay = fromMinor(
      split.reduce((sum, entry) => sum + entry.grossMinor, 0),
      currency,
    );

    return {
      // The QUOTE itself never changes (this action's entire effect is N brand-new invoices
      // elsewhere, exactly like "convert-to-invoice"/"request-deposit" before it) — but the ActionResult
      // envelope only ever carries ONE document, so, following request-deposit.ts's own precedent
      // (returning the newly-created invoice, not the unchanged acted-upon quote), this returns the
      // FIRST created invoice: `useDocumentActionRunner` (frontend) already knows to navigate to a
      // foreign document type's own page when `document.typeId` differs from the acting type, which is
      // exactly the useful behavior here too (landing on the invoices list, where all N now show up).
      document: firstInvoice,
      changed: true,
      message: `${split.length} draft invoices created from quote ${quoteLabel} — they total ${combinedGrossDisplay} ${currency} to pay, the quote's own gross total, to the cent.`,
    };
  });
}
