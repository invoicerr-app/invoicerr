/**
 * Root TODO item 15's own remainder — evaluates whether a country's CONTENT requirement (schema.ts's
 * `ContentRequirementFact`) has come into force for one particular invoice. Deliberately kept as
 * small and focused as `channel-policy/mandate.ts` (which this file's own date arithmetic is a
 * verbatim port of, adapted to `ContentRequirementFact` — see that file's header for the full
 * reasoning this one does not repeat): the ONE decision worth its own test file, independent of the
 * catalog's own loading tests (`registry.spec.ts`).
 *
 * THE ONE DECISION THIS FILE EXISTS TO MAKE EXPLICIT AND TESTABLE, same as its `channel-policy/`
 * sibling: a requirement is evaluated against the INVOICE's own `issueDate`, never the server's
 * current date. An invoice built long after a requirement's `mandatedFrom` has passed must still be
 * judged by the rule in force ON ITS OWN issue date — re-deriving BT-23 for an old invoice at export
 * time must reproduce exactly what a compliant PDP deposit needed the day it was actually issued.
 */
import { ContentRequirementCatalog, defaultContentRequirementCatalog } from './registry';
import { ContentRequirementFact } from './schema';

/** True when `issueDate` is on or after `mandatedFrom`. An `issueDate` that is missing or fails to
 *  parse returns `false` — never `true`, the same "never assume a requirement already applies from a
 *  date we could not actually read" discipline `channel-policy/mandate.ts#isOnOrAfter` already holds
 *  for a channel mandate. */
function isOnOrAfter(issueDate: string | undefined, mandatedFrom: string): boolean {
  if (!issueDate) return false;
  const issued = new Date(issueDate).getTime();
  const startsAt = new Date(mandatedFrom).getTime();
  if (Number.isNaN(issued) || Number.isNaN(startsAt)) return false;
  return issued >= startsAt;
}

/**
 * The content requirement (if any) that binds `field` for a seller in `countryCode` on an invoice
 * issued on `issueDate` — undefined when the country has no file, no fact for that field at all, or
 * every matching fact's own `mandatedFrom` is still in the future relative to `issueDate`.
 *
 * `catalog` defaults to the shipped singleton — every real caller
 * (`formats/semantic/business-process.ts`) relies on that default; the parameter exists purely so
 * `active-requirement.spec.ts` can exercise the date arithmetic against a fixture catalog, the same
 * constructor-injection testability every sibling catalog in `documents/` already provides.
 */
export function activeContentRequirementFor(
  countryCode: string,
  field: string,
  issueDate: string | undefined,
  catalog: ContentRequirementCatalog = defaultContentRequirementCatalog,
): ContentRequirementFact | undefined {
  for (const fact of catalog.factsFor(countryCode)) {
    if (fact.field !== field) continue;
    // schema.ts's `assertValidContentRequirementFact` — run for every shipped file at load time, see
    // data/all.ts — guarantees every fact here already carries a non-empty `mandatedFrom`; a fact
    // that failed that check never made it into the catalog at all.
    if (isOnOrAfter(issueDate, fact.mandatedFrom)) return fact;
  }
  return undefined;
}
