/**
 * The "client in double" rule, shared by the creation assistant (`ClientsService.findDuplicates`, one
 * typed identity) and the CSV import (`ClientImportService.evaluate`, a whole file matched in one
 * query): an ACTIVE client of the same company whose PRIMARY contact has the same email, or whose
 * name AND country are the same, all case-insensitively. Only the WHERE clauses, the select and the
 * case-folded key live here; each caller keeps its own email operator (one `equals` versus a file's
 * `in`), its own limits and its own matching of the rows that come back.
 */
import { Prisma } from '../../../prisma/generated/prisma/client';

/** One name + country identity, as the caller wants it compared (case-insensitively either way). */
export interface NameCountryPair {
  name: string;
  country: string;
}

/** The email side: a single typed address (`equals`), or every address of an import file (`in`). */
export type PrimaryEmailFilter = { equals: string } | { in: string[] };

/** Fields every duplicate candidate is read with: enough to name it and to say what matched. */
export const DUPLICATE_CANDIDATE_SELECT = {
  id: true,
  name: true,
  country: true,
  contacts: { where: { isPrimary: true }, select: { email: true }, take: 1 },
} as const satisfies Prisma.ClientSelect;

/** The case-folded name + country key both callers compare identities by. `\u0000` cannot occur in a
 *  stored value (Postgres text refuses it), so two different pairs never share a key. */
export function duplicateIdentityKey(name: string, country: string): string {
  return `${name.toLowerCase()}\u0000${country.toLowerCase()}`;
}

/**
 * The OR branches of the duplicate rule: one for the primary email when given (only the primary
 * contact's email counts: that is the address delivery actually uses), then one per name + country
 * pair (Prisma has no IN over a composite pair). Empty when there is nothing to match: the caller
 * must not query at all then, an empty OR matching nothing.
 */
export function duplicateCandidateOr(match: {
  primaryEmail?: PrimaryEmailFilter;
  nameCountryPairs: readonly NameCountryPair[];
}): Prisma.ClientWhereInput[] {
  const or: Prisma.ClientWhereInput[] = [];
  if (match.primaryEmail) {
    or.push({
      contacts: { some: { isPrimary: true, email: { ...match.primaryEmail, mode: 'insensitive' } } },
    });
  }
  for (const { name, country } of match.nameCountryPairs) {
    or.push({
      name: { equals: name, mode: 'insensitive' },
      country: { equals: country, mode: 'insensitive' },
    });
  }
  return or;
}
