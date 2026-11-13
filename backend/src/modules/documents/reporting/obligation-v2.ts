/**
 * The v2 reporting OBLIGATION format (issue #767, "Declarations model 2/5"). This is the "expand"
 * step: v2 lives beside the legacy `ReportingObligationFact` shape (`schema.ts`), nothing reads it
 * yet, and no shipped country file is rewritten. `upgradeLegacyFacts` turns a legacy file into v2 so
 * the catalog API that follows can serve one shape while every country file still speaks the old one.
 *
 * Why a new shape rather than more optional fields on the legacy fact: the legacy fact answers one
 * question ("which provider fires when this document type is sent") and grew `scope`,
 * `applicability` and `dischargedBy` one country at a time. The periodic declarations still to come
 * (#770: summaries and returns, aggregated per period, sometimes exported instead of transmitted)
 * need to say things the legacy shape cannot: what KIND of obligation it is, what TRIGGERS it, when
 * it is DUE, and that the same obligation can be discharged through several EQUIVALENT channels
 * (an accredited platform, a provider API, a file the user uploads, or a manual step), each with its
 * own unit (one document, or one period).
 *
 * Vocabulary (also in `documentation/docs/developer-guide/declarations.md`):
 *   - obligation: one legal duty to tell an authority something, identified by `id` in its file;
 *   - kind: `data` (per-document data, e.g. Portugal's invoice communication), `summary` (a
 *     recapitulative statement, e.g. an EC sales list), `return` (a tax return);
 *   - trigger: the document event, or the period end, that makes the obligation due;
 *   - scope: the document types and transaction slices it covers;
 *   - seller conditions: answers from the company profile (`countries/data/*.json#companyProfile`)
 *     the seller must match for the obligation to bind at all;
 *   - applicability windows: dated windows, optionally conditioned on the company profile;
 *   - legal basis: where the duty comes from, with its own validity dates;
 *   - timing: a deadline after the trigger, or the period the declaration covers;
 *   - channel: one way to discharge the obligation, and who discharges it.
 *
 * Every rule here refuses at load with a named error and a message naming the file and the
 * obligation, the same discipline every sibling catalog holds. Nothing has a silent default.
 */
import { PolicyProvenance } from '../country-policy/schema';
import {
  assertValidProvenance,
  assertValidReportingScopeEntry,
  CountryReportingObligationFile,
  ReportableDocumentType,
  ReportingObligationFact,
  ReportingScopeEntry,
} from './schema';

export type ObligationKind = 'data' | 'summary' | 'return';

/**
 * What makes the obligation due. `sent` is the only trigger the legacy shape knew (every legacy
 * fact fired from `report-on-send.ts`), `payment` is the legacy `payments` scope
 * (`report-payment.ts`); `issued` and `period-end` are new and read by nothing yet (#768, #770).
 */
export type ObligationTrigger = 'issued' | 'sent' | 'payment' | 'period-end';

/**
 * Who discharges a channel:
 *   - `transport`: the delivery channel carries the data to the authority as a legal side effect of
 *     sending the document (France's accredited platform for a B2B-domestic invoice); nothing is
 *     enqueued for it;
 *   - `provider`: a `DeclarationProviderRegistry` id the app calls itself (Portugal's `pt-at`);
 *   - `export`: the app produces a file the user files with the authority;
 *   - `manual`: the user files it themselves; the app only records that it is owed.
 */
export type ChannelDischarger = 'transport' | 'provider' | 'export' | 'manual';

/** What one discharge of a channel covers: one document, or one whole period. */
export type ChannelUnit = 'document' | 'period';

export type ObligationPeriod = 'month' | 'quarter' | 'year';

export interface ObligationChannel {
  dischargedBy: ChannelDischarger;
  /** The id the discharger resolves: a transport id, a provider id, an export format id, or a
   *  short manual-step id. Not checked against any live registry here, the same posture the legacy
   *  `providerId` holds. */
  id: string;
  unit: ChannelUnit;
}

export interface ObligationAuthority {
  /** ISO 3166-1 alpha-2 of the authority's country. */
  countryCode: string;
  /** Human-read name, e.g. the authority's own name. Optional: an upgraded legacy fact has none. */
  name?: string;
}

export interface ObligationScope {
  documentTypes: ReportableDocumentType[];
  /** The legacy scope entry vocabulary, unchanged. Absent means every transaction of those types. */
  transactions?: ReportingScopeEntry[];
}

export interface ProfileCondition {
  companyProfile: Record<string, string[]>;
}

