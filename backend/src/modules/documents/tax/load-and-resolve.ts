/**
 * The ONE Prisma-aware entry point for the cross-border tax wiring — loads exactly the facts
 * `resolve-invoice-tax.ts` needs (seller/buyer country, buyer VAT + its STORED validation verdict —
 * never a live VIES call, see `clients.service.ts`'s own header on why that happens at save time) and
 * calls the pure resolver. `invoice-actions.ts`'s preflight and `deliver()` both call THIS function.
 * `documents.service.ts#downloadDocumentFormat` does not — it already has the full company/client rows
 * (with `partyIdentifiers`) for building the format itself, so it calls `resolveInvoiceCrossBorderTax`
 * directly on those rather than a second round trip through here (see that call site's own comment) —
 * which means any fact this function starts reading (like `exemptVat` below) has to be read there too,
 * kept in sync by hand rather than automatically shared.
 */
import prisma from '@/prisma/prisma.service';

import { resolveInvoiceCrossBorderTax, ResolveInvoiceCrossBorderTaxResult } from './resolve-invoice-tax';

export async function resolveInvoiceCrossBorderTaxForCompany(
  companyId: string,
  data: Record<string, unknown>,
): Promise<ResolveInvoiceCrossBorderTaxResult> {
  const clientId = typeof data.client === 'string' ? data.client : undefined;

  const [company, client] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { country: true, countryCode: true, exemptVat: true },
    }),
    clientId
      ? prisma.client.findFirst({
          // Scoped by companyId, not a bare `id` lookup: `clientId` comes straight out of the
          // document's own `data.client` reference field, which is never checked against the entity
          // at write time for existence alone (descriptors/field-kinds.ts's own comment on the
          // 'reference' kind) — an id naming ANOTHER company's client must resolve to nothing here,
          // never to that other tenant's real country/VAT, which a bare `findUnique` would happily
          // hand back. A `null` client is already the exact, hard-blocking "unresolved buyer country"
          // path just below (never a silent guess) — see this file's own header.
          where: { id: clientId, companyId },
          select: {
            country: true,
            countryCode: true,
            partyIdentifiers: { where: { scheme: 'VAT' }, select: { value: true, validationStatus: true } },
          },
        })
      : Promise.resolve(null),
  ]);

  const buyerVatRow = client?.partyIdentifiers?.[0];

  return resolveInvoiceCrossBorderTax({
    // An unresolvable/absent SELLER company (never configured, or a country row that cannot be
    // resolved) resolves to an unresolved seller country, which is the named hard block USER DECISION
    // (2026-09-01) requires — `resolve-invoice-tax.ts`'s own `UnresolvedSellerCountryError` — never a
    // silent fallback to FR, same discipline the buyer side already held below.
    seller: {
      country: company?.country,
      countryCode: company?.countryCode,
      // `Company.exemptVat` (`schema.prisma`) is a bare boolean toggled from Settings → Company. The
      // checkbox's own description (`frontend/src/locales/en/translation.json`,
      // `settings.company.form.exemptVat.description`) promises the small-business VAT exemption
      // notice (art. 293 B of the CGI in France, a country-specific or generic wording elsewhere —
      // see `tax-engine.ts`'s own `MENTION` map) — that is exactly the `FRANCHISE_BASE` scheme, never
      // `'EXEMPT'` (a stronger claim — "no VAT system applies to this seller at all" — this checkbox
      // never makes and this product has no UI for). This mapping is the fix for the SECOND of the
      // three independent breaks that used to let this checkbox do nothing at all: the value was
      // persisted and read by the DTO/frontend, but no backend code ever read it back — see this
      // file's own header, "the ONE Prisma-aware entry point", for why here is where that has to
      // happen.
      taxScheme: company?.exemptVat ? 'FRANCHISE_BASE' : undefined,
    },
    // No client row at all (a data problem `documents.service.ts`'s own validation already catches
    // earlier — `client` is a required field) resolves to an unresolved buyer country, which is
    // EXACTLY the named hard block `resolve-invoice-tax.ts` requires — never a second, silent code path.
    buyer: { country: client?.country, countryCode: client?.countryCode },
    buyerVat: buyerVatRow
      ? { value: buyerVatRow.value, validationStatus: buyerVatRow.validationStatus }
      : undefined,
    data,
  });
}
