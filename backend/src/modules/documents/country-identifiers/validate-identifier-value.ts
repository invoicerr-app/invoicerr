/**
 * Enforces `CountryIdentifierRequirement.pattern` at the moment a `PartyIdentifier` is actually
 * written — schema.ts's own comment on `pattern` says plainly that nothing did, as of 2026-08-30:
 * "Declared here for a future consumer; no frontend code enforces it today." This is that consumer,
 * called from `clients.service.ts` and `company.service.ts`'s own `upsertPartyIdentifiers` — the
 * only two places in this codebase that ever write a `PartyIdentifier` row (grepped: seeding,
 * drift-detection and serialisation are the only other readers of `.pattern`).
 *
 * Concretely, before this existed: Italy's `IT_SDI` declares `^[A-Za-z0-9]{7}$`, a 3-character value
 * saved happily, and `formats/national/fatturapa-provider.ts` — which validates the SAME field with
 * its OWN `/^[A-Za-z0-9]{7}$/` at send time — then fell through every routing branch to
 * `CodiceDestinatario: 'XXXXXXX'`, the placeholder this specification reserves for a recipient
 * outside Italy. A domestic invoice, announced to SdI as a foreign one, from a typo nothing refused.
 *
 * DECISIONS
 *  1. REFUSE, not warn. `required`/`pattern` are both legal claims this catalog sources with the
 *     same provenance discipline (schema.ts's own header) — not a probabilistic guess a human should
 *     merely be nudged about, the way an OCR-extracted field might be. The sibling precedent already
 *     in this codebase is `numbering/format-number.ts#assertValidNumberPattern`: reject a
 *     stated-format violation at SAVE time, before it ever reaches a downstream consumer that fails
 *     far away and far less legibly (exactly what `fatturapa-provider.ts` did here).
 *  2. A value UNCHANGED from what is already on file is never re-validated — see `previousValue`
 *     below. A pattern enforced for the first time (this change) or tightened later must never
 *     retroactively lock a user out of editing a client/company record that predates it for fields
 *     they are not even touching; only a NEW or CHANGED value is held to the current pattern. A user
 *     editing an unrelated field on a record with a legacy-bad identifier experiences no refusal at
 *     all; only actually typing a new value into THAT field does.
 *  3. No declared `pattern` means the scheme has no stated shape, not "nothing may be entered" — most
 *     schemes ship with none at all (schema.ts's own header) — so an absent/`null` pattern always
 *     passes.
 *
 * VAT is EXEMPT (see the guard below): `tax/vat-syntax.ts#validateVat` is already the authoritative,
 * checksum-based syntax check for that one scheme, wired into `clients.service.ts`. Its own failure
 * mode is "flag INVALID, treat the buyer as B2C, keep the record" — not a refusal — precisely because
 * a checksum-perfect-looking number can still turn out to be for a deregistered or non-existent
 * trader, which is VIES's question to answer, not a regex's. A generic pattern gate on top of that
 * would either duplicate it more weakly (DE is the only VAT fact with a declared `pattern` today,
 * `^DE\d{9}$` — strictly WEAKER than `validateVat`'s own DE branch, which additionally checks the
 * ISO 7064 Mod 11,10 checksum) or flatly contradict it (refusing here while the VAT-specific path
 * only warns, for a number that path already accepted as syntactically fine). So `pattern` is never
 * consulted for `scheme === 'VAT'`, in either write path — ownership of VAT syntax stays exclusively
 * with `vat-syntax.ts`.
 */
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

export interface IdentifierPatternCheckInput {
  /** The party's own country — a client's, or the active company's own. */
  countryCode: string | null | undefined;
  scheme: string;
  value: string;
  /** The value already on file for this exact (party, scheme), if any — `undefined` for a brand-new
   *  identifier (nothing to grandfather), matching `value` exactly means "not actually changed" (see
   *  DECISION 2 above). Omit entirely (never pass an empty string) when there is nothing on file. */
  previousValue?: string | null;
}

/**
 * Throws `BadRequestException` when `value` is new-or-changed and fails a declared `pattern` for
 * (countryCode, scheme). Reads `CountryIdentifierRequirement` — the DB mirror of `data/*.json` every
 * OTHER reader of this catalog already goes through (`country-identifiers.ts#resolveRequiredIdentifiers`),
 * kept current at every boot by `CountryIdentifierRequirementsBootReseedService`, never the JSON files
 * directly (a write path has no reason to duplicate that read).
 */
export async function assertIdentifierValueMatchesPattern({
  countryCode,
  scheme,
  value,
  previousValue,
}: IdentifierPatternCheckInput): Promise<void> {
  if (scheme === 'VAT') return; // see this file's header — vat-syntax.ts owns VAT syntax exclusively

  const trimmed = value.trim();
  if (!trimmed) return; // presence is `required`'s concern (enforced client-side today), not this one's

  if (previousValue != null && previousValue === value) return; // DECISION 2 — nothing actually changed

  const iso = (countryCode ?? '').trim().toUpperCase();
  if (!iso) return; // no country to resolve a requirement against — nothing to enforce

  const fact = await prisma.countryIdentifierRequirement.findUnique({
    where: { countryCode_scheme: { countryCode: iso, scheme } },
    select: { pattern: true, label: true, helpText: true },
  });
  if (!fact?.pattern) return; // DECISION 3 — no stated shape for this (country, scheme)

  if (new RegExp(fact.pattern).test(value)) return;

  // Names the scheme, the shape in WORDS (never the raw regex — assertPatternIsExplainable
  // guarantees `helpText` exists whenever `pattern` does), and the value actually received.
  throw new BadRequestException(
    `Invalid ${fact.label} (${scheme}): expected ${fact.helpText} — received "${value}".`,
  );
}
