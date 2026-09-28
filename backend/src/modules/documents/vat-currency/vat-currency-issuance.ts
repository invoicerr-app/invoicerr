/**
 * The DB/queue-facing wiring for issue #517: the two rate clients and the pure resolver
 * (`resolve-vat-currency.ts`) meet an actual invoice here, exactly the split
 * `tax/resolve-invoice-tax.ts` (the engine) vs. `actions/invoice-actions.ts` (the wiring) already
 * holds one concern over, and the exact same two-entry-point shape `actions/atcud-issuance.ts`
 * already established for a different per-country freeze-at-issuance fact:
 *
 *  - `runVatCurrencyPreflight`: runs from "send"'s own preflight (`invoice-actions.ts`), AFTER
 *    `runInvoiceCrossBorderTaxPreflight` has already resolved the document's real VAT (a
 *    cross-border line's rate can change between the draft and the resolved "sending" record, so this
 *    must convert the RESOLVED totals, never the draft's own). This is the LOAD-BEARING gate: a
 *    country requiring the conversion with no rate available (Poland's own NBP table A, primarily,
 *    see `resolve-vat-currency.ts`'s own header) refuses the send with a `BadRequestException`,
 *    BEFORE `numberOnEnqueue` can ever spend a sequence number this codebase can never hand back
 *    (`numbering/sequence.ts`'s own "never waste a number" header), the identical posture
 *    `atcud-issuance.ts#ensureAtcudIssuable` already holds for Portugal's own ATCUD. The resolved
 *    conversion (when there is one) is stashed on the RETURNED data as a `__vatNationalCurrency`
 *    sidecar, the same internal, server-only convention `tax/resolve-invoice-tax.ts`'s own
 *    `__crossBorderCategory`/`__crossBorderMentions` already use, generically stripped by
 *    `descriptors/validate.ts#stripSidecarKeys` for any caller that is not this server's own
 *    "sending" replay. `attachVatNationalCurrencyToNumberedDocument` below then reads back EXACTLY the
 *    figure this preflight already approved, rather than resolving the rate a second time (which
 *    would cost a second pair of ECB/NBP HTTP calls per send for no real benefit, since both rate
 *    sources are dated/deterministic for the same `issueDate` either way).
 *  - `attachVatNationalCurrencyToNumberedDocument`: wired as `async-send.ts`'s `onNumbered` hook,
 *    alongside `atcud-issuance.ts#attachAtcudToNumberedDocument`. Reads the sidecar the preflight
 *    just stashed and persists it onto `DocumentInstance`'s five `vatNationalCurrency*` columns, a
 *    pure re-check of what the preflight already approved, so (mirroring that file's own header
 *    verbatim) this NEVER throws: any failure here is logged loudly instead, the document still
 *    sends, printing without a converted VAT line, which is the honest degraded outcome, never a
 *    silently wrong one.
 *
 * Both are no-ops for every invoice whose seller country has no active requirement at all
 * (`resolveVatCurrencyConversion` returning `null`): a single lookup, no further reads, no further
 * writes, exactly like `atcud-issuance.ts`'s own non-Portugal fast path.
 */
import { BadRequestException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { toDateOnly } from '../formats/shared-build';
import { computeDocumentTotals } from '../totals/compute-totals';
import {
  resolveVatCurrencyConversion,
  VatCurrencyConversion,
  VatCurrencyRateUnavailableError,
} from './resolve-vat-currency';

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** Internal, server-only convention, see this file's own header. Never a descriptor field. */
const SIDECAR_KEY = '__vatNationalCurrency';

export function isVatCurrencyBlockError(error: unknown): error is VatCurrencyRateUnavailableError {
  return error instanceof VatCurrencyRateUnavailableError;
}

/**
 * The preflight gate, see this file's own header. Always returns a NEW `data` object (never
 * mutates), with the stale sidecar from any earlier attempt replaced (or removed, when this send no
 * longer needs one, e.g. a retry after the invoice's own currency field was edited between a
 * "send_failed" and the next "send"). Throws `BadRequestException`, via `isVatCurrencyBlockError`,
 * for the one named, load-bearing refusal (`VatCurrencyRateUnavailableError`); any other error
 * (a network failure reaching ECB/NBP, a malformed response) propagates unwrapped, surfacing as a
 * genuine 500 rather than being misreported as "no rate exists".
 */
export async function runVatCurrencyPreflight(
  companyId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { [SIDECAR_KEY]: _stale, ...rest } = data;
  try {
    const countryCode = (await resolveCompanyCountryCode(companyId)) ?? '';
    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, data);
    const issueDate = toDateOnly(data.issueDate);
    const conversion = await resolveVatCurrencyConversion(countryCode, totals.currency ?? 'EUR', issueDate, {
      netMinor: totals.netMinor,
      vatMinor: totals.vatMinor,
    });
    if (!conversion) return rest;
    return { ...rest, [SIDECAR_KEY]: conversion };
  } catch (error) {
    if (isVatCurrencyBlockError(error)) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/**
 * Computes and freezes the VAT-currency conversion onto a JUST-numbered document, see this file's
 * own header for why this never throws. Reads the `__vatNationalCurrency` sidecar the preflight
 * already stashed on `numbered`'s own originating `data`; a document with none (nothing to convert,
 * or this write path never went through `runVatCurrencyPreflight` at all, see the caller parameter
 * doc below) leaves every one of the five columns untouched (they default to `null`, exactly the
 * "not applicable" state this feature was already in before this send).
 */
export async function attachVatNationalCurrencyToNumberedDocument(
  documentId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const conversion = data[SIDECAR_KEY] as VatCurrencyConversion | undefined;
  if (!conversion) return;

  try {
    await prisma.documentInstance.update({
      where: { id: documentId },
      data: {
        vatNationalCurrency: conversion.nationalCurrency,
        vatNationalCurrencyTaxableMinor: conversion.taxableMinor,
        vatNationalCurrencyVatMinor: conversion.vatMinor,
        vatNationalCurrencyRate: conversion.rate,
        vatNationalCurrencyRateAsOf: new Date(`${conversion.rateAsOf}T00:00:00Z`),
        vatNationalCurrencyRateSource: conversion.rateSource,
      },
    });
  } catch (error) {
    logger.error(
      'Failed to attach the VAT-national-currency conversion to a numbered invoice - it will print ' +
        'without one. The "send" preflight (runVatCurrencyPreflight) already approved this exact ' +
        'conversion moments earlier; reaching here means the write itself failed (e.g. a transient DB ' +
        'error), not that the rate became unavailable.',
      {
        category: 'documents',
        details: { documentId, message: error instanceof Error ? error.message : String(error) },
      },
    );
  }
}