export interface ObligationApplicabilityWindow {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Exclusive, `YYYY-MM-DD`. Absent means open-ended. */
  until?: string;
  when?: ProfileCondition;
  provenance: PolicyProvenance;
}

export interface ObligationLegalBasis {
  provenance: PolicyProvenance;
  /** Inclusive, `YYYY-MM-DD`: when the cited text entered into force. */
  validFrom?: string;
  /** Exclusive, `YYYY-MM-DD`: when the cited text was repealed or replaced. */
  validUntil?: string;
}

/** Exactly one of a deadline after the trigger, or the period a declaration covers. */
export type ObligationTiming = { deadline: { daysAfterTrigger: number } } | { period: ObligationPeriod };

export interface ReportingObligation {
  id: string;
  authority: ObligationAuthority;
  kind: ObligationKind;
  trigger: ObligationTrigger;
  scope: ObligationScope;
  sellerConditions?: ProfileCondition;
  applicability?: ObligationApplicabilityWindow[];
  legalBasis: ObligationLegalBasis;
  timing?: ObligationTiming;
  /** Free-form, human-read timing description: what the legacy `periodicity` said. Never parsed. */
  timingNote?: string;
  channels: ObligationChannel[];
  notes?: string;
}

export interface CountryReportingObligationFileV2 {
  countryCode: string;
  obligations: ReportingObligation[];
}

export class InvalidReportingObligationError extends Error {}

/** A legacy fact `upgradeLegacyFacts` cannot express as one v2 obligation without guessing. */
export class LegacyReportingUpgradeError extends Error {}

