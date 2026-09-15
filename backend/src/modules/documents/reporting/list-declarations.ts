/**
 * Company-scoped read of every DECLARATION event journaled onto the existing `DocumentAuthorityEvent`
 * table — the "Declarations" screen's own backing query (`GET /documents/declarations`). No new
 * table, no migration: `reporting-runner.ts` already journals a "pt-at" success/rejection there, and
 * `recordTerminalFailure` already journals `report:blocked`/`report:failed` the exact same way — this
 * file is a pure READ, added because nothing exposed that journal at the COMPANY level before (only
 * per-document, via `conformity/authority-events.persistence.ts#listAuthorityEvents`).
 *
 * ## Telling a "declaration" apart from an ordinary conformity poll event
 *
 * `DocumentAuthorityEvent` also carries post-deposit conformity poll results (pdp/ksef/chorus-pro —
 * see that table's own schema comment) — a COMPLETELY different concept: an external platform's
 * opinion about a delivery that already happened, never a tax-authority declaration about the
 * invoice's DATA (see `report-on-send.ts`'s own header on why the two are architectural cousins, never
 * the same thing). The two are told apart by `providerId`: a declaration only ever uses a `providerId`
 * some country's own `reporting/data/*.json` file names — never a hand-maintained list of "the ones I
 * remember", so a future country's reporting fact is picked up automatically, the same "a country is
 * data" discipline every sibling catalog in this module already holds.
 */
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { defaultReportingObligationCatalog, ReportingObligationCatalog } from './registry';

const PAGE_SIZE = 10;

/** Every `providerId` ANY country's `reporting/data/*.json` file names — the authoritative boundary
 *  between "a declaration" and "an ordinary conformity poll event" (see this file's own header).
 *  Recomputed on every call, no caching: the same "read straight from these small files, there is no
 *  per-request performance case that would justify a mirror" tradeoff `ReportingObligationCatalog`'s
 *  own header already documents, applied here to a derived index rather than the facts themselves. */
export function declarationProviderIds(
  files: typeof ALL_REPORTING_OBLIGATION_FILES = ALL_REPORTING_OBLIGATION_FILES,
): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    for (const fact of file.facts) ids.add(fact.providerId);
  }
  return Array.from(ids);
}

/** The ONE country whose own `reporting/data/*.json` file names this providerId — shown next to each
 *  declaration so the screen never has to re-derive a country from anything else (the document's own
 *  seller country at declaration time could, in principle, have since changed on the company record;
 *  this names the country the OBLIGATION itself belongs to). `undefined` only if a providerId a
 *  historical event still carries was later removed from every country file — never happens today,
 *  but a real possibility this function does not paper over with a guess. */
function countryCodeForProvider(
  providerId: string,
  files: typeof ALL_REPORTING_OBLIGATION_FILES = ALL_REPORTING_OBLIGATION_FILES,
): string | undefined {
  return files.find((file) => file.facts.some((fact) => fact.providerId === providerId))?.countryCode;
}

export interface DeclarationListEntry {
  id: string;
  documentId: string;
  typeId: string;
  /** Mirrors `DocumentInstance.displayNumber` — null for a document that somehow never entered
   *  numbering (unreachable for a genuinely SENT/declared invoice, but never assumed). */
  displayNumber: string | null;
  providerId: string;
  countryCode: string | undefined;
  /** The platform/bridge's own status vocabulary — e.g. "ACCEPTED"/"REJECTED" (pt-at), or this
   *  mechanism's own synthetic "report:blocked"/"report:failed" (`report-job.ts`). Shown verbatim,
   *  never translated — same convention as `DocumentAuthorityEvent.statusText` itself. */
  statusCode: string;
  statusText: string | null;
  /** Populated on a rejection/blocked/failed declaration — the human-facing error the screen must
   *  show. Null for a genuine success, which carries no "reason" in the first place. */
  reason: string | null;
  observedAt: Date;
}

export interface ListDeclarationsResult {
  declarations: DeclarationListEntry[];
  pageCount: number;
  /** Every DISTINCT statusCode ever journaled for this company's OWN declarations — always computed
   *  over the FULL, unfiltered set (never narrowed by the `status` argument itself), so the filter's
   *  own option list never shrinks the moment a filter is applied. Empty for a company with zero
   *  declarations so far. */
  statusCodes: string[];
  /** Whether the active company's OWN country has ANY reporting obligation declared at all (any fact
   *  in its `reporting/data/*.json` file) — what lets the screen say "no declaration obligation for
   *  this country" plainly, rather than showing a permanently empty list with no explanation.
   *  `undefined` only when the company's own country cannot even be resolved (same "no permissive
   *  guess" posture `country-policy.ts` holds everywhere else). */
  hasObligation: boolean | undefined;
}

/**
 * `page` is 1-indexed (same convention as `clients.service.ts#getClients`); a value below 1 or
 * non-finite falls back to 1, never a negative `skip`. `status`, when given, narrows to an EXACT
 * `statusCode` match — this mechanism's status vocabulary is small and provider-defined (see
 * `DeclarationListEntry.statusCode`'s own comment), never worth a fuzzy match.
 */
export async function listDeclarations(
  companyId: string,
  page: number,
  status: string | undefined,
  catalog: ReportingObligationCatalog = defaultReportingObligationCatalog,
): Promise<ListDeclarationsResult> {
  const providerIds = declarationProviderIds();
  const pageNumber = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const skip = (pageNumber - 1) * PAGE_SIZE;

  const where: Prisma.DocumentAuthorityEventWhereInput = {
    companyId,
    providerId: { in: providerIds },
    ...(status ? { statusCode: status } : {}),
  };

  // No country in the ENTIRE codebase has ever declared a reporting obligation with an empty
  // `providerId` in list form — but `providerId: { in: [] }` would still be a well-formed query that
  // simply matches nothing; skipping it outright avoids three round-trips a brand-new checkout with no
  // `reporting/data/*.json` file at all (unreachable today — PT ships one — but not assumed) would
  // otherwise pay for nothing.
  const [rows, total, distinctRows, companyCountryCode] = await Promise.all([
    providerIds.length === 0
      ? Promise.resolve([])
      : prisma.documentAuthorityEvent.findMany({
          where,
          select: {
            id: true,
            documentId: true,
            providerId: true,
            statusCode: true,
            statusText: true,
            reason: true,
            observedAt: true,
            document: { select: { typeId: true, displayNumber: true } },
          },
          orderBy: { observedAt: 'desc' },
          skip,
          take: PAGE_SIZE,
        }),
    providerIds.length === 0 ? Promise.resolve(0) : prisma.documentAuthorityEvent.count({ where }),
    providerIds.length === 0
      ? Promise.resolve([])
      : prisma.documentAuthorityEvent.findMany({
          where: { companyId, providerId: { in: providerIds } },
          select: { statusCode: true },
          distinct: ['statusCode'],
        }),
    resolveCompanyCountryCode(companyId),
  ]);

  return {
    declarations: rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      typeId: row.document.typeId,
      displayNumber: row.document.displayNumber,
      providerId: row.providerId,
      countryCode: countryCodeForProvider(row.providerId),
      statusCode: row.statusCode,
      statusText: row.statusText,
      reason: row.reason,
      observedAt: row.observedAt,
    })),
    pageCount: Math.ceil(total / PAGE_SIZE),
    statusCodes: distinctRows.map((row) => row.statusCode).sort(),
    hasObligation: companyCountryCode ? catalog.factsFor(companyCountryCode).length > 0 : undefined,
  };
}
