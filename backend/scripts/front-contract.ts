/**
 * Generates `docs/compliance/FRONT-CONTRACT.yaml` — the per-country contract the FRONTEND has to
 * honour, ordered by how much this product needs each country.
 *
 * WHY IT IS GENERATED AND NOT WRITTEN BY HAND. The repository already holds per-country rules in
 * `src/compliance/profiles/data/*.ts`, sourced and temporal, and `coverage.spec.ts` /
 * `data-integrity.spec.ts` already keep them honest. Hand-writing a second per-country document
 * would create a third source of truth that drifts from the first two the day after it is written,
 * and — worse — it would invite filling forty countries with plausible prose nobody sourced. That
 * is the exact failure this whole audit exists to correct.
 *
 * So every value here is READ from the profiles, and carries `from:` saying which field it came
 * from. What the profiles do not know is emitted as `value: null` with `from: unverified` and an
 * `open_question`. Those nulls are the point: they are the sourcing worklist for P3-T01, and a
 * screen must not be designed against them until someone has looked them up.
 *
 * The `ui:` sentences are DESIGN statements — what the screen must therefore do. They are mine,
 * derived mechanically from the machine value, and they are not legal advice.
 *
 *   cd backend && npx ts-node scripts/front-contract.ts
 */
import { writeFileSync } from 'node:fs';
// js-yaml rather than a hand-rolled serializer: the first version of this script emitted invalid
// YAML that looked fine to the eye, which is the whole argument against home-grown machinery.
import { dump } from 'js-yaml';
import { join } from 'node:path';
import { defaultRegistry } from '../src/compliance/profiles/registry';
import { pickByDate, allByDate } from '../src/compliance/profiles/temporal';
import type { CountryComplianceProfile, VatSystemSpec } from '../src/compliance/profiles/schema';

/** Post-mandate, so France resolves its e-invoicing obligation rather than its pre-2026 shape. */
const AS_OF = new Date('2026-10-01');

/**
 * Priority order, most important first. This is a PRODUCT judgement, not a legal one:
 * user base first (FR, PL, IT are where the users are), then mandate pressure, then market size.
 * Everything below the first tier is "worth designing for", not "committed to".
 */
const PRIORITY: { code: string; why: string }[] = [
  { code: 'FR', why: 'primary market; mandate 2026-09-01 reception, staged issuance' },
  { code: 'DE', why: 'largest EU economy; B2B reception mandate in force' },
  { code: 'IT', why: 'primary market; SdI clearance live since 2019' },
  { code: 'US', why: 'largest market overall; no mandate, sales tax by state' },
  { code: 'PL', why: 'primary market; KSeF' },
  { code: 'ES', why: 'Veri*Factu / B2B mandate; bespoke rules already sourced' },
  { code: 'MX', why: 'CFDI clearance via PAC; bespoke profile exists' },
  { code: 'GB', why: 'large market adjacent to the EU; post-Brexit divergence' },
  { code: 'NL', why: 'high e-invoicing maturity, Peppol-native' },
  { code: 'BE', why: 'B2B mandate 2026-01-01' },
  { code: 'PT', why: 'ATCUD / SAF-T, strong existing obligations' },
  { code: 'IN', why: 'IRP e-invoicing at scale; GST' },
  { code: 'CN', why: 'largest Asian market; fully digital fapiao rollout' },
  { code: 'CA', why: 'GST/HST plus provincial variation' },
  { code: 'CH', why: 'non-EU, adjacent, common for FR/DE/IT businesses' },
  { code: 'SE', why: 'Peppol-native, high digital maturity' },
  { code: 'BR', why: 'NF-e, one of the oldest clearance regimes' },
  { code: 'JP', why: 'qualified invoice system since 2023' },
  { code: 'AU', why: 'Peppol, GST' },
  { code: 'AT', why: 'EU, B2G e-invoicing established' },
  { code: 'DK', why: 'Nemhandel / Peppol' },
  { code: 'NO', why: 'EHF / Peppol, non-EU EEA' },
  { code: 'FI', why: 'Peppol-native' },
  { code: 'IE', why: 'EU, English-speaking, common holding jurisdiction' },
  { code: 'LU', why: 'EU, high density of holding companies' },
  { code: 'CZ', why: 'EU, sizeable SME base' },
  { code: 'RO', why: 'RO e-Factura mandate in force' },
  { code: 'HU', why: 'RTIR real-time reporting since 2018' },
  { code: 'GR', why: 'myDATA' },
  { code: 'KR', why: 'long-standing e-Tax invoice regime' },
  { code: 'SG', why: 'InvoiceNow / Peppol' },
  { code: 'AE', why: 'VAT since 2018, e-invoicing programme' },
  { code: 'SA', why: 'ZATCA Fatoora clearance' },
  { code: 'TR', why: 'e-Fatura, mature clearance regime' },
  { code: 'ZA', why: 'largest African market' },
  { code: 'AR', why: 'AFIP clearance' },
  { code: 'CL', why: 'SII clearance, oldest in the region' },
  { code: 'CO', why: 'DIAN clearance' },
  { code: 'IL', why: 'clearance rollout under way' },
  { code: 'NZ', why: 'Peppol, GST' },
];

