/**
 * The ONE Prisma-aware entry point for root TODO item 16's wiring — loads exactly the facts
 * `resolve-invoice-tax.ts` needs (seller/buyer country, buyer VAT + its STORED validation verdict —
 * never a live VIES call, see `clients.service.ts`'s own header on why that happens at save time) and
 * calls the pure resolver. Both real call sites (`invoice-actions.ts`'s preflight and `deliver()`, and
 * `documents.service.ts#downloadDocumentFormat`) share this so the query shape never drifts between
 * them — a real risk given all three need the SAME two rows, fetched independently before this file
 * existed.
 */
import prisma from '@/prisma/prisma.service';

import { resolveInvoiceCrossBorderTax, ResolveInvoiceCrossBorderTaxResult } from './resolve-invoice-tax';

export async function resolveInvoiceCrossBorderTaxForCompany(
  companyId: string,
  data: Record<string, unknown>,
): Promise<ResolveInvoiceCrossBorderTaxResult> {
  const clientId = typeof data.client === 'string' ? data.client : undefined;

  const [company, client] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { country: true, countryCode: true } }),
    clientId
      ? prisma.client.findUnique({
          where: { id: clientId },
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
    seller: { country: company?.country, countryCode: company?.countryCode },
    // No client row at all (a data problem `documents.service.ts`'s own validation already catches
    // earlier — `client` is a required field) resolves to an unresolved buyer country, which is
    // EXACTLY the named hard block this task requires — never a second, silent code path.
    buyer: { country: client?.country, countryCode: client?.countryCode },
    buyerVat: buyerVatRow
      ? { value: buyerVatRow.value, validationStatus: buyerVatRow.validationStatus }
      : undefined,
    data,
  });
}
