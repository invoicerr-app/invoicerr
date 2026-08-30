/**
 * The READ side of the document-action policy (backend/src/modules/documents/country-policy/) — the
 * WRITE side is `seedCountryPolicies()` (seed.ts), the only thing that ever creates/updates/deletes a
 * `DocumentCountryActionRule` row. This module never writes: the table is a mirror of the reference
 * files (data/fr.json, data/us.json, …), not user-editable data.
 *
 * A plain function reading the Prisma singleton directly, not an injectable class — the same
 * convention `company-transport.ts`'s `getCompanyInvoiceTransportId` already established for "read
 * one fact about a company, decide": no new DI token, mockable with `jest.mock` the exact same way.
 * `documents.service.ts` calls this directly.
 *
 * DECISION 1 (the one this whole module exists to enforce): a company whose country has NO policy
 * file at all gets EVERY document action blocked — no permissive fallback, no silent default. The
 * three refusal messages below are deliberately distinct (unresolvable country code / no country
 * file / action not declared for a country that DOES have a file) because each names a different
 * fix, the same discipline invoice-actions.ts's "no transport configured" 501 already follows.
 */
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

export interface CountryPolicyDecision {
  allowed: boolean;
  /** Present only when allowed=false — human-facing PLAIN TEXT (same convention as
   *  ActionResult.message elsewhere in this module, not an i18n key): names the country and says
   *  what would unblock it, so the frontend can show it verbatim without knowing any country. */
  reason?: string;
}

/** Where a human adds the missing file — spelled out in the block message itself, the same way
 *  invoice-actions.ts's transport block says "configure one in company settings" instead of just
 *  refusing. */
const DATA_DIR_HINT = 'backend/src/modules/documents/country-policy/data';

export async function evaluateCountryPolicy(
  companyId: string,
  typeId: string,
  actionId: string,
): Promise<CountryPolicyDecision> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { country: true, countryCode: true },
  });

  const resolvedCode = (company?.countryCode || guessCountryCode(company?.country ?? undefined) || '')
    .trim()
    .toUpperCase();

  if (!resolvedCode) {
    return {
      allowed: false,
      reason:
        `This company's country ("${company?.country ?? 'unknown'}") does not resolve to a ` +
        'recognized ISO 3166-1 country code, so no document action policy can be found for it. ' +
        'Set an explicit country code in company settings, or use a recognized country name.',
    };
  }

  const rules = await prisma.documentCountryActionRule.findMany({ where: { countryCode: resolvedCode } });
  if (rules.length === 0) {
    return {
      allowed: false,
      reason:
        `No document action policy is declared for "${resolvedCode}" — every document action is ` +
        'blocked for a company in this country until one is. To unblock it, add ' +
        `${DATA_DIR_HINT}/${resolvedCode.toLowerCase()}.json (see fr.json/us.json in that directory ` +
        'for the format) and reseed.',
    };
  }

  const rule = rules.find((r) => r.typeId === typeId && r.actionId === actionId);
  if (!rule) {
    return {
      allowed: false,
      reason:
        `Action "${actionId}" of document type "${typeId}" is not declared in the "${resolvedCode}" ` +
        'document action policy, so it is refused by default. Add a rule for it in ' +
        `${DATA_DIR_HINT}/${resolvedCode.toLowerCase()}.json and reseed to allow it.`,
    };
  }

  if (!rule.allowed) {
    const grounding =
      rule.provenanceKind === 'legal' && rule.sourceText
        ? ` (${rule.sourceText})`
        : rule.resolutionNote
          ? ` (unverified — ${rule.resolutionNote})`
          : '';
    return {
      allowed: false,
      reason: `Action "${actionId}" of document type "${typeId}" is forbidden for "${resolvedCode}"${grounding}.`,
    };
  }

  return { allowed: true };
}
