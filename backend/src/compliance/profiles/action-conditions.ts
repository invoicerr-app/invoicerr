/**
 * What a country may demand before an action on a document — as ONE extension point, not one schema
 * field per national quirk.
 *
 * ── Why this replaced `issuableOn` and friends ───────────────────────────────────────────────────
 * The first shape enumerated the axes: a field for prerequisites, a field for calendar windows. It
 * worked, and it was wrong in the same way an N×N matrix is wrong. The day a country says "only
 * above €5 000", or "only when the buyer is abroad", the answer was another schema field — a change
 * to the CORE, for one country. That is exactly what "a country is data" is supposed to prevent, and
 * enumeration only moves the wall further away.
 *
 * So there is one notion: a CONDITION attached to an ACTION on a KIND. A condition names a predicate
 * and hands it parameters the engine never inspects. Adding a country needs no code; adding a KIND
 * OF condition needs one predicate, which is a far rarer event than a new jurisdiction.
 *
 * ── Data first, code only where data cannot reach ────────────────────────────────────────────────
 * Built-in predicates keep a profile readable by someone who is not a programmer — a country stays
 * auditable as a document. `ConditionRegistry` is nevertheless open: a plugin can register its own
 * predicate under a namespaced name and a profile may then reference it. The escape hatch exists,
 * costs nothing while unused, and the moment it IS used that country stops being auditable as data.
 * That is a real price, and it should be paid deliberately rather than by default.
 *
 * Nothing here knows what a quote is, what Poland is, or why the first of the month would matter.
 */
import { DocumentKindCode } from '../types';
import { CountryComplianceProfile, DocumentKindRule } from './schema';

/** The actions a country may put conditions on. */
export type DocumentAction = 'ISSUE' | 'EDIT' | 'DELETE' | 'CANCEL' | 'CORRECT' | 'SEND';

/** A document that already exists and could satisfy a condition. */
export interface ExistingDocument {
  kind: DocumentKindCode;
  state?: string;
}

/** What a predicate is given. Deliberately wide: a predicate the engine did not anticipate needs
 *  material the engine did not anticipate either. */
export interface ConditionContext {
  kind: DocumentKindCode;
  action: DocumentAction;
  at: Date;
  existing: readonly ExistingDocument[];
  /** The document itself, when the caller has it — amounts, parties, dates. */
  document?: Record<string, unknown>;
}

/** True = the condition is satisfied and the action may proceed. */
export type ConditionPredicate = (params: Record<string, unknown>, ctx: ConditionContext) => boolean;

/** One condition a profile attaches to an action. */
export interface ActionCondition {
  /** Built-in name, or `plugin-id/name` for one a plugin registered. */
  predicate: string;
  /** Opaque to the engine; meaningful only to the predicate. */
  params?: Record<string, unknown>;
  /** The country's own words when this blocks. Never invented here. */
  description?: string;
}

export interface ActionBlocker {
  predicate: string;
  kind: DocumentKindCode;
  action: DocumentAction;
  params?: Record<string, unknown>;
  description?: string;
}

export interface ActionVerdict {
  allowed: boolean;
  blockers: ActionBlocker[];
}

// ─────────────────────────────── the registry ───────────────────────────────

export class ConditionRegistry {
  private readonly predicates = new Map<string, ConditionPredicate>();

  register(name: string, predicate: ConditionPredicate): this {
    this.predicates.set(name, predicate);
    return this;
  }

  get(name: string): ConditionPredicate | undefined {
    return this.predicates.get(name);
  }

  names(): string[] {
    return [...this.predicates.keys()].sort();
  }
}

// ─────────────────────────────── built-in predicates ───────────────────────────────

/**
 * `never` — the action is not available for this kind, full stop.
 *
 * The plainest condition, and the one that lets a country take the ordinary invoice away, or forbid
 * deletion outright, without any new concept.
 */
const never: ConditionPredicate = () => false;

/**
 * `requiresDocument` — something else must already exist, optionally in a given state.
 *
 * params: `{ kind: string; state?: string }`
 */
const requiresDocument: ConditionPredicate = (params, ctx) => {
  const kind = params.kind as DocumentKindCode | undefined;
  const state = params.state as string | undefined;
  if (!kind) return true;
  return ctx.existing.some((d) => d.kind === kind && (!state || d.state === state));
};

/**
 * `calendarWindow` — the action is only available on certain days.
 *
 * params: `{ daysOfMonth?: number[]; months?: number[]; daysOfWeek?: number[] }`, ANDed; an absent
 * field constrains nothing, so `{ daysOfMonth: [1] }` is the first of ANY month.
 *
 * Dates are read in the SERVER's calendar, deliberately: the alternative is to guess a timezone, and
 * a rule that fires a day early somewhere is worse than one that is explicit about its clock.
 */
