/**
 * The READ side of the country identifier-requirements catalog
 * (backend/src/modules/documents/country-identifiers/) — the WRITE side is
 * `seedCountryIdentifierRequirements()` (seed.ts), the only thing that ever creates/updates/deletes
 * a `CountryIdentifierRequirement` row. This module never writes: the table is a mirror of the
 * reference files (data/fr.json, data/us.json, …), not user-editable data — same split as
 * country-policy/country-policy.ts, for the same reason.
 *
 * A plain function reading the Prisma singleton directly, not an injectable class — see
 * country-policy.ts's own header for why (mockable with `jest.mock` the exact same way, no new DI
 * token). documents.service.ts calls this directly.
 *
 * Unlike evaluateCountryPolicy/resolveAvailableDocumentTypes, this function is NOT handed a
 * companyId to resolve a country from: every caller today (the client form, the company settings
 * form, the onboarding wizard) already has an ISO country code straight from its own CountrySelect,
 * and resolving it a second time from a company record would be flatly wrong for the client
 * form — a CLIENT's own country has nothing to do with the ACTIVE company's country. This is also
 * why the endpoint behind this function needs no `@ActiveCompany()`: it is a pure function of
 * (countryCode, partyType), answerable before a company even exists (onboarding).
 *
 * DECISION (mirrors country-policy.ts's own DECISION 1): a country with NO rows at all in this
 * table has NO identifier requirements declared, and the frontend is told so via `reason` — never a
 * silently empty form that looks identical to "this country genuinely requires nothing". This is
 * DIFFERENT from a country whose file exists but declares nothing for one specific party type
 * (e.g. a scheme that only applies to COMPANY): that is the ordinary, unremarkable case and carries
 * no `reason` — the same distinction country-fields/registry.ts's own `operationsFor` draws between
 * "no file" and "file exists but says nothing about this type".
 */
import prisma from '@/prisma/prisma.service';

import { PartyType } from './schema';

/** Where a human adds the missing file — spelled out in the block message itself, the same way
 *  country-policy.ts's own DATA_DIR_HINT does. */
const DATA_DIR_HINT = 'backend/src/modules/documents/country-identifiers/data';

export interface RequiredIdentifierView {
  scheme: string;
  label: string;
  appliesTo: PartyType | 'BOTH';
  required: boolean;
  pattern?: string;
  helpText?: string;
}

export interface RequiredIdentifiersDecision {
  requirements: RequiredIdentifierView[];
  /** Present only when the COUNTRY itself has no identifier-requirements file/rows at all — see
   *  this file's own header for the distinction from the ordinary "nothing for this party type"
   *  empty case, which carries no reason. */
  reason?: string;
}

export async function resolveRequiredIdentifiers(
  countryCode: string | undefined | null,
  partyType: PartyType,
): Promise<RequiredIdentifiersDecision> {
  const resolvedCode = (countryCode ?? '').trim().toUpperCase();

  if (!resolvedCode) {
    return {
      requirements: [],
      reason: 'No country code was provided, so no identifier requirements can be determined.',
    };
  }

  const rows = await prisma.countryIdentifierRequirement.findMany({ where: { countryCode: resolvedCode } });
  if (rows.length === 0) {
    return {
      requirements: [],
      reason:
        `No identifier requirements are declared for "${resolvedCode}" — this country has no ` +
        `identifier-requirements file at all yet. To add one, create ` +
        `${DATA_DIR_HINT}/${resolvedCode.toLowerCase()}.json (see fr.json/us.json in that directory ` +
        'for the format) and reseed.',
    };
  }

  const requirements = rows
    .filter((row) => row.appliesTo === 'BOTH' || row.appliesTo === partyType)
    .map((row) => ({
      scheme: row.scheme,
      label: row.label,
      appliesTo: row.appliesTo as PartyType | 'BOTH',
      required: row.required,
      pattern: row.pattern ?? undefined,
      helpText: row.helpText ?? undefined,
    }));

  return { requirements };
}