const KINDS: ObligationKind[] = ['data', 'summary', 'return'];
const TRIGGERS: ObligationTrigger[] = ['issued', 'sent', 'payment', 'period-end'];
const DISCHARGERS: ChannelDischarger[] = ['transport', 'provider', 'export', 'manual'];
const UNITS: ChannelUnit[] = ['document', 'period'];
const PERIODS: ObligationPeriod[] = ['month', 'quarter', 'year'];
const DOCUMENT_TYPES: ReportableDocumentType[] = ['invoice', 'credit-note'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;

function fail(message: string): never {
  throw new InvalidReportingObligationError(message);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertDateRange(
  from: unknown,
  until: unknown,
  where: string,
  fromLabel: string,
  untilLabel: string,
) {
  if (from !== undefined && !isIsoDate(from)) fail(`${where}: "${fromLabel}" is not a YYYY-MM-DD date.`);
  if (until !== undefined && !isIsoDate(until)) fail(`${where}: "${untilLabel}" is not a YYYY-MM-DD date.`);
  if (typeof from === 'string' && typeof until === 'string' && until <= from) {
    fail(`${where}: "${untilLabel}" (${until}) is not after "${fromLabel}" (${from}).`);
  }
}

function assertProfileCondition(condition: unknown, where: string, label: string): void {
  const profile = (condition as ProfileCondition | undefined)?.companyProfile;
  if (
    !profile ||
    typeof profile !== 'object' ||
    Array.isArray(profile) ||
    Object.keys(profile).length === 0
  ) {
    fail(`${where}: "${label}.companyProfile" must be a non-empty object.`);
  }
  for (const [key, values] of Object.entries(profile)) {
    if (!key.trim() || !Array.isArray(values) || values.length === 0) {
      fail(
        `${where}: "${label}.companyProfile" condition "${key || '(empty)'}" has no non-empty value list.`,
      );
    }
    if (values.some((value) => typeof value !== 'string' || !value.trim())) {
      fail(`${where}: "${label}.companyProfile" condition "${key}" holds an empty or non-string value.`);
    }
  }
}

/**
 * Every rule a v2 obligation must pass. `context` names the file (e.g. `countries/data/pt.json#reporting`).
 */
export function assertValidReportingObligation(obligation: ReportingObligation, context: string): void {
  if (typeof obligation?.id !== 'string' || !obligation.id.trim()) {
    fail(`${context}: a reporting obligation is missing its "id".`);
  }
  const where = `${context}: obligation "${obligation.id}"`;

  if (!COUNTRY_CODE.test(obligation.authority?.countryCode ?? '')) {
    fail(`${where} has no valid "authority.countryCode" (ISO 3166-1 alpha-2, uppercase).`);
  }
  if (obligation.authority.name !== undefined && !obligation.authority.name.trim()) {
    fail(`${where} declares an empty "authority.name" - omit it instead.`);
  }
  if (!KINDS.includes(obligation.kind)) {
    fail(`${where} has an unknown "kind" "${String(obligation.kind)}" (must be one of ${KINDS.join(', ')}).`);
  }
  if (!TRIGGERS.includes(obligation.trigger)) {
    fail(
      `${where} has an unknown "trigger" "${String(obligation.trigger)}" (must be one of ${TRIGGERS.join(', ')}).`,
    );
  }

  const types = obligation.scope?.documentTypes;
  if (!Array.isArray(types) || types.length === 0) {
    fail(`${where} has no "scope.documentTypes".`);
  }
  for (const type of types) {
    if (!DOCUMENT_TYPES.includes(type)) {
      fail(
        `${where} has an unknown document type "${String(type)}" (must be one of ${DOCUMENT_TYPES.join(', ')}).`,
      );
    }
  }
  if (new Set(types).size !== types.length)
    fail(`${where} lists a document type twice in "scope.documentTypes".`);
  const transactions = obligation.scope.transactions;
  if (transactions !== undefined) {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      fail(
        `${where} declares "scope.transactions" that is not a non-empty array - omit it to cover every transaction.`,
      );
    }
    for (const entry of transactions)
      assertValidReportingScopeEntry(entry, context, `obligation "${obligation.id}"`);
  }

  if (obligation.sellerConditions !== undefined) {
    assertProfileCondition(obligation.sellerConditions, where, 'sellerConditions');
  }

  if (obligation.applicability !== undefined) {
    if (!Array.isArray(obligation.applicability) || obligation.applicability.length === 0) {
      fail(`${where} declares "applicability" that is not a non-empty array.`);
    }
    for (const window of obligation.applicability) {
      if (window?.from === undefined) fail(`${where} declares an applicability window with no "from".`);
      assertDateRange(window.from, window.until, `${where}'s applicability window`, 'from', 'until');
      if (window.when !== undefined) assertProfileCondition(window.when, where, 'applicability.when');
      assertValidProvenance(
        window.provenance,
        context,
        `obligation "${obligation.id}"'s applicability window`,
      );
    }
  }

  if (!obligation.legalBasis) fail(`${where} has no "legalBasis".`);
  assertValidProvenance(
    obligation.legalBasis.provenance,
    context,
    `obligation "${obligation.id}"'s legal basis`,
  );
  assertDateRange(
    obligation.legalBasis.validFrom,
    obligation.legalBasis.validUntil,
    `${where}'s legal basis`,
    'validFrom',
    'validUntil',
  );

  const timing = obligation.timing as Record<string, unknown> | undefined;
  if (timing !== undefined) {
    const keys = Object.keys(timing ?? {});
    if (keys.length !== 1 || (keys[0] !== 'deadline' && keys[0] !== 'period')) {
      fail(`${where} declares "timing" that is not exactly one of "deadline" or "period".`);
    }
    if (keys[0] === 'deadline') {
      const days = (timing.deadline as { daysAfterTrigger?: unknown } | undefined)?.daysAfterTrigger;
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
        fail(`${where} declares a deadline whose "daysAfterTrigger" is not a non-negative integer.`);
      }
    } else if (!PERIODS.includes(timing.period as ObligationPeriod)) {
      fail(
        `${where} has an unknown "timing.period" "${String(timing.period)}" (must be one of ${PERIODS.join(', ')}).`,
      );
    }
  }
  if (obligation.timingNote !== undefined && !obligation.timingNote.trim()) {
    fail(`${where} declares an empty "timingNote" - omit it instead.`);
  }

  if (!Array.isArray(obligation.channels) || obligation.channels.length === 0) {
    fail(`${where} has no "channels": an obligation nobody can discharge cannot be declared.`);
  }
  const seen = new Set<string>();
  for (const channel of obligation.channels) {
    if (!DISCHARGERS.includes(channel?.dischargedBy)) {
      fail(
        `${where} has a channel with an unknown "dischargedBy" "${String(channel?.dischargedBy)}" ` +
          `(must be one of ${DISCHARGERS.join(', ')}).`,
      );
    }
    if (typeof channel.id !== 'string' || !channel.id.trim()) {
      fail(`${where} has a "${channel.dischargedBy}" channel with no "id".`);
    }
    if (!UNITS.includes(channel.unit)) {
      fail(
        `${where}'s channel "${channel.id}" has an unknown "unit" "${String(channel.unit)}" (must be one of ${UNITS.join(', ')}).`,
      );
    }
    const key = `${channel.dischargedBy}:${channel.id}`;
    if (seen.has(key)) fail(`${where} lists channel "${key}" twice.`);
    seen.add(key);
    if (channel.unit === 'period' && !(timing && 'period' in timing)) {
      fail(
        `${where}'s channel "${channel.id}" is per period but the obligation declares no "timing.period".`,
      );
    }
    if (channel.unit === 'document' && obligation.trigger === 'period-end') {
      fail(
        `${where}'s channel "${channel.id}" is per document but the obligation is triggered at period end.`,
      );
    }
  }
}