const calendarWindow: ConditionPredicate = (params, ctx) => {
  const days = params.daysOfMonth as number[] | undefined;
  const months = params.months as number[] | undefined;
  const weekdays = params.daysOfWeek as number[] | undefined;
  if (days?.length && !days.includes(ctx.at.getDate())) return false;
  if (months?.length && !months.includes(ctx.at.getMonth() + 1)) return false;
  if (weekdays?.length) {
    // getDay() calls Sunday 0; ISO calls it 7. This is the classic off-by-one in this exact spot.
    const iso = ctx.at.getDay() === 0 ? 7 : ctx.at.getDay();
    if (!weekdays.includes(iso)) return false;
  }
  return true;
};

/**
 * `documentStatusIn` — the document must currently be in one of these states.
 *
 * params: `{ field?: string; values: string[] }` — `field` defaults to `status`.
 *
 * Present because deletion is the obvious next demand ("only a draft may be deleted, and in this
 * country not even that"), and it would have been the next enumerated schema field.
 */
const documentStatusIn: ConditionPredicate = (params, ctx) => {
  const field = (params.field as string | undefined) ?? 'status';
  const values = (params.values as string[] | undefined) ?? [];
  if (!values.length) return true;
  return values.includes(String(ctx.document?.[field] ?? ''));
};

/**
 * `numericFieldAtMost` / `numericFieldAtLeast` — a threshold on the document.
 *
 * params: `{ field: string; value: number }`
 *
 * The case that made the enumerated shape untenable: "only above €5 000" is not a calendar, not a
 * prerequisite, and not a status — it is a fourth axis, and there would always be a fifth.
 */
const numericFieldAtMost: ConditionPredicate = (params, ctx) =>
  Number(ctx.document?.[String(params.field)] ?? 0) <= Number(params.value ?? 0);

const numericFieldAtLeast: ConditionPredicate = (params, ctx) =>
  Number(ctx.document?.[String(params.field)] ?? 0) >= Number(params.value ?? 0);

export const defaultConditionRegistry = new ConditionRegistry()
  .register('never', never)
  .register('requiresDocument', requiresDocument)
  .register('calendarWindow', calendarWindow)
  .register('documentStatusIn', documentStatusIn)
  .register('numericFieldAtMost', numericFieldAtMost)
  .register('numericFieldAtLeast', numericFieldAtLeast);

// ─────────────────────────────── resolution ───────────────────────────────

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
 * The conditions that apply, including the two the schema still spells out.
 *
 * `availability: 'FORBIDDEN'`, `requires` and `issuableOn` survive as SUGAR: they read better than
 * their generic form for the three cases that come up constantly, and they compile to exactly the
 * same conditions. Nothing is expressible one way and not the other.
 */
export function conditionsFor(rule: DocumentKindRule | undefined, action: DocumentAction): ActionCondition[] {
  if (!rule) return [];
  const out: ActionCondition[] = [];

  if (action === 'ISSUE') {
    if (rule.availability === 'FORBIDDEN') {
      out.push({ predicate: 'never', description: rule.openQuestion });
    }
    for (const need of rule.requires ?? []) {
      out.push({
        predicate: 'requiresDocument',
        params: { kind: need.kind, state: need.state },
        description: need.description,
      });
    }
    if (rule.issuableOn) {
      out.push({
        predicate: 'calendarWindow',
        params: { ...rule.issuableOn },
        description: rule.issuableOn.description,
      });
    }
  }

  out.push(...(rule.conditions?.[action] ?? []));
  return out;
}

/**
 * May this action be taken, here, now?
 *
 * Returns EVERY blocker rather than the first. A user told "you need a signed quote", who then
 * discovers it is also the wrong day, has been made to fail twice for one action — the cancellation
 * panel learned that lesson the hard way.
 *
 * An unknown predicate BLOCKS, and says so. The alternative — treating it as satisfied — would let a
 * profile that references a plugin nobody installed silently drop a national rule, which is the
 * worst failure this codebase can produce.
 */
export function checkAction(
  profile: CountryComplianceProfile | undefined,
  kind: DocumentKindCode,
  action: DocumentAction,
  ctx: Omit<ConditionContext, 'kind' | 'action'>,
  registry: ConditionRegistry = defaultConditionRegistry,
): ActionVerdict {
  const rule = documentKindRuleFor(profile, kind, ctx.at);
  const conditions = conditionsFor(rule, action);
  if (!conditions.length) return { allowed: true, blockers: [] };

  const full: ConditionContext = { ...ctx, kind, action };
  const blockers: ActionBlocker[] = [];

  for (const c of conditions) {
    const predicate = registry.get(c.predicate);
    const satisfied = predicate ? predicate(c.params ?? {}, full) : false; // unknown predicate → blocked, never silently allowed
    if (!satisfied) {
      blockers.push({
        predicate: c.predicate,
        kind,
        action,
        params: c.params,
        description: predicate
          ? c.description
          : `Unknown condition "${c.predicate}" — the plugin providing it is not installed.`,
      });
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

/** `checkAction(..., 'ISSUE', ...)`, kept because issuance is by far the most common caller. */
export function checkIssuable(
  profile: CountryComplianceProfile | undefined,
  kind: DocumentKindCode,
  at: Date,
  existing: readonly ExistingDocument[] = [],
  document?: Record<string, unknown>,
): ActionVerdict {
  return checkAction(profile, kind, 'ISSUE', { at, existing, document });
}
