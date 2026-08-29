/**
 * May this document be issued, here, now?
 *
 * Three questions a jurisdiction is entitled to answer differently, and which the engine used to
 * answer for everyone:
 *
 *   1. Does the country permit this kind at all?          → `availability: 'FORBIDDEN'`
 *   2. Does something else have to exist first?           → `requires: [{ kind, state }]`
 *   3. Is today a day on which it may be issued?          → `issuableOn: { daysOfMonth, … }`
 *
 * All three are DATA. Nothing here knows what a quote is, what Poland is, or why the first of the
 * month would matter — it compares codes and dates. A country that declares none of the three is
 * unconstrained, which is every shipped profile today, so adding this changed nothing for them.
 *
 * The blockers are returned as CODES with the country's own words attached, never as a sentence
 * assembled here: the screen does the wording, and the wording of a national rule belongs to the
 * country that wrote it.
 */
import { CountryComplianceProfile, DocumentKindRule, IssuanceWindow } from './schema';
import { DocumentKindCode } from '../types';

export interface IssuanceBlocker {
  /** Machine-readable reason, for an interface that wants to react rather than only display. */
  code: 'FORBIDDEN_KIND' | 'MISSING_PREREQUISITE' | 'OUTSIDE_WINDOW';
  /** The kind or prerequisite the blocker is about. */
  kind?: DocumentKindCode;
  /** The state the prerequisite had to be in, when it named one. */
  requiredState?: string;
  /** The country's own explanation, when the profile gave one. Never invented here. */
  description?: string;
}

export interface IssuanceVerdict {
  allowed: boolean;
  blockers: IssuanceBlocker[];
}

/** A document that already exists and could satisfy a prerequisite. */
export interface ExistingDocument {
  kind: DocumentKindCode;
  state?: string;
}

/** The rule a profile declares for one kind at a date, or undefined when it declares none. */
export function documentKindRuleFor(
  profile: CountryComplianceProfile | undefined,
  kind: DocumentKindCode,
  at: Date,
): DocumentKindRule | undefined {
  return (profile?.documentKinds ?? [])
    .filter((t) => new Date(t.validFrom) <= at && (!t.validTo || new Date(t.validTo) > at))
    .map((t) => t.value)
    .find((r) => r.kind === kind);
}

/**
 * Does `at` fall inside the window?
 *
 * The fields AND together, and an absent field constrains nothing — so `{ daysOfMonth: [1] }` means
 * "the first of any month", not "the first of January". Dates are read in the SERVER's calendar,
 * deliberately: the alternative is to guess a timezone, and a rule that fires a day early somewhere
 * is worse than one that is explicit about which clock it uses.
 */
export function isWithinWindow(window: IssuanceWindow | undefined, at: Date): boolean {
  if (!window) return true;
  if (window.daysOfMonth?.length && !window.daysOfMonth.includes(at.getDate())) return false;
  if (window.months?.length && !window.months.includes(at.getMonth() + 1)) return false;
  if (window.daysOfWeek?.length) {
    // getDay() is 0=Sunday; ISO is 1=Monday…7=Sunday.
    const iso = at.getDay() === 0 ? 7 : at.getDay();
    if (!window.daysOfWeek.includes(iso)) return false;
  }
  return true;
}

/**
 * The verdict, with every blocker rather than the first.
 *
 * All of them, on purpose: a user told "you need a signed quote" who then discovers it is also the
 * wrong day has been made to fail twice for one action. The cancellation panel learned the same
 * lesson — several conditions can hold at once, and showing one is a bug.
 */
export function checkIssuable(
  profile: CountryComplianceProfile | undefined,
  kind: DocumentKindCode,
  at: Date,
  existing: readonly ExistingDocument[] = [],
): IssuanceVerdict {
  const rule = documentKindRuleFor(profile, kind, at);
  if (!rule) return { allowed: true, blockers: [] };

  const blockers: IssuanceBlocker[] = [];

  if (rule.availability === 'FORBIDDEN') {
    blockers.push({ code: 'FORBIDDEN_KIND', kind, description: rule.openQuestion });
  }

  for (const need of rule.requires ?? []) {
    const satisfied = existing.some((d) => d.kind === need.kind && (!need.state || d.state === need.state));
    if (!satisfied) {
      blockers.push({
        code: 'MISSING_PREREQUISITE',
        kind: need.kind,
        requiredState: need.state,
        description: need.description,
      });
    }
  }

  if (!isWithinWindow(rule.issuableOn, at)) {
    blockers.push({ code: 'OUTSIDE_WINDOW', kind, description: rule.issuableOn?.description });
  }

  return { allowed: blockers.length === 0, blockers };
}
