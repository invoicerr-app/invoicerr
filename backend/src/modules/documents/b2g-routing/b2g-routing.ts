/**
 * The READ side of the B2G routing table (`B2gRoutingRule`) — the WRITE side is
 * `upsertB2gRoutingRules()` (`boot-upsert.ts`), run at every backend BOOT (`boot-upsert.service.ts`),
 * never here. This module never writes: the table is a mirror of `data/*.json`, not user-editable
 * data — same split `country-policy/country-policy.ts` already holds for its own table.
 *
 * Reads the DATABASE, never `registry.ts`'s in-memory catalog (which `boot-upsert.ts` alone
 * consults) — this is the whole point of mirroring the files into a table at all rather than reading
 * them live the way `channel-policy/registry.ts` does: every API/worker replica must see the SAME
 * rule the instant ANY of them boots with a newer data file, not whichever process happened to load
 * the freshest code — see `schema.prisma`'s own comment on `B2gRoutingRule` for the full reasoning.
 *
 * Plain functions reading the Prisma singleton directly, not an injectable class — same convention
 * `country-policy.ts`/`company-transport.ts` already established for "read one fact, decide": no new
 * DI token, mockable with `jest.mock` the exact same way `actions/invoice-channel-mandate.spec.ts`
 * already mocks `channel-policy/mandate.ts` wholesale.
 */
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

export interface RequiredClientIdentifierView {
  scheme: string;
  label: string;
  why: string;
}

export interface RequiredDocumentFieldView {
  field: string;
  label: string;
  why: string;
  required: boolean;
}

export interface B2gRoutingRuleView {
  countryCode: string;
  transportId: string;
  formatSyntax: string;
  requiredClientIdentifiers: RequiredClientIdentifierView[];
  requiredDocumentFields: RequiredDocumentFieldView[];
  /** `"${sourceText}" (checked ${date})` for a legal fact, `"unverified — ${resolutionNote}"`
   *  otherwise — the ONE line every B2G refusal message reuses so the SOURCE is always named, never
   *  just the transport id (same discipline `invoice-actions.ts`'s own `describeMandateSource` already
   *  holds for the seller-country channel mandate). */
  provenanceDescription: string;
}

/** Where a human adds the missing file — spelled out in the block message itself, same convention as
 *  `country-policy.ts`'s own `DATA_DIR_HINT`. */
const DATA_DIR_HINT = 'backend/src/modules/documents/b2g-routing/data';

function describeProvenance(row: {
  provenanceKind: string;
  sourceText: string | null;
  sourceCheckedAt: Date | null;
  resolutionNote: string | null;
}): string {
  if (row.provenanceKind === 'legal' && row.sourceText) {
    const checkedAt = row.sourceCheckedAt ? row.sourceCheckedAt.toISOString().slice(0, 10) : 'unknown date';
    return `"${row.sourceText}" (checked ${checkedAt})`;
  }
  return `unverified — ${row.resolutionNote ?? 'no resolution note on file'}`;
}

function toView(row: {
  countryCode: string;
  transportId: string;
  formatSyntax: string;
  requiredClientIdentifiers: unknown;
  requiredDocumentFields: unknown;
  provenanceKind: string;
  sourceText: string | null;
  sourceCheckedAt: Date | null;
  resolutionNote: string | null;
}): B2gRoutingRuleView {
  return {
    countryCode: row.countryCode,
    transportId: row.transportId,
    formatSyntax: row.formatSyntax,
    requiredClientIdentifiers: (row.requiredClientIdentifiers as RequiredClientIdentifierView[] | null) ?? [],
    requiredDocumentFields: (row.requiredDocumentFields as RequiredDocumentFieldView[] | null) ?? [],
    provenanceDescription: describeProvenance(row),
  };
}

/**
 * The bare rule for one country, or `undefined` when none is declared — no companyId, no client:
 * answerable from a raw ISO country code alone, the same shape `resolveRequiredIdentifiers`
 * (`country-identifiers/country-identifiers.ts`) already established for the identical reason (the
 * client edit screen's own "does your government client's country have a B2G rule" hint needs this
 * BEFORE any invoice, or even any saved client, exists).
 */
