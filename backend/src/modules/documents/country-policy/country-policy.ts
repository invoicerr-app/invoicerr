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

import { defaultCountryPolicyCatalog } from './registry';

export interface CountryPolicyDecision {
  allowed: boolean;
  /** Present only when allowed=false — human-facing PLAIN TEXT (same convention as
   *  ActionResult.message elsewhere in this module, not an i18n key): names the country and says
   *  what would unblock it, so the frontend can show it verbatim without knowing any country. */
  reason?: string;
  /**
   * Present only when allowed=true AND the matching rule narrows itself to specific statuses (see
   * schema.ts's `DocumentActionRuleFact.statuses`) — the STATUS ids the action may run from, on top
   * of whatever the document type's own `availableWhen`/lifecycle already requires. Absent means the
   * country imposes no extra narrowing beyond the type's own rules.
   *
   * documents.service.ts's `runAction` composes this with `isActionAvailable` into the SAME 409
   * "not available for this status" refusal `availableWhen` already produces — deliberately not its
   * own 403: the action IS permitted by the country in principle, just not from this status, which
   * is exactly what a 409 (a status/state conflict) means elsewhere in this module already.
   */
  restrictedToStatuses?: string[];
}

/** Where a human adds the missing file — spelled out in the block message itself, the same way
 *  invoice-actions.ts's transport block says "configure one in company settings" instead of just
 *  refusing. */
const DATA_DIR_HINT = 'backend/src/modules/documents/country-policy/data';

/**
 * The company/country resolution `evaluateCountryPolicy` and `resolveAvailableDocumentTypes` each
 * already inline — extracted here as a THIRD, independent copy for country-fields/ and vat-rates/'s
 * own consumer (descriptors/company-view.ts, wired through documents.service.ts) to use, rather than
 * refactoring either of the two functions below to share it. This mirrors
 * `resolveAvailableDocumentTypes`'s own documented choice to duplicate rather than share
 * ("that function's exact wording is pinned by country-policy.spec.ts, and this one needs a
 * DIFFERENT reason message [...] a shared helper would either have to parameterize the message
 * anyway or risk perturbing the already-tested one") — the same argument applies a third time: this
 * caller needs no "unresolved" ERROR MESSAGE at all (unlike the two below), only the bare code or
 * `undefined`, so folding it into either existing function would mean adding a branch neither one
 * needs for its own callers.
 */
export async function resolveCompanyCountryCode(companyId: string): Promise<string | undefined> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { country: true, countryCode: true },
  });

  const resolvedCode = (company?.countryCode || guessCountryCode(company?.country ?? undefined) || '')
    .trim()
    .toUpperCase();

  return resolvedCode || undefined;
}

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

  // `statuses` is meaningless on a forbidden rule (handled above) — only ever read here, once the
  // rule is already known to allow the action at all. See schema.ts's own comment on the field.
  const restrictedToStatuses =
    Array.isArray(rule.statuses) && rule.statuses.length > 0 ? rule.statuses : undefined;
  return restrictedToStatuses ? { allowed: true, restrictedToStatuses } : { allowed: true };
}

export interface AvailableDocumentTypesDecision {
  typeIds: string[];
  /** Present, and `typeIds` empty, when the country cannot be resolved or has no document-type
   *  policy declared at all — plain text, same convention as CountryPolicyDecision.reason: never a
   *  silently empty list with no explanation. */
  reason?: string;
}

/**
 * Which document types the active company's COUNTRY makes available at all — the READ side of the
 * NEW `documentTypes` layer (schema.ts, registry.ts's `typesFor`), sitting next to
 * `evaluateCountryPolicy` above rather than folded into it: this answers "which types exist for this
 * country", not "may this ACTION run on this type", a genuinely different question with its own
 * empty/unresolved cases.
 *
 * Deliberately reads the in-memory CATALOG (`defaultCountryPolicyCatalog.typesFor`), not a database
 * table the way `evaluateCountryPolicy` reads `DocumentCountryActionRule`: that DB indirection exists
 * for the per-ACTION policy so it can be inspected/seeded/audited as data of its own; this list is a
 * lighter product decision ("what does the sidebar show") with no such need yet. Should that change
 * (e.g. a future admin screen editing this list at runtime), promote it to a seeded table the exact
 * same way the action rules already are — nothing here would need to change shape to get there.
 *
 * The company/country resolution below deliberately duplicates evaluateCountryPolicy's own few lines
 * rather than sharing a helper: that function's exact wording is pinned by
 * country-policy.spec.ts, and this one needs a DIFFERENT reason message (no rules table to blame,
 * only a missing `documentTypes` declaration) — a shared helper would either have to parameterize the
 * message anyway or risk perturbing the already-tested one for a few lines of reuse.
 */
export async function resolveAvailableDocumentTypes(
  companyId: string,
): Promise<AvailableDocumentTypesDecision> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { country: true, countryCode: true },
  });

  const resolvedCode = (company?.countryCode || guessCountryCode(company?.country ?? undefined) || '')
    .trim()
    .toUpperCase();

  if (!resolvedCode) {
    return {
      typeIds: [],
      reason:
        `This company's country ("${company?.country ?? 'unknown'}") does not resolve to a ` +
        'recognized ISO 3166-1 country code, so no document types can be determined for it. Set an ' +
        'explicit country code in company settings, or use a recognized country name.',
    };
  }

  const typeIds = defaultCountryPolicyCatalog.typesFor(resolvedCode);
  if (typeIds.length === 0) {
    return {
      typeIds: [],
      reason:
        `No document types are declared for "${resolvedCode}" — every document type is hidden for ` +
        `a company in this country until one is. To unblock it, add "documentTypes" to ` +
        `${DATA_DIR_HINT}/${resolvedCode.toLowerCase()}.json (see fr.json/us.json in that directory ` +
        'for the format).',
    };
  }

  return { typeIds };
}
