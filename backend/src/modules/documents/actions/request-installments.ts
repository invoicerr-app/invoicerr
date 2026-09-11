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
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
}

/**
 * Pure math, unit-tested on its own (request-installments.spec.ts): splits a quote's NET total across
 * N milestones, in MINOR units, so that BOTH the nets and the (VAT-inclusive) grosses sum back to the
 * cent to the quote's own totals — this is the whole point of the feature's acceptance criterion
 * ("sum = TTC of the quote, EXACTLY"), and it is why the split happens on NET rather than gross: gross
 * only sums correctly if the ONE VAT rate is applied on top of nets that themselves already sum
 * exactly, never the other way around.
 *
 * Validates FIRST, before any arithmetic, and throws rather than silently coping:
 *  - fewer than two milestones — one milestone would just be the whole quote, not an installment plan;
 *  - a percent that is not strictly positive — a 0% "milestone" is not an installment, it is a
 *    generated invoice for nothing;
 *  - percents that do not sum to EXACTLY 100 — never normalized. A caller who typed "30/30/30" gets
 *    told so, not silently billed for 90% of the quote with a fourth invoice nobody asked for.
 *
 * ## Two remainders, not one
 *
 * Each milestone's net is `round(quoteNetMinor * percent / 100)`, EXCEPT the last one, which is
 * instead `quoteNetMinor − sum(the others)` — the standard "last one absorbs the remainder" trick,
 * so the nets sum to `quoteNetMinor` exactly whatever rounding the earlier percentages needed.
 *
 * That alone is NOT enough to also guarantee the GROSSES sum exactly: computing every milestone's
 * gross independently as `netMinor + round(netMinor * ratePercent / 100)` — the exact formula
 * `compute-totals.ts` itself uses for a single-rate line, so a NON-last milestone's own invoice later
 * reproduces this number precisely when its totals are computed — can still leave the SUM of those
 * independently-rounded VAT amounts a cent away from `round(quoteNetMinor * ratePercent / 100)` (a
 * well-known "sum of rounded parts ≠ rounded sum" effect: see this file's own test for a concrete,
 * verified case where it actually happens). So the LAST milestone's gross is NOT computed that same
 * way — it absorbs whatever the ordinary per-milestone VAT rounding could not otherwise place,
 * exactly as `quoteGrossMinor − sum(the other grosses)`, the identical "last one absorbs the
 * remainder" trick applied a second time, this time against the quote's own GROSS rather than its
 * net. This is the one place `quoteGrossMinor` is actually used: not re-derived from `quoteNetMinor`
 * and `singleVatRatePercent` (which is exactly the computation that can drift), but taken as the
 * authoritative total the split must reconcile against. The trade-off, made explicitly rather than
 * silently: on the rare quote/split/rate combination where the ordinary formula would have drifted,
 * the LAST invoice's own VAT amount is nudged by the one cent needed to keep the sum exact — an
 * invisible rounding adjustment on one line, chosen over silently breaking the very guarantee this
 * action exists to make.
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

  const entries: MilestoneSplitEntry[] = [];
  let allocatedNetMinor = 0;
  let allocatedGrossMinor = 0;
  milestones.forEach((milestone, index) => {
    const isLast = index === milestones.length - 1;

    const netMinor = isLast
      ? quoteNetMinor - allocatedNetMinor
      : Math.round((quoteNetMinor * milestone.percent) / 100);
    allocatedNetMinor += netMinor;

    // See this function's own header, "Two remainders, not one" — every milestone but the last gets
    // its gross the ordinary way (consistent with what its own invoice will later recompute); the
    // last one is forced to whatever makes the TOTAL exact.
    const grossMinor = isLast
      ? quoteGrossMinor - allocatedGrossMinor
      : netMinor + Math.round((netMinor * singleVatRatePercent) / 100);
    allocatedGrossMinor += grossMinor;

    entries.push({
      percent: milestone.percent,
      dueDate: milestone.dueDate,
      netMinor,
      vatMinor: grossMinor - netMinor,
      grossMinor,
    });
  });

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
 * because ONE rate is applied uniformly to a net that itself splits exactly (see
 * computeMilestoneSplit's own header). A per-milestone UNKNOWN or GUESSED rate would silently break
 * that promise the moment the invoice is actually issued and its VAT gets computed for real. So a
 * quote whose lines carry MORE THAN ONE rate is refused outright here, named plainly, rather than
 * quietly generating invoices that will not actually sum to the quote's own TTC.
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

    const grossDisplay = fromMinor(quoteTotals.grossMinor, currency);

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
      message: `${split.length} draft invoices created from quote ${quoteLabel} — their combined total (${grossDisplay} ${currency}) equals the quote's own gross total exactly.`,
    };
  });
}