export async function resolveB2gRoutingRule(
  countryCode: string | undefined | null,
): Promise<B2gRoutingRuleView | undefined> {
  const resolvedCode = (countryCode ?? '').trim().toUpperCase();
  if (!resolvedCode) return undefined;
  const row = await prisma.b2gRoutingRule.findUnique({ where: { countryCode: resolvedCode } });
  return row ? toView(row) : undefined;
}

export interface B2gClientRoutingDecision {
  /** False for a BUSINESS client, a client that cannot be found, or no clientId at all — every OTHER
   *  field is meaningless in that case. See `actions/invoice-actions.ts`'s own header for the
   *  precedence this implies: `applies: false` means "this invoice follows the ORDINARY rules
   *  (seller-country mandate, then the company's free transport choice) unchanged". */
  applies: boolean;
  /** The client's own resolved ISO country code — present whenever `applies` is true, even when no
   *  rule was found for it (distinct failure mode from an unresolved country, see below). */
  countryCode?: string;
  /** The client's raw `country` text — surfaced only when `countryCode` could NOT be resolved, so the
   *  refusal message can still name what the user actually typed. */
  clientCountryRaw?: string | null;
  /** Present only when a rule exists for `countryCode`. Absent (with `applies: true`) means "no B2G
   *  rule is declared for this country yet" — the HONEST refusal this whole mechanism exists to give
   *  instead of a silent B2B fallback. */
  rule?: B2gRoutingRuleView;
  /** `rule.requiredClientIdentifiers` schemes NOT found (non-empty) on the client's own
   *  `partyIdentifiers` — empty when `rule` is absent, or when every required identifier is on file. */
  missingIdentifierSchemes: string[];
}

/**
 * The FULL B2G decision for one invoice's "send" — is this client government, does its own country
 * have a routing rule, and which required identifiers (if any) are still missing on file. Everything
 * `invoice-actions.ts`'s preflight needs in ONE call, mirroring `channel-policy/mandate.ts`'s own
 * `activeChannelMandateFor` in shape: a single resolver a caller mocks WHOLESALE in its own tests
 * (`actions/invoice-b2g-routing.spec.ts`), never three separate DB round-trips composed by hand in
 * `invoice-actions.ts` itself.
 *
 * `clientId` is read straight off the invoice's own submitted `data.client` (the 'reference' field a
 * document names its client by, see `descriptors/invoice.descriptor.ts`) — resolved here, not
 * through `ClientsService` (this module stays a plain Prisma reader, the same DI-free convention
 * `country-policy.ts` already holds, and the one this repo's OWN pitfall list names for
 * `ClientsModule` under ts-jest — see TODO_ISSUES.md).
 */
export async function resolveClientB2gRouting(
  companyId: string,
  clientId: string | undefined | null,
): Promise<B2gClientRoutingDecision> {
  if (!clientId) return { applies: false, missingIdentifierSchemes: [] };

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    include: { partyIdentifiers: true },
  });
  if (client?.kind !== 'GOVERNMENT') {
    return { applies: false, missingIdentifierSchemes: [] };
  }

  const resolvedCode = (client.countryCode || guessCountryCode(client.country) || '').trim().toUpperCase();
  if (!resolvedCode) {
    return {
      applies: true,
      clientCountryRaw: client.country,
      missingIdentifierSchemes: [],
    };
  }

  const row = await prisma.b2gRoutingRule.findUnique({ where: { countryCode: resolvedCode } });
  if (!row) {
    return { applies: true, countryCode: resolvedCode, missingIdentifierSchemes: [] };
  }

  const rule = toView(row);
  const onFile = new Set(
    client.partyIdentifiers
      .filter((identifier) => identifier.value?.trim())
      .map((identifier) => identifier.scheme),
  );
  const missingIdentifierSchemes = rule.requiredClientIdentifiers
    .filter((req) => !onFile.has(req.scheme))
    .map((req) => req.scheme);

  return { applies: true, countryCode: resolvedCode, rule, missingIdentifierSchemes };
}

export { DATA_DIR_HINT as B2G_ROUTING_DATA_DIR_HINT };