type Entry = { value: unknown; ui: string | null; from: string; open_question?: string };

const known = (value: unknown, ui: string, from: string): Entry => ({ value, ui, from });
const unknown = (from: string, open_question: string): Entry => ({
  value: null,
  ui: null,
  from,
  open_question,
});

const CORRECTION_UI: Record<string, string> = {
  CREDIT_NOTE:
    'An issued invoice is never edited. Correcting it means issuing a separate credit note that ' +
    'references it, so the screen needs a dedicated credit-note flow and must refuse in-place edits.',
  CORRECTIVE_INVOICE:
    'An issued invoice is corrected by a new corrective document that supersedes it and carries the ' +
    'reference to the original. The screen needs a "correct this invoice" flow, not an edit form.',
  CANCEL_AND_REPLACE:
    'The original is cancelled outright and a replacement is issued. The screen must present both ' +
    'steps as one action, because a cancellation left without a replacement is a hole in the series.',
};

const NUMBERING_UI: Record<string, string> = {
  GAPLESS_SELF:
    'The app allocates the number and the series must have no holes. The user must NOT be able to ' +
    'type, skip or reuse a number, and a failed issuance must not burn one silently.',
  UNIQUE_SELF:
    'The app allocates the number; it must be unique but gaps are tolerated. A user-chosen prefix ' +
    'or series is acceptable.',
  AUTHORITY_RANGE:
    'Numbers come from a range the tax authority grants. The screen must show how much of the range ' +
    'is left and refuse issuance when it is exhausted, because no number can be invented locally.',
};