/** A whole v2 file: the country code, every obligation, and no id used twice. */
export function assertValidReportingObligationFileV2(
  file: CountryReportingObligationFileV2,
  context: string,
): void {
  if (!COUNTRY_CODE.test(file?.countryCode ?? '')) {
    fail(`${context}: the reporting section has no valid "countryCode" (ISO 3166-1 alpha-2, uppercase).`);
  }
  if (!Array.isArray(file.obligations)) fail(`${context}: the reporting section has no "obligations" array.`);
  const ids = new Set<string>();
  for (const obligation of file.obligations) {
    assertValidReportingObligation(obligation, context);
    if (ids.has(obligation.id)) fail(`${context}: obligation id "${obligation.id}" is used twice.`);
    ids.add(obligation.id);
  }
}

/**
 * The id an upgraded legacy fact gets: provider, document type, then the scope's transaction
 * categories. Unique for every shipped file (`obligation-v2.spec.ts` pins it); a collision is refused
 * by `assertValidReportingObligationFileV2`, never silently merged.
 */
function legacyObligationId(fact: ReportingObligationFact): string {
  const parts = [fact.providerId, fact.appliesTo];
  if (fact.scope) parts.push([...new Set(fact.scope.map((entry) => entry.transactions))].join('+'));
  return parts.join(':');
}

function upgradeFact(
  fact: ReportingObligationFact,
  countryCode: string,
  context: string,
): ReportingObligation {
  const id = legacyObligationId(fact);
  const paymentEntries = fact.scope?.filter((entry) => entry.transactions === 'payments').length ?? 0;
  if (paymentEntries > 0 && paymentEntries !== fact.scope?.length) {
    // `classify.ts` answers per entry and the legacy runner fires payments from a different hook
    // than documents; one v2 obligation has one trigger, so a mixed fact would need to be split,
    // and splitting it here would invent two ids the country file never declared.
    throw new LegacyReportingUpgradeError(
      `${context}: legacy fact "${id}" mixes "payments" with other scope categories; split it into ` +
        'one fact per trigger before it can be upgraded.',
    );
  }
  const obligation: ReportingObligation = {
    id,
    authority: { countryCode },
    // Every legacy fact is per-document data: the legacy runner is a one-shot, per-document job.
    kind: 'data',
    trigger: paymentEntries > 0 ? 'payment' : 'sent',
    scope: { documentTypes: [fact.appliesTo], ...(fact.scope ? { transactions: fact.scope } : {}) },
    legalBasis: { provenance: fact.provenance },
    channels: [{ dischargedBy: fact.dischargedBy, id: fact.providerId, unit: 'document' }],
  };
  const windows: ObligationApplicabilityWindow[] = [];
  if (fact.applicableFrom) {
    windows.push({ from: fact.applicableFrom.date, provenance: fact.applicableFrom.provenance });
  }
  for (const window of fact.applicability ?? []) {
    windows.push({
      from: window.from.date,
      ...(window.when?.companyProfile ? { when: { companyProfile: window.when.companyProfile } } : {}),
      provenance: window.from.provenance,
    });
  }
  if (windows.length > 0) obligation.applicability = windows;
  if (fact.periodicity) obligation.timingNote = fact.periodicity;
  if (fact.notes) obligation.notes = fact.notes;
  return obligation;
}

/**
 * Upgrades one legacy `reporting` section to v2, one obligation per legacy fact, and validates the
 * result so a legacy file that loads today either loads as v2 or is refused with a named error.
 * Lossless for every field the legacy shape has: nothing is dropped, nothing is invented beyond the
 * id, `kind: 'data'`, the trigger the legacy runner already applied, and `unit: 'document'`.
 */
export function upgradeLegacyFacts(
  file: CountryReportingObligationFile,
  context = `countries/data/${(file?.countryCode ?? '').toLowerCase()}.json#reporting`,
): CountryReportingObligationFileV2 {
  const countryCode = (file?.countryCode ?? '').toUpperCase();
  const upgraded: CountryReportingObligationFileV2 = {
    countryCode,
    obligations: (file?.facts ?? []).map((fact) => upgradeFact(fact, countryCode, context)),
  };
  assertValidReportingObligationFileV2(upgraded, context);
  return upgraded;
}