function entriesFor(p: CountryComplianceProfile, isFallback: boolean): Record<string, Entry> {
  const lifecycle = pickByDate(p.lifecycle, AS_OF);
  const archival = pickByDate(p.archival, AS_OF);
  const numbering = pickByDate(p.numbering, AS_OF);
  const regime = pickByDate(p.regime, AS_OF);
  const transmission = allByDate(p.transmission, AS_OF);
  const obligations = allByDate(p.obligations ?? [], AS_OF);
  /**
   * Provenance, and it has to be honest about HOW MUCH the answer is worth.
   *
   * A fallback country has no file at all — citing `profiles/data/kr.ts` would name a file that
   * does not exist and read as sourced when nothing was sourced. A BEST_EFFORT profile does have a
   * file, but its rules were inherited from an archetype rather than looked up, so the citation is
   * real while the authority behind it is not. Both are marked in the string itself, because a
   * reader scanning `from:` will not go back and re-read the header.
   */
  const src = (field: string) => {
    if (isFallback) return `fallback-profile (no ${p.countryCode.toLowerCase()}.ts exists) → ${field}`;
    const suffix =
      p.confidence === 'OFFICIAL' ? '' : ` [${p.confidence} — inherited from an archetype, not sourced]`;
    return `profiles/data/${p.countryCode.toLowerCase()}.ts → ${field}${suffix}`;
  };

  const out: Record<string, Entry> = {};

  out.invoice_modification = lifecycle
    ? known(
        lifecycle.correctionModel,
        CORRECTION_UI[lifecycle.correctionModel] ?? 'No UI sentence mapped for this model.',
        src('lifecycle.correctionModel'),
      )
    : unknown(
        'unverified',
        'No lifecycle rule in force at the reference date. What corrects an invoice here?',
      );

  out.editable_after_issue = lifecycle
    ? known(
        lifecycle.immutableAfter,
        lifecycle.immutableAfter === 'NEVER'
          ? 'The document stays editable. The edit form may remain open after issuance.'
          : `The document freezes at ${lifecycle.immutableAfter.toLowerCase()}. After that the edit ` +
              'form must be closed and replaced by the correction flow above.',
        src('lifecycle.immutableAfter'),
      )
    : unknown('unverified', 'When does an invoice become immutable here?');

  out.invoice_cancellation = lifecycle
    ? known(
        lifecycle.cancellation,
        lifecycle.cancellation.allowed
          ? 'Cancellation exists as its own action, distinct from correction' +
              (lifecycle.cancellation.windowHours
                ? `, and only within ${lifecycle.cancellation.windowHours} h of issuance — the screen must show the deadline`
                : '') +
              (lifecycle.cancellation.requiresBuyerConsent
                ? '. It also requires the buyer to agree, so the flow needs a counterparty step'
                : '') +
              (lifecycle.cancellation.requiresAuthorityAck
                ? '. It is not final until the authority acknowledges it, so the UI must show a pending state'
                : '') +
              '.'
          : 'Cancellation is not available. The screen must not offer it; correction is the only route.',
        src('lifecycle.cancellation'),
      )
    : unknown('unverified', 'Is cancellation available here, and under what conditions?');

  out.numbering_control = numbering
    ? known(
        numbering.model,
        (NUMBERING_UI[numbering.model] ?? '') +
          (numbering.hashChain
            ? ' The series is hash-chained, so any renumbering after the fact is impossible by design.'
            : ''),
        src('numbering.model'),
      )
    : unknown('unverified', 'Who allocates the invoice number here?');

  out.zero_rate_declaration = (() => {
    const tax = p.taxSystem;
    if (tax.kind !== 'VAT' && tax.kind !== 'GST') {
      return known(
        'N_A',
        'Not a VAT/GST system, so the EN 16931 zero-rate question does not arise in this form.',
        src('taxSystem.kind'),
      );
    }
    const v = (tax as VatSystemSpec).hasDomesticZeroRate;
    if (v === undefined) {
      return unknown(
        'unverified',
        'Does this country levy a domestic ZERO RATE (taxable at 0%, input tax deductible), as ' +
          'opposed to exemptions only? Until answered, a 0% line keeps resolving to Z by default.',
      );
    }
    return known(
      v,
      v
        ? 'A 0% line may legitimately be zero-rated (Z). The category select should default to ' +
            'automatic and the exemption reason is not required.'
        : 'There is no zero rate, so a 0% line is an exemption or out of scope. The screen MUST let ' +
            'the user state which, and a reason, or issuance is refused (BR-E-10).',
      src('taxSystem.hasDomesticZeroRate'),
    );
  })();

  out.archival = archival
    ? known(
        {
          years: archival.retentionYears,
          residency: archival.residency ?? null,
          form: archival.archivedForm,
        },
        `Documents are kept ${archival.retentionYears} years` +
          (archival.residency ? `, stored in ${archival.residency}` : '') +
          '. The screen should say so where a user might otherwise delete something.',
        src('archival'),
      )
    : unknown('unverified', 'How long must documents be retained, and where?');

  out.transmission = transmission.length
    ? known(
        transmission.flatMap((t) => t.channels.map((c) => c.type + (c.providerId ? `:${c.providerId}` : ''))),
        'The user must connect these channels in settings before an invoice can leave the product. ' +
          'A country whose channel is not connected should say so before issuance, not at send time.',
        src('transmission[].channels'),
      )
    : unknown('unverified', 'How does an invoice physically leave the product here?');

  out.regime = regime
    ? known(
        regime.model,
        `Regime model in force at ${AS_OF.toISOString().slice(0, 10)}.`,
        src('regime.model'),
      )
    : unknown('unverified', 'Which regime applies at the reference date?');

  out.obligation_layers = obligations.length
    ? known(
        obligations.map((o) => ({ layer: o.layer, deadline: o.deadline ?? null })),
        'Issuance, reception and archival have separate triggers and deadlines; the screen must not ' +
          'present them as one switch.',
        src('obligations[]'),
      )
    : unknown(
        'not-modelled',
        'This profile has no per-layer obligations yet (only FR does). Reception and archival ' +
          'duties may start on different dates from issuance — unverified for this country.',
      );

  out.rejection_recovery = unknown(
    'not-modelled',
    'What may a user do after the authority REJECTS an invoice — resubmit under the same number, ' +
      'correct, or cancel? `REJECTED` is a terminal state in the runtime today (F-007 / D1), so no ' +
      'screen can be designed for this until the routes are sourced per country (P3-T01).',
  );

  out.buyer_identifiers_required = p.requiredIdentifiers.length
    ? known(
        p.requiredIdentifiers.filter((i) => i.required).map((i) => i.scheme),
        'The client form must require these before an invoice can be issued to that client.',
        src('requiredIdentifiers'),
      )
    : unknown(
        isFallback ? 'fallback-profile' : 'not-modelled',
        'Which identifiers must a counterparty carry here?',
      );

  return out;
}

const HEADER = `# FRONT-CONTRACT — what the interface must do, per country
#
# GENERATED FILE. Do not edit by hand; run:
#     cd backend && npx ts-node scripts/front-contract.ts
#
# WHAT THIS IS. Input to the front-end design, and to phase 3. It answers, per country, "what must
# the screen do differently here?" — ordered by how much this product needs the country, France
# first.
#
# WHERE THE VALUES COME FROM. Every one is READ from src/compliance/profiles/data/*.ts, the sourced
# and temporal country rules the engine itself uses, resolved as of ${AS_OF.toISOString().slice(0, 10)}
# (post-mandate, so France shows its e-invoicing shape). \`from:\` names the exact field. Nothing here
# is typed in from memory, because a second hand-written per-country document would drift from the
# profiles the day after it was written — and would invite filling forty countries with plausible
# prose nobody sourced, which is the failure this audit exists to correct.
#
# HOW TO READ AN ENTRY
#   value:          the machine answer, from the profile
#   ui:             what the screen must therefore do. This sentence is a DESIGN statement, derived
#                   mechanically from the value. It is not legal advice.
#   from:           provenance — a profile field, or one of:
#                     unverified    nobody has established this; the profile has no rule
#                     not-modelled  the schema cannot express it yet
#                     fallback-profile  this country has no real profile, only the generic fallback
#   open_question:  present whenever value is null. THESE ARE THE POINT. A null is not a gap in this
#                   document, it is a gap in what anyone has verified, and no screen may be designed
#                   against it until it is sourced (P3-T01).
#
# A WARNING ABOUT CONFIDENCE. \`profile.confidence\` below is the profile's own self-assessment.
# OFFICIAL means the rules were sourced; anything else means they were inferred from an archetype.
# Five countries are bespoke (FR, IT, PL, MX, US); the rest inherit defaults that are plausible and
# largely unverified. Treat a non-OFFICIAL country as a starting point for research, not an answer.
`;

const doc: Record<string, unknown> = {
  as_of: AS_OF.toISOString().slice(0, 10),
  countries: {} as Record<string, unknown>,
};

PRIORITY.forEach(({ code, why }, i) => {
  const resolved = defaultRegistry.resolve(code);
  const p = resolved.profile;
  const entry: Record<string, unknown> = {
    priority: i + 1,
    why_this_rank: why,
    display_name: p.displayName,
    profile: {
      confidence: p.confidence,
      is_fallback: resolved.isFallback,
      ...(resolved.delegatedFrom ? { delegates_to: p.countryCode } : {}),
    },
  };
  for (const [key, e] of Object.entries(entriesFor(p, resolved.isFallback))) {
    entry[key] = {
      value: e.value,
      ui: e.ui,
      from: e.from,
      ...(e.open_question ? { open_question: e.open_question } : {}),
    };
  }
  (doc.countries as Record<string, unknown>)[code] = entry;
});

const outPath = join(__dirname, '..', '..', 'docs', 'compliance', 'FRONT-CONTRACT.yaml');
writeFileSync(outPath, HEADER + dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }), 'utf-8');

const all = PRIORITY.map(({ code }) => defaultRegistry.resolve(code));
const nulls = PRIORITY.reduce((n, { code }) => {
  const r = defaultRegistry.resolve(code);
  return n + Object.values(entriesFor(r.profile, r.isFallback)).filter((e) => e.value === null).length;
}, 0);
console.log(`wrote ${outPath}`);
console.log(`  ${PRIORITY.length} countries`);
console.log(`  ${all.filter((r) => r.profile.confidence === 'OFFICIAL').length} with an OFFICIAL profile`);
console.log(`  ${all.filter((r) => r.isFallback).length} with no real profile at all (fallback)`);
console.log(`  ${nulls} unanswered keys — the P3-T01 sourcing worklist`);
