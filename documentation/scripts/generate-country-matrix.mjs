#!/usr/bin/env node
/**
 * Generates the "Country Support" docs pages FROM the compliance engine's own data files — never
 * the other way around. Same governing idea as before this rewrite (see git history for the prior
 * version's own header): nobody hand-writes "Poland allows X" in a markdown file that can silently
 * rot the day someone edits `backend/src/modules/documents/**\/data/pl.json` and forgets the doc.
 *
 * THIS REWRITE fixes six things the previous
 * version got wrong, all at once, because they are the same underlying bug wearing six hats: THE
 * SCRIPT WAS NOT LOCALE-AWARE, so English page and French data prose ended up mixed on both sides
 * of the fence.
 *
 *   1. LANGUAGE: this script now emits TWO trees — English into `../docs/developer-guide/
 *      country-support/` and French into `../i18n/fr/docusaurus-plugin-content-docs/current/
 *      developer-guide/country-support/` (the exact path Docusaurus's i18n plugin expects a
 *      translated doc page at — see any other hand-translated page under that same `i18n/fr/...`
 *      tree). Every label (yes/no/restricted, headers, explanatory sentences, glossary
 *      definitions) is read from the `STRINGS` table below, per locale — NEVER typed once and
 *      reused for both. Both trees are gitignored (`../.gitignore`).
 *   2. NO DATA PROSE LEAK: a data file's own `notes`/`resolutionNote` fields — free-form, hand-
 *      written, usually in French regardless of which page will read them — are NEVER rendered.
 *      What IS rendered is a STRUCTURED fact: a localized status (`legal`/`unverified`), a short
 *      SOURCE NAME (`sourceRef()` below — a simple heuristic over `notes`/`sourceText`, since no
 *      mechanism carries a dedicated citation-name field), and the `sourceCheckedAt` date. A
 *      genuinely QUOTED fragment of `sourceText` (see `extractQuotedFragments()`) — the actual
 *      words of the law, in whatever language the law is written in — surfaces ONLY inside a
 *      collapsible "Source (original language)" block: a citation is cited, never translated,
 *      and never left loose in the flowing prose of a page in a DIFFERENT language.
 *   3. TAXES: the matrix's Tax column is now a multi-rate summary read from `vat-rates/` (every
 *      category this country's own rate catalog declares) plus the `tax-systems/` kind — not a
 *      single rate. A country with no `vat-rates/` file still gets an honest line: whatever
 *      `tax-systems/` alone knows (typically a single TEDB-sourced standard rate) — never invented
 *      categories the source data doesn't have. Country pages list every rate with its own
 *      category and its own provenance.
 *   4. IDENTIFIERS: a matrix column (count + scheme ids) plus the existing per-country table.
 *   5. MENTIONS: dropped from the matrix (it was the least informative column at that resolution)
 *      — kept as a full section on a country's own page, same as before.
 *   6. GLOSSARY: a `{en, fr}` glossary of the domain's own jargon (B2G, CIUS, Peppol, EAS,
 *      Schematron, credit note/avoir, e-reporting, franchise, clearance, PDP, KSeF, SdI) lives in
 *      this script (`GLOSSARY` below). The FIRST occurrence of a glossary term's own display text
 *      on a given page is wrapped in `<abbr title="…">` (a real HTML tag MDX passes through as-is —
 *      verified by this task's own doc build) so a newcomer gets a tooltip and an expert is not
 *      slowed down by a definition repeated on every line. The full glossary is also listed once,
 *      spelled out, at the bottom of the matrix page.
 *
 * WIRING: run as `prebuild`/`prestart` (see ../package.json).
 *
 * DETERMINISM: no `Date.now()`, no `Math.random()`, no network call — every byte of output is a
 * pure function of the JSON/TS files this script reads, and every directory listing is sorted
 * before use. Two runs against the same source tree produce byte-identical output in BOTH trees.
 *
 * SCOPE: this script does not validate the data (the backend's own `assertValid*` gates at
 * `data/all.ts` load time already do that) — it only READS and RENDERS. A malformed file here
 * fails loudly (the aggregator functions below throw with the offending path) rather than silently
 * skipping a country.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DOCUMENTS_ROOT = join(REPO_ROOT, 'backend', 'src', 'modules', 'documents');

const LOCALES = ['en', 'fr'];
const OUT_DIRS = {
  en: join(__dirname, '..', 'docs', 'developer-guide', 'country-support'),
  fr: join(
    __dirname,
    '..',
    'i18n',
    'fr',
    'docusaurus-plugin-content-docs',
    'current',
    'developer-guide',
    'country-support',
  ),
};

// =================================================================================================
// DATA LOADING — locale-free. Reads exactly what the backend itself would load.
// =================================================================================================
function loadDataDir(relPath) {
  const dir = join(DOCUMENTS_ROOT, relPath);
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir)
    .filter((f) => /^[a-z]{2}\.json$/.test(f))
    .sort();
  const out = {};
  for (const file of files) {
    const cc = file.slice(0, 2).toUpperCase();
    const full = join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, 'utf-8'));
    } catch (err) {
      throw new Error(`generate-country-matrix: could not parse ${full}: ${err.message}`);
    }
    out[cc] = parsed;
  }
  return out;
}

const countryPolicy = loadDataDir('country-policy/data');
// b2g-routing files wrap the fact in a top-level { countryCode, rule } envelope (unlike every
// sibling mechanism, which is flat) — see b2g-routing/schema.ts's own CountryB2gRoutingFile.
const b2gRouting = Object.fromEntries(
  Object.entries(loadDataDir('b2g-routing/data')).map(([cc, file]) => [cc, file.rule]),
);
const correctionRoutes = loadDataDir('correction-routes/data');
const channelPolicy = loadDataDir('transports/channel-policy/data');
const taxSystems = loadDataDir('tax/tax-systems/data');
const countryIdentifiers = loadDataDir('country-identifiers/data');
const mentions = loadDataDir('mentions/data');
const countryFields = loadDataDir('country-fields/data');
const contentRequirements = loadDataDir('content-requirements/data');
const vatRates = loadDataDir('vat-rates/data');

// ---------------------------------------------------------------------------------------------
// The local-cancellation whitelist lives in TypeScript (`correction-routes/cancel-policy.ts`), a
// plain data literal extracted here by brace-matching rather than hand-copied (see the previous
// version of this script, preserved in git history, for the full reasoning — unchanged by this
// rewrite).
// ---------------------------------------------------------------------------------------------
function loadCancelWhitelist() {
  const path = join(DOCUMENTS_ROOT, 'correction-routes', 'cancel-policy.ts');
  const src = readFileSync(path, 'utf-8');
  const marker = 'const CANCEL_LOCAL_AVAILABILITY';
  const markerIdx = src.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(
      `generate-country-matrix: "${marker}" not found in ${path} — the cancel-policy.ts shape ` +
        'changed; update loadCancelWhitelist() in this script to match.',
    );
  }
  const braceStart = src.indexOf('{', markerIdx);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const literal = src.slice(braceStart, i);
  return new Function(`"use strict"; return (${literal});`)();
}

const cancelWhitelist = loadCancelWhitelist();

function findCorrectionRoute(file, routeId) {
  return file?.routes?.find((r) => r.routeId === routeId);
}

/** Mirrors `resolveCancelPolicyForCountry` in cancel-policy.ts. Returns a locale-FREE key plus the
 *  raw facts a localized template needs to interpolate — never prose. */
function resolveCancelPolicy(cc) {
  const route = findCorrectionRoute(correctionRoutes[cc], 'CANCEL_AND_REPLACE');
  if (!route) return { key: 'NONE' };
  const whitelisted = cancelWhitelist[cc];
  if (!whitelisted) return { key: 'NO', routeStatus: route.status };
  if (route.status !== whitelisted.expectedStatus) {
    return { key: 'DRIFT', expected: whitelisted.expectedStatus, actual: route.status };
  }
  if (whitelisted.restrictedToStatuses) {
    return { key: 'RESTRICTED', statuses: whitelisted.restrictedToStatuses, routeStatus: route.status };
  }
  return { key: 'YES', routeStatus: route.status };
}

function sourcedRouteCount(file) {
  if (!file) return null;
  const total = file.routes.length;
  const sourced = file.routes.filter((r) => r.status !== 'unverified').length;
  return { sourced, total };
}

/** `standardRate` is OPTIONAL on a VAT/GST fact — when absent, derive it from `vat-rates/`'s own
 *  STANDARD-category entry for the same country (see `tax/tax-systems/schema.ts`'s own "DELIBERATE
 *  NON-DUPLICATION" header). Locale-free: returns the raw number plus whether it was derived. */
function resolveStandardRate(cc, fact) {
  if (fact.standardRate !== undefined) return { rate: fact.standardRate, derived: false };
  const standard = vatRates[cc]?.rates?.find((r) => r.category === 'STANDARD');
  return standard ? { rate: standard.rate, derived: true } : { rate: undefined, derived: false };
}

// =================================================================================================
// STRING TABLES — every label a page can show, per locale. NOTHING below this line that ends up in
// a page's prose may come from a data file's own `notes`/`resolutionNote` (rule #2 above): a data
// file may only supply FACTS (a rate, a date, a scheme id, a quoted fragment of law) that these
// strings describe.
// ---------------------------------------------------------------------------------------------
// Both locale trees are asserted to declare the exact same set of keys at every level
// (`assertSameShape` below) — the same discipline `frontend/`'s own `npm run i18n:check` applies
// to `t()` keys, applied here to this script's OWN string table instead of a JSON locale file.
// ---------------------------------------------------------------------------------------------
const STRINGS = {
  en: {
    common: {
      yes: 'yes',
      no: 'no',
      dash: '—',
      restricted: 'restricted',
      legal: 'legal',
      unverified: 'unverified',
      required: 'required',
      optional: 'optional',
      mandated: 'mandated',
      suggested: 'suggested',
      sourceOriginal: 'Source (original language)',
      checkedOn: (date) => `checked ${date}`,
      unverifiedNote: 'Not yet sourced to a specific legal text.',
      noFile: (mechanism) => `No ${mechanism} data declared for this country.`,
      seeGlossary: 'See the glossary at the bottom of the compliance matrix for the terms used here.',
    },
    kinds: { VAT: 'VAT', GST: 'GST', SALES_TAX: 'Sales tax', NONE: 'No tax' },
    categories: {
      STANDARD: 'Standard',
      REDUCED: 'Reduced',
      SUPER_REDUCED: 'Super-reduced',
      ZERO: 'Zero-rated',
      EXEMPT: 'Exempt',
    },
    schemes: { STANDARD: 'standard', FRANCHISE_BASE: 'franchise', EXEMPT: 'exempt' },
    partyTypes: { COMPANY: 'company', INDIVIDUAL: 'individual', BOTH: 'company or individual' },
    routeStatuses: {
      required: 'required',
      allowed: 'allowed',
      forbidden: 'forbidden',
      unverified: 'unverified',
    },
    routes: {
      CREDIT_NOTE: 'Credit note',
      DEBIT_NOTE: 'Debit note',
      CORRECTIVE_INVOICE: 'Corrective invoice',
      CANCEL_AND_REPLACE: 'Cancel and replace',
      INTERNAL_CREDIT_NOTE: 'Internal credit note',
      AUTHORITY_ANNULMENT: 'Authority-side annulment',
      RESUBMIT_SAME_IDENTITY: 'Resubmit under the same identity',
      ANNOTATED_DUPLICATE: 'Annotated duplicate',
      LEDGER_ANNOTATION: 'Ledger annotation only',
      NO_DOCUMENT_BY_LAW: 'No document required by law',
      COUNTERPARTY_OBJECTION: 'Counterparty objection',
    },
    cancel: {
      tagNone: '—',
      tagNo: 'no',
      tagDrift: '⚠ drift',
      tagRestricted: 'restricted',
      tagYes: 'yes',
      detailNone:
        'No correction-routes data (CANCEL_AND_REPLACE) declared for this country — nothing to evaluate.',
      detailNo: (status) =>
        `Not implementable locally: CANCEL_AND_REPLACE is "${status}" in this country's own ` +
        'correction-routes data, but no local cancellation mechanism is wired for it (see ' +
        'correction-routes/cancel-policy.ts — the law may allow the route, the channel/mechanism to ' +
        'realize it here does not exist yet).',
      detailDrift: (expected, actual) =>
        `cancel-policy.ts's whitelist expected CANCEL_AND_REPLACE status "${expected}" but the data ` +
        `now says "${actual}" — the whitelist in correction-routes/cancel-policy.ts needs review; ` +
        'this line is not a reliable fact until it is.',
      detailRestricted: (statuses) =>
        `Available, but only while the invoice is in status ${statuses.join(', ')} — ` +
        'CANCEL_AND_REPLACE narrows to this in this country\'s own data.',
      detailYes: 'Available, unrestricted — CANCEL_AND_REPLACE carries no status narrowing.',
    },
    transportModel: {
      clearance: 'clearance model',
      postAudit: 'post-audit model',
    },
    matrix: {
      title: 'Country Compliance Matrix',
      description:
        "Every mechanism, per country, read straight from the compliance engine's own data files.",
      heading: 'Country compliance matrix',
      generatedNotice:
        '**This page is generated.** Every cell below is read directly from the JSON data files ' +
        'the compliance engine itself loads at boot — nobody hand-typed these facts, and nobody ' +
        'can let them drift: rerun `npm run build` (or `npm run start`) in `documentation/` and this ' +
        'page is rebuilt from whatever the data files say today. See ' +
        '[Adding a country](../adding-a-country.md) to add a row or a column.',
      countCaption: (n) =>
        `${n} countries are known to at least one mechanism. A value means the fact is declared ` +
        'and sourced (or explicitly marked unverified — see the country page); a **—** means this ' +
        'exact mechanism has no file for this country at all: an honest absence, never a guessed ' +
        'default.',
      colCountry: 'Country',
      colPolicy: 'Policy',
      colB2g: 'B2G route',
      colCorrection: 'Correction routes',
      colCancel: 'Local cancel',
      colTax: 'Taxes',
      colIdentifiers: 'Identifiers',
      colChannel: 'Channel mandate',
      legendHeading: 'What each column reads',
      legendCol: 'Column',
      legendDir: 'Source directory',
      legendMeaning: 'Meaning',
      legendPolicy:
        'Whether this country has a document-action policy file at all (which document ' +
        'ACTIONS — send, save-draft, … — are allowed, and under what restriction).',
      legendB2g:
        "The transport + format used when this country is the government client's own country, " +
        "regardless of the seller's own country. See the glossary for B2G, Peppol, CIUS and EAS.",
      legendCorrection:
        'How many of the eleven canonical correction routes (credit note, corrective invoice, ' +
        'cancel-and-replace, …) are sourced to a real legal citation for this country, out of 11.',
      legendCancel:
        'Whether cancelling an already-issued invoice is actually implementable in this app for ' +
        'this country — **yes** (unrestricted), **restricted** (only from certain statuses), or ' +
        '**no** (the legal route may exist, but no channel/mechanism in this repo realizes it — see ' +
        'the country page).',
      legendTax:
        'Every VAT/GST rate this country\'s own catalog declares (when it has one), plus the tax ' +
        'kind the cross-border tax engine assumes. A country with no rate catalog still shows the ' +
        'one rate `tax-systems/` knows.',
      legendIdentifiers:
        'How many national identifier schemes (SIRET, EIN, VAT number, …) this country requires on ' +
        'a party, and which ones.',
      legendChannel:
        'What this country says about a transmission channel for a SELLER established there: ' +
        'merely the usual one (**suggested**) or legally required from a given date (**mandated**). ' +
        'This is a delivery-channel fact only — see the glossary entry for e-reporting for the ' +
        'separate (and not yet covered by this page) declarative obligation some countries add.',
      glossaryHeading: 'Glossary',
      glossaryIntro:
        'Terms used across this page and the country pages below. The first time one of these ' +
        'terms appears in the flowing text of a page, it also carries this same definition as a ' +
        'hover tooltip.',
      footer: (dirs) =>
        "_Generated from the compliance engine's own data files — do not edit by hand. Sources: " +
        `${dirs}. See [Adding a country](../adding-a-country.md) for how to extend any of these. ` +
        'Regenerate with `node documentation/scripts/generate-country-matrix.mjs` (also runs ' +
        'automatically before `npm run build`/`npm run start` in `documentation/`)._',
    },
    country: {
      descriptionOf: (name) => `What ${name} may do, per the compliance engine's own data files.`,
      generatedNotice:
        "> Generated from the compliance engine's own data files — do not edit by hand. See " +
        '[Adding a country](../adding-a-country.md) to change what this page says (by changing ' +
        'the data, never this file).',
      sectionPolicy: 'Document-action policy',
      sectionB2g: 'B2G routing',
      sectionCorrection: 'Correction routes',
      sectionCancel: 'Local cancellation of an issued invoice',
      sectionTax: 'Tax system',
      sectionIdentifiers: 'Required identifiers',
      sectionMentions: 'Mandatory mentions',
      sectionChannel: "Channel mandate (this country as a seller's own country)",
      sectionFieldOverlay: 'Field overlay (bonus)',
      sectionContentRequirements: 'Content requirements (bonus)',
      policyIntro: (types) => `Document types shown for a company of this country: ${types}.`,
      policyColType: 'Type',
      policyColAction: 'Action',
      policyColAllowed: 'Allowed',
      policyColRestrictedTo: 'Restricted to status',
      policyColProvenance: 'Provenance',
      forbidden: '✗ forbidden',
      b2gIntro: "What happens when a company sends an invoice to a government client of this country.",
      b2gCiusNote:
        'This only names the transport and format; a Peppol-based country may additionally require ' +
        'a national CIUS (a stricter Schematron-validated profile) and always addresses each ' +
        "recipient through an EAS-qualified participant id — see this country's own facts below for " +
        'whether either applies here.',
      b2gTransport: 'Transport',
      b2gFormat: 'Format',
      b2gClientIdentifiers: 'Required client identifiers',
      b2gDocumentFields: 'Document fields',
      b2gProvenance: 'Provenance',
      correctionIntro: (sourced, total) =>
        `Sourced: ${sourced}/${total} routes (the rest are honestly \`unverified\`).`,
      correctionColRoute: 'Route',
      correctionColStatus: 'Status',
      correctionColProvenance: 'Provenance',
      taxColKind: 'Kind',
      taxStandardRate: 'Standard rate',
      taxStandardRateDerived:
        ' _(not declared in this tax-system file — derived from the vat-rates catalog\'s own ' +
        'STANDARD entry below)_',
      taxDomesticZeroRate: 'Domestic zero rate',
      taxSchemes: 'VAT schemes',
      taxStateRates: 'State rates',
      taxProvenance: 'Provenance',
      taxCatalogIntro: 'Every rate this country\'s own catalog declares (what a user actually picks per line):',
      taxNoCatalogNote:
        'This country has no full rate catalog (`vat-rates/`) yet — only the standard rate below, ' +
        'from the tax-system envelope (commonly the EU\'s TEDB), is available.',
      taxRateColRate: 'Rate',
      taxRateColLabel: 'Label',
      taxRateColCategory: 'Category',
      taxRateColProvenance: 'Provenance',
      identifiersColScheme: 'Scheme',
      identifiersColAppliesTo: 'Applies to',
      identifiersColLabel: 'Label',
      identifiersColRequired: 'Required',
      identifiersColProvenance: 'Provenance',
      mentionsColSubject: 'Subject',
      mentionsColText: 'Text (as issued)',
      mentionsColLegalRef: 'Legal ref',
      mentionsColValidFrom: 'Valid from',
      channelIntro: 'What this country legally requires (or merely suggests) for a seller established there.',
      channelEreportingNote:
        'This covers the delivery channel only — a country can separately require e-reporting ' +
        "(declaring the invoice's data to its own tax authority, regardless of delivery channel), " +
        'not yet exposed on this page.',
      channelColChannel: 'Channel',
      channelColRequirement: 'Requirement',
      channelColMandatedFrom: 'Mandated from',
      channelColProvenance: 'Provenance',
      fieldOverlayIntro: 'What this country adds/modifies/removes on top of the trunk document shape:',
      fieldOverlayAdd: (key, on) => `**add** \`${key}\` on \`${on}\``,
      fieldOverlayModify: (key, on) => `**modify** \`${key}\` on \`${on}\``,
      fieldOverlayRemove: (key, on) => `**remove** \`${key}\` from \`${on}\``,
      contentReqColField: 'Field',
      contentReqColMandatedFrom: 'Mandated from',
      contentReqColProvenance: 'Provenance',
      footer: (sources) =>
        "_Generated from the compliance engine's own data files — do not edit by hand. Sources: " +
        `${sources}._`,
      seeGlossaryLink: 'See the glossary on the [compliance matrix](./index.md) for the technical terms used on this page.',
      part1Heading: 'Part 1 — In plain words',
      part2Heading: 'Part 2 — The details',
      part1Intro: (name) =>
        `What running a business in ${name} means for your documents, explained simply — no unexplained ` +
        'jargon (hover, or tap, any underlined term for a plain definition).',
      part2Intro:
        "Every fact below is read straight from this app's own data files, at build time — never typed " +
        "by hand — with its exact legal source when one has been checked against the law itself.",
      notConfiguredTitle: 'Not yet configured',
      notConfiguredBody: (name, mechanismPlain) =>
        `This app does not have an answer yet for ${name} on this: **${mechanismPlain}**. That is an ` +
        'open, honest gap — not a hidden default and not "probably fine": this app would rather say ' +
        '"not yet configured" than guess. See [Adding a country](../adding-a-country.md) for how to close it.',
      mechanismPlainPolicy: 'which documents you can create, and what you can do with them',
      mechanismPlainB2g: 'selling to a government client',
      mechanismPlainCorrection: 'fixing a mistake on an invoice you already sent',
      mechanismPlainCancel: "cancelling an invoice you've already sent",
      mechanismPlainTax: 'sales tax (VAT)',
      mechanismPlainIdentifiers: 'the ID numbers a business here must show on an invoice',
      mechanismPlainMentions: 'extra legal text and fields every invoice must carry',
      mechanismPlainChannel: 'whether the law forces you to use one particular delivery channel',
      plainPolicyIntro: (name, types) =>
        `As a business based in ${name}, this app lets you create and manage: ${types}.`,
      plainPolicyRestriction: (actionLabel, typeArticled, statusLabel) =>
        `One nuance: you can only ${actionLabel} ${typeArticled} while its status is still "${statusLabel}".`,
      plainPolicyForbidden: (actionLabel, typeArticled) =>
        `One restriction: the law here does not let you ${actionLabel} ${typeArticled}.`,
      plainB2gIntro: (name, transportLabel, formatLabel) =>
        `If you sell to a government body in ${name}, the invoice cannot just be emailed — it must travel ` +
        `through ${transportLabel}, built in the ${formatLabel} format. This app handles that for you once ` +
        'the channel is connected; you just need to have the right information about your government client on file first.',
      plainB2gIdentifierNeeded: (label) => `their **${label}**`,
      plainB2gFieldNeeded: (label) => `**${label}** filled in on the invoice`,
      plainB2gNeedsIntro: 'Before you can send, you will need:',
      plainCorrectionLegend:
        'Four honest answers a country\'s law can give for each way of fixing a mistake: **required** ' +
        '(the law says you must use this one for this kind of situation), **allowed** (you may use it), ' +
        '**forbidden** (the law does not let you use it here), and **unverified** (nobody has checked the ' +
        'actual law for this one yet — not "no", just "not researched").',
      plainCorrectionIntro: (name, sourced, total) =>
        `${name}'s law has been checked, so far, for ${sourced} of the ${total} ways this app knows to fix ` +
        'a mistake on an invoice. The ones actually confirmed:',
      plainCorrectionNoneSourced: 'None of them have been checked against the actual law yet.',
      plainCancelYes:
        'Yes. If you need to, you can cancel an invoice you already sent and issue a corrected one in its ' +
        'place, with no extra restriction from this country\'s own law.',
      plainCancelRestricted: (statusLabel) =>
        'Only in one situation: cancelling and re-issuing an invoice is possible while it is still ' +
        `"${statusLabel}" — not once it has gone further than that.`,
      plainCancelNo:
        'Not through this app yet. The law here may allow it in principle, but no channel or mechanism in ' +
        'this app actually carries it out for this country yet — a known gap, not a silent "no".',
      plainCancelNone: 'Nothing is declared yet for this country — see the details below for what would settle it.',
      plainCancelDrift:
        "This app's own records disagree with each other about this — see the details below rather than " +
        'trusting a plain answer until that is sorted out.',
      plainTaxIntro: (name, kindLabel, rate) =>
        `If you're registered for ${kindLabel} in ${name}, the standard rate is ${rate} — the percentage ` +
        'added on top of most sales.',
      plainTaxIntroNoRate: (name, kindLabel) =>
        `${name} uses ${kindLabel}, but this app does not yet have its standard rate on file.`,
      plainTaxReduced: (list) => `Some categories of goods or services get a lower rate instead: ${list}.`,
      plainTaxOtherKind: (name, kindLabel) =>
        `${name} uses ${kindLabel} rather than VAT — see Part 2 below for what this app has on file about it.`,
      plainTaxNone: (name) => `${name} is on file as charging no general sales tax at all on an invoice.`,
      plainIdentifiersIntro: (name) =>
        `When you invoice someone in ${name}, or when someone in ${name} invoices through this app, these ` +
        'ID numbers matter:',
      plainIdentifierRequired: (label, partyType) => `**${label}** — required, for a ${partyType}.`,
      plainIdentifierOptional: (label, partyType) => `${label} — optional, for a ${partyType}.`,
      plainMentionsIntro: (name, count) =>
        `Every invoice issued in ${name} must legally carry ${count} standard sentence${count === 1 ? '' : 's'} ` +
        'printed on it (about late-payment penalties, for example). This app adds them for you automatically — ' +
        'see Part 2 below for the exact, word-for-word legal text.',
      plainContentRequirementsIntro: (name, count) =>
        `On top of that, ${name} law requires ${count} extra field${count === 1 ? '' : 's'} to carry a ` +
        `${name}-specific value on certain invoices, from a set date — see Part 2 for exactly which field(s).`,
      plainChannelMandated: (name, channelLabel, date) =>
        `Yes — if your business is established in ${name}, the law requires you, from ${date}, to send ` +
        `invoices through ${channelLabel}. This app blocks sending through any other channel from that date, ` +
        'on purpose: sending the right invoice through the wrong channel is treated as a real block, not a warning.',
      plainChannelSuggested: (name, channelLabel) =>
        `Not required by law, but ${channelLabel} is the channel businesses in ${name} normally use.`,
      plainChannelNone: (name) =>
        `${name} does not, as far as this app's data goes, force a particular delivery channel on a ` +
        'business established there (selling to a *government* client can be a different story — see above).',
    },
  },
  fr: {
    common: {
      yes: 'oui',
      no: 'non',
      dash: '—',
      restricted: 'restreinte',
      legal: 'légal',
      unverified: 'non vérifié',
      required: 'obligatoire',
      optional: 'facultatif',
      mandated: 'obligatoire',
      suggested: 'suggéré',
      sourceOriginal: 'Source (langue originale)',
      checkedOn: (date) => `consulté le ${date}`,
      unverifiedNote: "Pas encore sourcé à un texte de loi précis.",
      noFile: (mechanism) => `Aucune donnée « ${mechanism} » déclarée pour ce pays.`,
      seeGlossary: 'Voir le glossaire en bas de la matrice de conformité pour les termes utilisés ici.',
    },
    kinds: { VAT: 'TVA', GST: 'TPS', SALES_TAX: 'Taxe sur les ventes', NONE: 'Pas de taxe' },
    categories: {
      STANDARD: 'Normal',
      REDUCED: 'Réduit',
      SUPER_REDUCED: 'Super-réduit',
      ZERO: 'Taux zéro',
      EXEMPT: 'Exonéré',
    },
    schemes: { STANDARD: 'standard', FRANCHISE_BASE: 'franchise en base', EXEMPT: 'exonéré' },
    partyTypes: { COMPANY: 'entreprise', INDIVIDUAL: 'particulier', BOTH: 'entreprise ou particulier' },
    routeStatuses: {
      required: 'obligatoire',
      allowed: 'permise',
      forbidden: 'interdite',
      unverified: 'non vérifiée',
    },
    routes: {
      CREDIT_NOTE: 'Avoir',
      DEBIT_NOTE: 'Note de débit',
      CORRECTIVE_INVOICE: 'Facture corrective',
      CANCEL_AND_REPLACE: 'Annulation et remplacement',
      INTERNAL_CREDIT_NOTE: 'Avoir interne',
      AUTHORITY_ANNULMENT: "Annulation côté administration",
      RESUBMIT_SAME_IDENTITY: 'Renvoi sous la même identité',
      ANNOTATED_DUPLICATE: 'Duplicata annoté',
      LEDGER_ANNOTATION: 'Annotation comptable uniquement',
      NO_DOCUMENT_BY_LAW: 'Aucun document requis par la loi',
      COUNTERPARTY_OBJECTION: 'Contestation de la contrepartie',
    },
    cancel: {
      tagNone: '—',
      tagNo: 'non',
      tagDrift: '⚠ dérive',
      tagRestricted: 'restreinte',
      tagYes: 'oui',
      detailNone:
        "Aucune donnée correction-routes (CANCEL_AND_REPLACE) déclarée pour ce pays — rien à évaluer.",
      detailNo: (status) =>
        `Non réalisable localement : CANCEL_AND_REPLACE est « ${status} » dans les données ` +
        "correction-routes propres à ce pays, mais aucun mécanisme d'annulation local n'y est " +
        'câblé (voir correction-routes/cancel-policy.ts — la loi peut permettre la voie, le canal/' +
        "mécanisme pour la réaliser ici n'existe pas encore).",
      detailDrift: (expected, actual) =>
        `La liste blanche de cancel-policy.ts attendait le statut « ${expected} » pour ` +
        `CANCEL_AND_REPLACE, mais la donnée dit maintenant « ${actual} » — la liste blanche dans ` +
        "correction-routes/cancel-policy.ts doit être revue ; cette ligne n'est pas un fait fiable " +
        "tant que ce n'est pas fait.",
      detailRestricted: (statuses) =>
        `Disponible, mais seulement tant que la facture est au statut ${statuses.join(', ')} — ` +
        "CANCEL_AND_REPLACE se restreint à cela dans les données propres à ce pays.",
      detailYes: 'Disponible, sans restriction — CANCEL_AND_REPLACE ne porte aucune restriction de statut.',
    },
    transportModel: {
      clearance: 'modèle de clearance',
      postAudit: 'modèle post-audit',
    },
    matrix: {
      title: 'Matrice de conformité par pays',
      description:
        "Chaque mécanisme, par pays, lu directement dans les fichiers de données du moteur de conformité.",
      heading: 'Matrice de conformité par pays',
      generatedNotice:
        '**Cette page est générée.** Chaque cellule ci-dessous est lue directement dans les ' +
        'fichiers de données JSON que le moteur de conformité charge lui-même au démarrage — ' +
        "personne n'a tapé ces faits à la main, et personne ne peut les laisser dériver : " +
        'relancez `npm run build` (ou `npm run start`) dans `documentation/` et cette page est ' +
        "reconstruite à partir de ce que disent les fichiers de données aujourd'hui. Voir " +
        '[Ajouter un pays](../adding-a-country.md) pour ajouter une ligne ou une colonne.',
      countCaption: (n) =>
        `${n} pays sont connus d'au moins un mécanisme. Une valeur signifie que le fait est ` +
        "déclaré et sourcé (ou explicitement marqué non vérifié — voir la page du pays) ; un **—** " +
        "signifie que ce mécanisme précis n'a aucun fichier du tout pour ce pays : une absence " +
        'honnête, jamais une valeur par défaut devinée.',
      colCountry: 'Pays',
      colPolicy: 'Politique',
      colB2g: 'Voie B2G',
      colCorrection: 'Voies de correction',
      colCancel: 'Annulation locale',
      colTax: 'Taxes',
      colIdentifiers: 'Identifiants',
      colChannel: 'Canal obligatoire',
      legendHeading: 'Ce que lit chaque colonne',
      legendCol: 'Colonne',
      legendDir: 'Répertoire source',
      legendMeaning: 'Signification',
      legendPolicy:
        "Si ce pays a un fichier de politique d'actions documentaires du tout (quelles ACTIONS " +
        'documentaires — envoi, enregistrement en brouillon, … — sont permises, et sous quelle ' +
        'restriction).',
      legendB2g:
        "Le transport et le format utilisés quand ce pays est celui du client GOUVERNEMENTAL, " +
        "quel que soit le pays du vendeur. Voir le glossaire pour B2G, Peppol, CIUS et EAS.",
      legendCorrection:
        'Combien des onze voies de correction canoniques (avoir, facture corrective, annulation ' +
        'et remplacement, …) sont sourcées à une vraie citation légale pour ce pays, sur 11.',
      legendCancel:
        "Si annuler une facture déjà émise est réellement réalisable dans cette application pour " +
        'ce pays — **oui** (sans restriction), **restreinte** (seulement depuis certains statuts), ' +
        'ou **non** (la voie légale peut exister, mais aucun canal/mécanisme de ce dépôt ne la ' +
        'réalise — voir la page du pays).',
      legendTax:
        "Chaque taux de TVA/TPS que le catalogue propre à ce pays déclare (quand il en a un), plus " +
        "le type de taxe que le moteur de taxe transfrontalière suppose. Un pays sans catalogue de " +
        'taux affiche quand même le seul taux que `tax-systems/` connaît.',
      legendIdentifiers:
        "Combien de schémas d'identifiant national (SIRET, EIN, numéro de TVA, …) ce pays exige " +
        "sur une partie, et lesquels.",
      legendChannel:
        "Ce que ce pays dit d'un canal de transmission pour un VENDEUR établi chez lui : simplement " +
        "l'usage habituel (**suggéré**) ou légalement obligatoire à partir d'une date donnée " +
        '(**obligatoire**). Ceci ne couvre que le canal de remise — voir le glossaire pour ' +
        "l'e-reporting, l'obligation déclarative distincte que certains pays ajoutent, non encore " +
        'couverte par cette page.',
      glossaryHeading: 'Glossaire',
      glossaryIntro:
        "Termes utilisés sur cette page et les pages pays ci-dessous. La première apparition d'un " +
        "de ces termes dans le texte d'une page porte aussi cette même définition en infobulle.",
      footer: (dirs) =>
        "_Générée depuis les propres fichiers de données du moteur de conformité — ne pas modifier " +
        `à la main. Sources : ${dirs}. Voir [Ajouter un pays](../adding-a-country.md) pour étendre ` +
        "l'un de ces mécanismes. Régénérer avec `node documentation/scripts/generate-country-" +
        'matrix.mjs` (aussi lancé automatiquement avant `npm run build`/`npm run start` dans ' +
        '`documentation/`)._',
    },
    country: {
      descriptionOf: (name) =>
        `Ce que ${name} peut faire, d'après les propres fichiers de données du moteur de conformité.`,
      generatedNotice:
        "> Générée depuis les propres fichiers de données du moteur de conformité — ne pas " +
        'modifier à la main. Voir [Ajouter un pays](../adding-a-country.md) pour changer ce que ' +
        'cette page dit (en changeant la donnée, jamais ce fichier).',
      sectionPolicy: "Politique d'actions documentaires",
      sectionB2g: 'Routage B2G',
      sectionCorrection: 'Voies de correction',
      sectionCancel: "Annulation locale d'une facture déjà émise",
      sectionTax: 'Régime de taxe',
      sectionIdentifiers: 'Identifiants requis',
      sectionMentions: 'Mentions obligatoires',
      sectionChannel: 'Canal obligatoire (ce pays comme pays du vendeur)',
      sectionFieldOverlay: 'Surcouche de champs (bonus)',
      sectionContentRequirements: 'Exigences de contenu (bonus)',
      policyIntro: (types) =>
        `Types de documents affichés pour une entreprise de ce pays : ${types}.`,
      policyColType: 'Type',
      policyColAction: 'Action',
      policyColAllowed: 'Permise',
      policyColRestrictedTo: 'Restreinte au statut',
      policyColProvenance: 'Provenance',
      forbidden: '✗ interdite',
      b2gIntro: 'Ce qui se passe quand une entreprise envoie une facture à un client gouvernemental de ce pays.',
      b2gCiusNote:
        'Ceci ne nomme que le transport et le format ; un pays basé sur Peppol peut en plus exiger ' +
        'une CIUS nationale (un profil plus strict, validé par Schematron) et adresse toujours ' +
        "chaque destinataire via un identifiant de participant qualifié par un EAS — voir les " +
        'faits propres à ce pays ci-dessous pour savoir si l\'un ou l\'autre s\'applique ici.',
      b2gTransport: 'Transport',
      b2gFormat: 'Format',
      b2gClientIdentifiers: 'Identifiants client requis',
      b2gDocumentFields: 'Champs du document',
      b2gProvenance: 'Provenance',
      correctionIntro: (sourced, total) =>
        `Sourcées : ${sourced}/${total} voies (les autres sont honnêtement \`unverified\`).`,
      correctionColRoute: 'Voie',
      correctionColStatus: 'Statut',
      correctionColProvenance: 'Provenance',
      taxColKind: 'Type',
      taxStandardRate: 'Taux normal',
      taxStandardRateDerived:
        " _(non déclaré dans ce fichier tax-system — dérivé de l'entrée STANDARD du catalogue " +
        'vat-rates ci-dessous)_',
      taxDomesticZeroRate: 'Taux zéro domestique',
      taxSchemes: 'Régimes de TVA',
      taxStateRates: 'Taux par État',
      taxProvenance: 'Provenance',
      taxCatalogIntro: "Chaque taux que le catalogue propre à ce pays déclare (ce qu'un utilisateur choisit réellement par ligne) :",
      taxNoCatalogNote:
        "Ce pays n'a pas encore de catalogue de taux complet (`vat-rates/`) — seul le taux normal " +
        "ci-dessous, tiré de l'enveloppe fiscale (généralement le TEDB de l'UE), est disponible.",
      taxRateColRate: 'Taux',
      taxRateColLabel: 'Libellé',
      taxRateColCategory: 'Catégorie',
      taxRateColProvenance: 'Provenance',
      identifiersColScheme: 'Schéma',
      identifiersColAppliesTo: 'Concerne',
      identifiersColLabel: 'Libellé',
      identifiersColRequired: 'Obligatoire',
      identifiersColProvenance: 'Provenance',
      mentionsColSubject: 'Sujet',
      mentionsColText: 'Texte (tel qu\'émis)',
      mentionsColLegalRef: 'Référence légale',
      mentionsColValidFrom: 'Valide depuis',
      channelIntro: 'Ce que ce pays exige légalement (ou suggère seulement) pour un vendeur qui y est établi.',
      channelEreportingNote:
        'Ceci ne couvre que le canal de remise — un pays peut en plus exiger un e-reporting ' +
        "(déclarer les données de la facture à sa propre administration fiscale, indépendamment " +
        'du canal de remise), pas encore exposé sur cette page.',
      channelColChannel: 'Canal',
      channelColRequirement: 'Exigence',
      channelColMandatedFrom: 'Obligatoire depuis',
      channelColProvenance: 'Provenance',
      fieldOverlayIntro: 'Ce que ce pays ajoute/modifie/retire par rapport au tronc commun du document :',
      fieldOverlayAdd: (key, on) => `**ajoute** \`${key}\` sur \`${on}\``,
      fieldOverlayModify: (key, on) => `**modifie** \`${key}\` sur \`${on}\``,
      fieldOverlayRemove: (key, on) => `**retire** \`${key}\` de \`${on}\``,
      contentReqColField: 'Champ',
      contentReqColMandatedFrom: 'Obligatoire depuis',
      contentReqColProvenance: 'Provenance',
      footer: (sources) =>
        "_Générée depuis les propres fichiers de données du moteur de conformité — ne pas " +
        `modifier à la main. Sources : ${sources}._`,
      seeGlossaryLink:
        'Voir le glossaire sur la [matrice de conformité](./index.md) pour les termes techniques utilisés sur cette page.',
      part1Heading: 'Partie 1 — En mots simples',
      part2Heading: 'Partie 2 — Les détails',
      part1Intro: (name) =>
        `Ce que gérer une entreprise en ${name} implique pour vos documents, expliqué simplement — sans ` +
        'jargon non expliqué (survolez, ou touchez, tout terme souligné pour une définition simple).',
      part2Intro:
        "Chaque fait ci-dessous est lu directement dans les propres fichiers de données de cette " +
        "application, au moment de la génération — jamais tapé à la main — avec sa source légale exacte " +
        'quand elle a été vérifiée contre le texte de loi lui-même.',
      notConfiguredTitle: 'Pas encore configuré',
      notConfiguredBody: (name, mechanismPlain) =>
        `Cette application n'a pas encore de réponse pour ${name} sur ce point : **${mechanismPlain}**. ` +
        "C'est un manque ouvert et honnête — pas une valeur par défaut cachée, et pas « probablement bon » : " +
        'cette application préfère dire « pas encore configuré » que de deviner. Voir ' +
        '[Ajouter un pays](../adding-a-country.md) pour savoir comment combler ce manque.',
      mechanismPlainPolicy: 'quels documents vous pouvez créer, et ce que vous pouvez en faire',
      mechanismPlainB2g: 'vendre à un client gouvernemental',
      mechanismPlainCorrection: 'corriger une erreur sur une facture déjà envoyée',
      mechanismPlainCancel: 'annuler une facture déjà envoyée',
      mechanismPlainTax: 'la taxe sur les ventes (TVA)',
      mechanismPlainIdentifiers: "les numéros d'identifiant qu'une entreprise d'ici doit indiquer sur une facture",
      mechanismPlainMentions: 'les mentions légales et champs supplémentaires que doit porter chaque facture',
      mechanismPlainChannel: "si la loi impose l'usage d'un canal de transmission précis",
      plainPolicyIntro: (name, types) =>
        `En tant qu'entreprise basée en ${name}, cette application vous permet de créer et gérer : ${types}.`,
      plainPolicyRestriction: (actionLabel, typeArticled, statusLabel) =>
        `Une nuance : vous ne pouvez ${actionLabel} ${typeArticled} que tant que son statut est encore « ${statusLabel} ».`,
      plainPolicyForbidden: (actionLabel, typeArticled) =>
        `Une restriction : la loi ici ne vous permet pas de ${actionLabel} ${typeArticled}.`,
      plainB2gIntro: (name, transportLabel, formatLabel) =>
        `Si vous vendez à une administration en ${name}, la facture ne peut pas être simplement envoyée par ` +
        `e-mail — elle doit passer par ${transportLabel}, construite au format ${formatLabel}. Cette ` +
        "application s'en charge une fois le canal connecté ; il vous faut seulement avoir les bonnes " +
        "informations sur votre client gouvernemental au préalable.",
      plainB2gIdentifierNeeded: (label) => `son **${label}**`,
      plainB2gFieldNeeded: (label) => `**${label}** rempli sur la facture`,
      plainB2gNeedsIntro: "Avant de pouvoir envoyer, il vous faudra :",
      plainCorrectionLegend:
        "Quatre réponses honnêtes que la loi d'un pays peut donner pour chaque façon de corriger une " +
        'erreur : **obligatoire** (la loi dit que vous devez utiliser celle-ci pour ce genre de situation), ' +
        '**permise** (vous pouvez l\'utiliser), **interdite** (la loi ne vous permet pas de l\'utiliser ici), ' +
        'et **non vérifiée** (personne n\'a encore vérifié le texte de loi pour celle-ci — pas « non », ' +
        'juste « pas encore recherché »).',
      plainCorrectionIntro: (name, sourced, total) =>
        `La loi applicable en ${name} a été vérifiée, à ce jour, pour ${sourced} des ${total} façons que ` +
        'cette application connaît pour corriger une erreur sur une facture. Celles réellement confirmées :',
      plainCorrectionNoneSourced: "Aucune d'entre elles n'a encore été vérifiée contre le texte de loi.",
      plainCancelYes:
        'Oui. Si besoin, vous pouvez annuler une facture déjà envoyée et en émettre une corrigée à la ' +
        'place, sans restriction supplémentaire de la loi propre à ce pays.',
      plainCancelRestricted: (statusLabel) =>
        'Seulement dans un cas : annuler et réémettre une facture est possible tant qu\'elle est encore ' +
        `au statut « ${statusLabel} » — plus une fois allée au-delà.`,
      plainCancelNo:
        "Pas encore via cette application. La loi ici peut le permettre en principe, mais aucun canal ou " +
        "mécanisme de cette application ne le réalise encore pour ce pays — un manque connu, jamais un " +
        '« non » silencieux.',
      plainCancelNone: 'Rien n\'est encore déclaré pour ce pays — voir les détails ci-dessous pour ce qui trancherait.',
      plainCancelDrift:
        "Les propres données de cette application se contredisent sur ce point — voir les détails " +
        "ci-dessous plutôt qu'une réponse simple, tant que ce n'est pas réglé.",
      plainTaxIntro: (name, kindLabel, rate) =>
        `Si vous êtes assujetti à la ${kindLabel} en ${name}, le taux normal est de ${rate} — le ` +
        'pourcentage ajouté au-dessus de la plupart des ventes.',
      plainTaxIntroNoRate: (name, kindLabel) =>
        `${name} applique la ${kindLabel}, mais cette application n'a pas encore son taux normal en donnée.`,
      plainTaxReduced: (list) => `Certaines catégories de biens ou services bénéficient d'un taux réduit à la place : ${list}.`,
      plainTaxOtherKind: (name, kindLabel) =>
        `${name} applique une ${kindLabel} plutôt qu'une TVA — voir la Partie 2 ci-dessous pour ce que ` +
        'cette application a en donnée à ce sujet.',
      plainTaxNone: (name) => `${name} est renseigné comme ne prélevant aucune taxe générale sur les ventes sur une facture.`,
      plainIdentifiersIntro: (name) =>
        `Quand vous facturez quelqu'un en ${name}, ou que quelqu'un en ${name} facture via cette ` +
        'application, ces numéros d\'identifiant comptent :',
      plainIdentifierRequired: (label, partyType) => `**${label}** — obligatoire (${partyType}).`,
      plainIdentifierOptional: (label, partyType) => `${label} — facultatif (${partyType}).`,
      plainMentionsIntro: (name, count) =>
        `Chaque facture émise en ${name} doit légalement porter ${count} mention${count === 1 ? '' : 's'} ` +
        'obligatoire' +
        (count === 1 ? '' : 's') +
        ' (sur les pénalités de retard de paiement, par exemple). Cette application les ajoute ' +
        'automatiquement pour vous — voir la Partie 2 ci-dessous pour le texte légal exact, mot pour mot.',
      plainContentRequirementsIntro: (name, count) =>
        `En plus de cela, la loi ${frLawAdjective(name)} exige ${count} champ` +
        (count === 1 ? '' : 's') +
        ` supplémentaire${count === 1 ? '' : 's'} portant une valeur spécifique à ${name} sur certaines ` +
        'factures, à partir d\'une date donnée — voir la Partie 2 pour savoir exactement lequel/lesquels.',
      plainChannelMandated: (name, channelLabel, date) =>
        `Oui — si votre entreprise est établie en ${name}, la loi vous impose, depuis le ${date}, d'envoyer ` +
        `vos factures via ${channelLabel}. Cette application bloque l'envoi par tout autre canal à partir ` +
        "de cette date, volontairement : envoyer la bonne facture par le mauvais canal est traité comme " +
        'un vrai blocage, pas un simple avertissement.',
      plainChannelSuggested: (name, channelLabel) =>
        `Pas obligatoire légalement, mais ${channelLabel} est le canal qu'utilisent normalement les ` +
        `entreprises en ${name}.`,
      plainChannelNone: (name) =>
        `${name} n'impose, d'après les données de cette application, aucun canal de transmission ` +
        "particulier à une entreprise qui y est établie (vendre à un client *gouvernemental* peut être " +
        'un cas différent — voir ci-dessus).',
    },
  },
};

// ---------------------------------------------------------------------------------------------
// GLOSSARY — concept-keyed (never term-keyed: the DISPLAYED term itself differs by locale, e.g.
// "Credit note" vs "Avoir", so the concept id is what stays stable across locales for the shape
// check below).
// ---------------------------------------------------------------------------------------------
const GLOSSARY = {
  B2G: {
    term: { en: 'B2G', fr: 'B2G' },
    def: {
      en: 'Business-to-Government — invoicing where the buyer is a public administration. Many countries mandate a specific channel and format for it.',
      fr: "Business-to-Government — facturation où l'acheteur est une administration publique. De nombreux pays y imposent un canal et un format spécifiques.",
    },
  },
  CIUS: {
    term: { en: 'CIUS', fr: 'CIUS' },
    def: {
      en: 'Core Invoice Usage Specification — a national or sector profile that narrows the generic Peppol BIS / EN 16931 format with extra local rules.',
      fr: 'Core Invoice Usage Specification — un profil national ou sectoriel qui restreint le format générique Peppol BIS / EN 16931 avec des règles locales supplémentaires.',
    },
  },
  PEPPOL: {
    term: { en: 'Peppol', fr: 'Peppol' },
    def: {
      en: 'Pan-European Public Procurement OnLine — an international network of Access Points that routes e-invoices between businesses and governments without a direct connection between sender and receiver.',
      fr: "Pan-European Public Procurement OnLine — un réseau international de points d'accès qui achemine les factures électroniques entre entreprises et administrations sans connexion directe entre l'émetteur et le destinataire.",
    },
  },
  EAS: {
    term: { en: 'EAS', fr: 'EAS' },
    def: {
      en: "Electronic Address Scheme — the code identifying which registry (SIRET, VAT number, …) a Peppol participant id is expressed in.",
      fr: "Electronic Address Scheme — le code identifiant dans quel registre (SIRET, numéro de TVA, …) un identifiant de participant Peppol est exprimé.",
    },
  },
  SCHEMATRON: {
    term: { en: 'Schematron', fr: 'Schematron' },
    def: {
      en: "An XML rule language used to validate an e-invoice's business rules (e.g. EN 16931's own BR-* rules) beyond what an XML schema alone can check.",
      fr: "Un langage de règles XML utilisé pour valider les règles métier d'une facture électronique (par ex. les règles BR-* de l'EN 16931) au-delà de ce qu'un simple schéma XML peut vérifier.",
    },
  },
  CREDIT_NOTE: {
    term: { en: 'Credit note', fr: 'Avoir' },
    def: {
      en: 'A document that cancels or reduces a previously issued invoice — one of the eleven correction routes this catalog tracks.',
      fr: "Un document qui annule ou réduit une facture déjà émise — l'une des onze voies de correction que ce catalogue suit.",
    },
  },
  E_REPORTING: {
    term: { en: 'e-reporting', fr: 'e-reporting' },
    def: {
      en: "A separate obligation — independent of how the invoice is delivered — to declare an invoice's data to the seller's own tax authority, typically in near-real time.",
      fr: "Une obligation distincte — indépendante du canal de remise de la facture — de déclarer les données de la facture à l'administration fiscale du vendeur, généralement quasiment en temps réel.",
    },
  },
  FRANCHISE: {
    term: { en: 'franchise', fr: 'franchise en base' },
    def: {
      en: 'A VAT exemption below a turnover threshold — a small business skips charging VAT at all, in exchange for not deducting it either.',
      fr: "Une exonération de TVA sous un seuil de chiffre d'affaires — une petite entreprise ne facture pas la TVA du tout, en contrepartie de ne pas la déduire non plus.",
    },
  },
  CLEARANCE: {
    term: { en: 'clearance model', fr: 'modèle de clearance' },
    def: {
      en: 'A transmission model where the tax authority validates (and sometimes signs) an invoice before or as it reaches the buyer — as opposed to a post-audit model, where the authority only checks after the fact.',
      fr: "Un modèle de transmission où l'administration fiscale valide (et parfois signe) la facture avant, ou au moment, qu'elle atteigne l'acheteur — par opposition à un modèle post-audit, où l'administration ne contrôle qu'après coup.",
    },
  },
  PDP: {
    term: { en: 'PDP', fr: 'PDP' },
    def: {
      en: 'Plateforme de Dématérialisation Partenaire — a private platform accredited by the French tax authority to transmit e-invoices under the French B2B e-invoicing reform.',
      fr: "Plateforme de Dématérialisation Partenaire — une plateforme privée agréée par l'administration fiscale française pour transmettre les factures électroniques dans le cadre de la réforme française de facturation électronique B2B.",
    },
  },
  KSEF: {
    term: { en: 'KSeF', fr: 'KSeF' },
    def: {
      en: "Krajowy System e-Faktur — Poland's national e-invoicing system; an invoice is cleared through it before being considered issued.",
      fr: "Krajowy System e-Faktur — le système national polonais de facturation électronique ; une facture y est validée avant d'être considérée comme émise.",
    },
  },
  SDI: {
    term: { en: 'SdI', fr: 'SdI' },
    def: {
      en: "Sistema di Interscambio — Italy's national clearance platform for e-invoices.",
      fr: 'Sistema di Interscambio — la plateforme nationale italienne de clearance pour les factures électroniques.',
    },
  },
  VAT: {
    term: { en: 'VAT', fr: 'TVA' },
    def: {
      en: 'Value Added Tax — a percentage of the price, added on top, that the seller collects from the buyer and hands over to the tax authority. Most of Europe uses it; the exact percentage and the rules for who charges it depend on the country and the kind of sale.',
      fr: "Taxe sur la Valeur Ajoutée — un pourcentage du prix, ajouté par-dessus, que le vendeur collecte auprès de l'acheteur et reverse à l'administration fiscale. La plupart des pays européens l'utilisent ; le pourcentage exact et les règles sur qui la facture dépendent du pays et du type de vente.",
    },
  },
  E_INVOICING_MANDATE: {
    term: { en: 'e-invoicing mandate', fr: 'obligation de facturation électronique' },
    def: {
      en: "A law that doesn't just ALLOW sending invoices electronically (almost every country does) but REQUIRES it, in a specific structured format, through a specific channel, from a specific date — as opposed to simply emailing a PDF, which most countries still permit unless a mandate like this applies.",
      fr: "Une loi qui n'AUTORISE pas seulement l'envoi de factures par voie électronique (presque tous les pays le permettent) mais l'EXIGE, dans un format structuré précis, par un canal précis, à partir d'une date précise — par opposition au simple envoi d'un PDF par e-mail, que la plupart des pays autorisent encore tant qu'une telle obligation ne s'applique pas.",
    },
  },
  SCHEME_ID: {
    term: { en: 'schemeID', fr: 'schemeID' },
    def: {
      en: 'A short code, attached to an identifier inside an e-invoice\'s own XML, that says WHICH REGISTRY that identifier belongs to — e.g. Peppol\'s own code "0204" in front of a German public body\'s Leitweg-ID means "this number is a German Leitweg-ID", not a VAT number or anything else. The same idea as an EAS, spelled out as an XML attribute rather than a Peppol network concept.',
      fr: "Un court code, attaché à un identifiant à l'intérieur du XML d'une facture électronique, qui indique DE QUEL REGISTRE cet identifiant relève — par exemple le code Peppol « 0204 » devant le Leitweg-ID d'une entité publique allemande signifie « ce numéro est un Leitweg-ID allemand », pas un numéro de TVA ou autre chose. La même idée qu'un EAS, exprimée comme attribut XML plutôt que comme concept du réseau Peppol.",
    },
  },
  XADES: {
    term: { en: 'XAdES', fr: 'XAdES' },
    def: {
      en: 'XML Advanced Electronic Signature — a standard way to attach a legally-recognized digital signature to an XML document (like an e-invoice), so the receiver can verify who signed it and that nobody altered it afterward.',
      fr: "XML Advanced Electronic Signature — une manière standardisée d'attacher une signature électronique juridiquement reconnue à un document XML (comme une facture électronique), pour que le destinataire puisse vérifier qui l'a signé et que personne ne l'a modifié depuis.",
    },
  },
  POST_AUDIT: {
    term: { en: 'post-audit model', fr: 'modèle post-audit' },
    def: {
      en: "A transmission model where the seller sends the invoice straight to the buyer and the tax authority only checks it later, if it checks at all — as opposed to a clearance model, where the authority validates the invoice before (or as) it reaches the buyer.",
      fr: "Un modèle de transmission où le vendeur envoie la facture directement à l'acheteur et où l'administration fiscale ne la contrôle que plus tard, si elle la contrôle — par opposition à un modèle de clearance, où l'administration valide la facture avant, ou au moment, qu'elle atteigne l'acheteur.",
    },
  },
  PROVENANCE: {
    term: { en: 'provenance', fr: 'provenance' },
    def: {
      en: 'Where a fact on this page comes from: either "legal" — an exact quote from a law or an official source, dated — or "unverified" — an honest note saying nobody has confirmed this against the actual law yet, and what would settle it. There is no in-between and no guessing.',
      fr: "D'où vient un fait affiché sur cette page : soit « légal » — une citation exacte d'une loi ou d'une source officielle, datée — soit « non vérifié » — une note honnête disant que personne n'a encore confirmé ce fait contre le texte de loi réel, et ce qui permettrait de le faire. Il n'y a pas d'entre-deux, et jamais de supposition.",
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Shape guard — same discipline `frontend/`'s own `npm run i18n:check` applies to `t()` keys,
// applied here to this script's string/glossary tables instead of a JSON locale file: both
// locales MUST declare the exact same key structure, or a build must fail loudly rather than
// silently ship an English fallback string on a French page (or vice versa).
// ---------------------------------------------------------------------------------------------
function assertSameShape(a, b, path) {
  if (typeof a === 'function' || typeof b === 'function') return; // leaf, either side may be a template fn
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return; // leaf strings
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (JSON.stringify(keysA) !== JSON.stringify(keysB)) {
    throw new Error(
      `generate-country-matrix: locale shape mismatch at "${path}" — en has [${keysA}], fr has [${keysB}].`,
    );
  }
  for (const key of keysA) assertSameShape(a[key], b[key], `${path}.${key}`);
}
assertSameShape(STRINGS.en, STRINGS.fr, 'STRINGS');
for (const [id, concept] of Object.entries(GLOSSARY)) {
  if (!concept.term.en || !concept.term.fr || !concept.def.en || !concept.def.fr) {
    throw new Error(`generate-country-matrix: GLOSSARY.${id} is missing a term or definition in some locale.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Presentation-only label maps. NOT legal claims — they never affect which facts are shown, only
// how a raw id (`ksef`, `fa3`) is spelled out. Proper nouns / brand names are NOT translated
// (a French page still says "KSeF", never a French neologism) — only the surrounding words are.
// ---------------------------------------------------------------------------------------------
const TRANSPORT_LABELS = {
  ksef: 'KSeF',
  pdp: 'PDP',
  sdi: 'SdI',
  face: 'FACe',
  'chorus-pro': 'Chorus Pro',
  peppol: 'Peppol',
  anaf: 'ANAF (RO e-Factura)',
  email: 'Email',
};
const FORMAT_LABELS = {
  fa3: 'FA(3)',
  facturx: 'Factur-X',
  xrechnung: 'XRechnung',
  fatturapa: 'FatturaPA',
  facturae: 'Facturae',
  'peppol-bis': 'Peppol BIS',
  ubl: 'UBL',
  cii: 'CII',
};
// Categorization of well-established transport MODELS — generic domain knowledge (like the label
// maps above), not a per-country legal claim. Deliberately conservative: only the two textbook
// clearance examples are tagged, so as never to overstate a still-debated model (e.g. the French
// PDP's own decentralized-CTC design) as one or the other.
const TRANSPORT_MODEL = { ksef: 'clearance', sdi: 'clearance', peppol: 'postAudit' };

// ---------------------------------------------------------------------------------------------
// PART-1 PLAIN-WORDS LABEL MAPS — presentation-only, exactly like TRANSPORT_LABELS/FORMAT_LABELS
// above: generic domain vocabulary (which English/French verb describes "send", which noun
// describes a "quote"), never a per-country legal claim. Every actionId/typeId/statusId spelled
// out here comes from the SAME closed, shared vocabulary every country-policy/*.json file already
// uses (`descriptors/types.ts`'s own document types and actions are identical for every country —
// only which ones are ALLOWED differs, which is data, read from the file at render time). Adding a
// sixth document type or a new action id to the product means adding one entry here too — the
// build fails loudly (falls back to the raw id in brackets) rather than silently, see
// `plainActionLabel`/`plainTypeArticled`/`plainStatusLabel` below.
// ---------------------------------------------------------------------------------------------
const ACTION_PLAIN_LABELS = {
  en: {
    'save-draft': 'save as a draft',
    send: 'send',
    'convert-to-invoice': 'convert to an invoice',
    'request-deposit': 'request a deposit on',
    duplicate: 'duplicate',
    'share-link': 'create a shareable link for',
    'record-payment': 'record a payment on',
    'download-xml': 'download the structured XML for',
    'export-accounting': 'export to accounting software',
    delete: 'delete',
    receive: 'log as received',
    approve: 'approve',
    reject: 'reject',
  },
  fr: {
    'save-draft': 'enregistrer comme brouillon',
    send: 'envoyer',
    'convert-to-invoice': 'convertir en facture',
    'request-deposit': 'demander un acompte sur',
    duplicate: 'dupliquer',
    'share-link': 'créer un lien de partage pour',
    'record-payment': 'enregistrer un paiement sur',
    'download-xml': 'télécharger le XML structuré de',
    'export-accounting': 'exporter vers un logiciel comptable',
    delete: 'supprimer',
    receive: 'enregistrer comme reçue',
    approve: 'approuver',
    reject: 'rejeter',
  },
};
/** Doc-type label ALREADY carrying its own article ("an invoice", "une facture") — baked in per
 *  entry rather than derived from spelling, which sidesteps English a/an-before-vowel and French
 *  un/une gender entirely (see this block's own header). */
const DOC_TYPE_ARTICLED_PLAIN_LABELS = {
  en: {
    quote: 'a quote',
    invoice: 'an invoice',
    'credit-note': 'a credit note',
    expense: 'an expense',
    'received-invoice': 'a received invoice',
  },
  fr: {
    quote: 'un devis',
    invoice: 'une facture',
    'credit-note': 'un avoir',
    expense: 'une note de frais',
    'received-invoice': 'une facture reçue',
  },
};
const DOC_TYPE_PLURAL_PLAIN_LABELS = {
  en: {
    quote: 'quotes',
    invoice: 'invoices',
    'credit-note': 'credit notes',
    expense: 'expenses',
    'received-invoice': 'invoices you receive from suppliers',
  },
  fr: {
    quote: 'devis',
    invoice: 'factures',
    'credit-note': 'avoirs',
    expense: 'notes de frais',
    'received-invoice': 'factures reçues de vos fournisseurs',
  },
};
/** Every `DocumentInstance.status` value a country-policy `rules[].statuses` narrowing has ever
 *  named, across all five shipped countries — see country-policy/data/*.json's own `invoice.save-
 *  draft` (`["draft"]`) and `received-invoice.receive` (`["received"]"`), and correction-routes/
 *  cancel-policy.ts's own Italian `restrictedToStatuses: ["send_failed"]`. */
const STATUS_PLAIN_LABELS = {
  en: { draft: 'draft', sent: 'sent', send_failed: 'failed to send', received: 'received' },
  fr: { draft: 'brouillon', sent: 'envoyée', send_failed: "en échec d'envoi", received: 'reçue' },
};

function plainActionLabel(actionId, locale) {
  return ACTION_PLAIN_LABELS[locale][actionId] ?? `[${actionId}]`;
}
function plainTypeArticled(typeId, locale) {
  return DOC_TYPE_ARTICLED_PLAIN_LABELS[locale][typeId] ?? `[${typeId}]`;
}
function plainTypesList(typeIds, locale) {
  return typeIds.map((t) => DOC_TYPE_PLURAL_PLAIN_LABELS[locale][t] ?? `[${t}]`).join(locale === 'fr' ? ', ' : ', ');
}
function plainStatusLabel(statusId, locale) {
  return STATUS_PLAIN_LABELS[locale][statusId] ?? statusId;
}

const COUNTRY_NAMES = {
  en: {
    FR: 'France',
    US: 'United States',
    HU: 'Hungary',
    DE: 'Germany',
    IT: 'Italy',
    PL: 'Poland',
    ES: 'Spain',
    MX: 'Mexico',
    BE: 'Belgium',
    CY: 'Cyprus',
    EE: 'Estonia',
    GR: 'Greece',
    LT: 'Lithuania',
    LU: 'Luxembourg',
    LV: 'Latvia',
    MT: 'Malta',
    SE: 'Sweden',
    RO: 'Romania',
    SA: 'Saudi Arabia',
    AE: 'United Arab Emirates',
    IN: 'India',
    QA: 'Qatar',
    AT: 'Austria',
    BG: 'Bulgaria',
    HR: 'Croatia',
    CZ: 'Czechia',
    DK: 'Denmark',
    FI: 'Finland',
    IE: 'Ireland',
    NL: 'Netherlands',
    PT: 'Portugal',
    SK: 'Slovakia',
    SI: 'Slovenia',
    GB: 'United Kingdom',
  },
  fr: {
    FR: 'France',
    US: 'États-Unis',
    HU: 'Hongrie',
    DE: 'Allemagne',
    IT: 'Italie',
    PL: 'Pologne',
    ES: 'Espagne',
    MX: 'Mexique',
    BE: 'Belgique',
    CY: 'Chypre',
    EE: 'Estonie',
    GR: 'Grèce',
    LT: 'Lituanie',
    LU: 'Luxembourg',
    LV: 'Lettonie',
    MT: 'Malte',
    SE: 'Suède',
    RO: 'Roumanie',
    SA: 'Arabie saoudite',
    AE: 'Émirats arabes unis',
    IN: 'Inde',
    QA: 'Qatar',
    AT: 'Autriche',
    BG: 'Bulgarie',
    HR: 'Croatie',
    CZ: 'Tchéquie',
    DK: 'Danemark',
    FI: 'Finlande',
    IE: 'Irlande',
    NL: 'Pays-Bas',
    PT: 'Portugal',
    SK: 'Slovaquie',
    SI: 'Slovénie',
    GB: 'Royaume-Uni',
  },
};
assertSameShape(COUNTRY_NAMES.en, COUNTRY_NAMES.fr, 'COUNTRY_NAMES');

function countryName(cc, locale) {
  return COUNTRY_NAMES[locale][cc] ?? cc;
}
/** French adjectival form of "the law of <country>" ("la loi française", not "la loi de France") —
 *  needed only by `plainContentRequirementsIntro` today, which is why this stays a small, closed
 *  lookup by NAME (not `cc`, since that string function only ever receives the already-localized
 *  name) rather than a general country->adjective mechanism. Falls back to the grammatically safe,
 *  if less idiomatic, "de <name>" for any country this map does not yet cover. */
const FR_LAW_ADJECTIVE_BY_NAME = {
  France: 'française',
  Allemagne: 'allemande',
  Italie: 'italienne',
  Pologne: 'polonaise',
  Portugal: 'portugaise',
};
function frLawAdjective(name) {
  return FR_LAW_ADJECTIVE_BY_NAME[name] ?? `de ${name}`;
}
function transportLabel(id) {
  return TRANSPORT_LABELS[id] ?? id;
}
function formatLabel(id) {
  return FORMAT_LABELS[id] ?? id;
}
function transportWithModel(id, locale) {
  const label = transportLabel(id);
  const model = TRANSPORT_MODEL[id];
  if (!model) return label;
  return `${label} (${STRINGS[locale].transportModel[model]})`;
}

// The 5 countries this product covers today (2026-09-10 prune — every other country's data files
// were removed; see TODO_ISSUES.md and the root git log for that change). Every one of these gets
// a full two-part narrative page (Part 1 "In plain words" + Part 2 "The details"); `unionCountries`
// below is, as a direct consequence, ALSO exactly this set — there is no country left with data in
// only some mechanisms and no page at all, unlike the pre-prune matrix, which had rows with no
// detail page (a thin row for a country nobody had written a narrative for yet).
const DETAIL_PAGES = ['DE', 'FR', 'IT', 'PL', 'PT'];

// =================================================================================================
// TEXT / MDX HELPERS
// =================================================================================================
function clean(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Heading-cases a lowercase, conversational phrase (`mechanismPlain*` above are written to read
 *  naturally mid-sentence in a "not yet configured" callout, so they start lowercase) — applied only
 *  where one of those doubles as a Part-1 `###` heading, never to a phrase already reused verbatim
 *  inside a sentence. Multi-byte-safe (French accented capitals included) via `toLocaleUpperCase`. */
function capitalize(text) {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}
/**
 * These pages are MDX, not plain Markdown — Docusaurus parses `{...}` as a JS expression and a
 * bare `<Word` as the start of a JSX tag. Escaping keeps a quoted citation's actual characters
 * visible while making them inert to the MDX compiler.
 */
function escapeMdx(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}
/** Markdown table cell + MDX escaping: no raw pipes/newlines, nothing MDX would try to parse. */
function cell(text) {
  return escapeMdx(clean(text)).replace(/\|/g, '\\|');
}
/** Same table-cell safety (no raw pipes/newlines) WITHOUT MDX-escaping — for cell content already
 *  built entirely from this script's own trusted strings (never raw data prose) and already passed
 *  through `createGlossaryMarker()`'s `mark()`: escaping here would turn the `<abbr>` tags `mark()`
 *  just inserted back into inert `&lt;abbr…&gt;` text, defeating rule #6 (glossary tooltips). */
function cellHtml(text) {
  return clean(text).replace(/\|/g, '\\|');
}
function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
/** YAML-safe frontmatter scalar — a JSON string literal is also valid YAML flow scalar syntax, so
 *  this sidesteps hand-rolled quote-escaping entirely. */
function yamlString(text) {
  return JSON.stringify(String(text));
}

// ---------------------------------------------------------------------------------------------
// GLOSSARY MARKER — wraps the FIRST occurrence of a glossary term's own display text, per page,
// in `<abbr title="…">`. A fresh marker is created per generated page (`seen` does not leak
// across pages). Never applied to a quoted citation fragment (rule #2's own "a citation is cited,
// never annotated" corollary) — only to this script's OWN authored strings and to the plain
// presentation labels it builds (transport/format/route/scheme names, section intros).
// ---------------------------------------------------------------------------------------------
function createGlossaryMarker(locale) {
  const entries = Object.values(GLOSSARY)
    .map((c) => ({ term: c.term[locale], title: c.def[locale] }))
    .sort((a, b) => b.term.length - a.term.length);
  const seen = new Set();
  return function mark(text) {
    let out = text;
    // [start, end) byte ranges of `out` already occupied by a just-inserted `<abbr title="…">…
    // </abbr>` — see this function's own header addendum below for why later entries must never
    // match INSIDE one of these, even when a shorter term's exact display text happens to appear,
    // verbatim, inside a LONGER (earlier-processed, since entries sort longest-first) term's own
    // definition — e.g. this file's own GLOSSARY.POST_AUDIT mentioning "clearance model" in its
    // definition, or GLOSSARY.SCHEME_ID mentioning "Peppol"/"EAS" in its. Without this guard, that
    // definition text — once embedded as a `title` attribute — gets re-scanned by every SHORTER
    // entry still left in the loop exactly like ordinary page prose would, corrupting the markup
    // with a tag nested inside an attribute value AND wrongly marking that shorter term "seen" for
    // the rest of the page (so its own, GENUINE first occurrence later on the page silently loses
    // its tooltip) — a real regression this task's own litmus check (the country matrix's clearance-
    // model column) caught.
    const protectedRanges = [];
    const isProtected = (idx, len) => protectedRanges.some(([s, e]) => idx < e && idx + len > s);
    for (const { term, title } of entries) {
      if (seen.has(term)) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'gu');
      let match = null;
      let m;
      while ((m = re.exec(out))) {
        if (!isProtected(m.index, m[1].length)) {
          match = m;
          break;
        }
      }
      if (!match) continue;
      seen.add(term);
      const idx = match.index;
      const inserted = `<abbr title="${escapeAttr(title)}">${match[1]}</abbr>`;
      out = `${out.slice(0, idx)}${inserted}${out.slice(idx + match[1].length)}`;
      protectedRanges.push([idx, idx + inserted.length]);
    }
    return out;
  };
}

// =================================================================================================
// PROVENANCE — the structured-fact renderer at the heart of rule #2. Never renders `notes` or
// `resolutionNote` (data prose) as flowing text. Renders, in the page's own locale:
//   - a status word (legal/unverified),
//   - IF legal: a short source-NAME (`sourceRef`, a heuristic — never the note's own prose) and
//     the `sourceCheckedAt` date,
//   - IF legal AND the source text contains an extractable quoted fragment (or, failing that, no
//     quote marks at all — the whole field is then trusted to already be a pure quote, per this
//     module family's own schema contract): a collapsible "Source (original language)" block
//     holding ONLY that quoted material, untouched, in whatever language it is written.
// =================================================================================================

// A NAME extractor, not a citation parser: looks for "<Proper-noun phrase> <marker> <reference>"
// (e.g. "CGI art. 278", "Code de commerce art. R.123-237", "Podręcznik KSeF 2.0 cz. II, § 1.6.2",
// "U.S.C. § 6001") anywhere in the given text. Deliberately simple, per this task's own brief —
// it does not need to succeed on every file to be worth having; when it fails, the reader still
// gets the status + date + (if any) quoted original text, never a guess dressed up as a citation.
const CITATION_RE = new RegExp(
  "(\\p{Lu}[\\p{L}\\p{N}'’.-]*(?:\\s+(?:de|des|du|la|le|les|d'|d’|l'|l’|an|the)?\\s*[\\p{L}\\p{N}'’.-]+){0,5}?" +
    "\\s+(?:art\\.|article[s]?|§|ann\\.|cz\\.))" +
    '\\s*([0-9IVXLCA-Za-z°§.,\'’ -]{1,60})',
  'u',
);
const KNOWN_SOURCE_NAMES = [
  'TEDB',
  'BOFiP',
  'Country Factsheet',
  'Journal officiel',
  'Gazzetta Ufficiale',
  'Bundesgesetzblatt',
  'Dziennik Ustaw',
  'Boletín Oficial del Estado',
  'Diario Oficial',
];

function trimCitationTail(s) {
  const boundaries = [s.search(/—/u), s.search(/\.\s+\p{Lu}/u), s.search(/,\s+[a-zà-ÿ]{3,}/u)].filter(
    (i) => i >= 0,
  );
  if (boundaries.length) s = s.slice(0, Math.min(...boundaries));
  return s.replace(/[,;:.\s]+$/, '').trim();
}
function citationFrom(text) {
  if (!text) return null;
  const m = CITATION_RE.exec(clean(text));
  if (!m) return null;
  const lead = m[1].trim();
  const tail = trimCitationTail(m[2]);
  return tail ? `${lead} ${tail}` : lead;
}
function knownSourceFrom(text) {
  if (!text) return null;
  for (const name of KNOWN_SOURCE_NAMES) if (text.includes(name)) return name;
  return null;
}
/** `notes` is checked before `sourceText`: in this corpus the short citation NAME usually sits at
 *  the head of the free-form `notes` field ("CGI art. 278. Lu en direct…"), while `sourceText`
 *  itself is often the bare quoted words with no citation attached at all. Either may also be
 *  missing/unhelpful, in which case this returns `null` — an absence, never a guess. */
function sourceRef(notes, sourceText) {
  return citationFrom(notes) ?? citationFrom(sourceText) ?? knownSourceFrom(notes) ?? knownSourceFrom(sourceText);
}

/**
 * Extracts ONLY the guillemet-quoted fragments of `sourceText` — this corpus's own consistent
 * convention for marking "this exact substring is the law's own words" (see correction-routes/
 * data/{de,us,es,it,pl,mx}.json, b2g-routing/data/fr.json, country-identifiers/data/fr.json for
 * the convention in the wild). DELIBERATELY returns `null` — no quote block at all — when NO
 * guillemets are found, even though `sourceText`'s own schema contract says the field SHOULD
 * already be a pure quote with nothing else mixed in: some mechanisms' data does not honor that
 * contract (correction-routes' own `sourceText` is characteristically French ANALYSIS with the
 * law's actual words picked out in guillemets — verified directly against this task's own litmus
 * check, which caught an earlier version of this function trusting an unguillemeted `sourceText`
 * wholesale and leaking exactly this kind of French commentary onto an English page). Never
 * guessing which convention a given file followed is what keeps rule #2 airtight: a fact with no
 * guillemets still gets its structured summary (status + `sourceRef()` + date) — it just carries
 * no expandable citation, rather than a citation that might not really be one.
 */
function extractQuotedFragments(sourceText) {
  if (!sourceText) return null;
  const frags = [];
  const re = /«([^»]{2,})»/gu;
  let m = re.exec(sourceText);
  while (m) {
    frags.push(m[1].trim());
    m = re.exec(sourceText);
  }
  return frags.length ? frags.join(' […] ') : null;
}

/**
 * Compact, single-line renderer — safe inside a markdown table cell. Deliberately carries NO
 * `<details>` block: MDX's table-cell parsing treats a block-level HTML element like `<details>`
 * as the start of an HTML BLOCK (CommonMark's own type-6/7 HTML block rule), not inline raw HTML —
 * verified by this task's own doc build, which failed to compile every generated page that tried
 * it. A citation therefore never lives INSIDE a table; see `renderQuotesBlock()` below, which
 * collects the same quotes and renders them as their own block AFTER the table instead.
 */
function provenanceCell(provenance, locale, notes) {
  const S = STRINGS[locale].common;
  if (!provenance?.kind) return S.dash;
  if (provenance.kind === 'unverified') return S.unverified;
  const ref = sourceRef(notes, provenance.sourceText);
  const refPart = ref ? ` — ${cell(ref)}` : '';
  const datePart = ` (${S.checkedOn(provenance.sourceCheckedAt)})`;
  return `${S.legal}${refPart}${datePart}`;
}

/** Same facts, for a bullet/section context (not a table cell) — still no inline `<details>`, for
 *  the same reason: keeping every quote block a clean, blank-line-delimited top-level element
 *  (never nested inside a list item's own text) is what makes it render reliably either way. */
function provenanceBlock(provenance, locale, notes) {
  const S = STRINGS[locale].common;
  if (!provenance?.kind) return S.dash;
  if (provenance.kind === 'unverified') return `${S.unverified} — ${S.unverifiedNote}`;
  const ref = sourceRef(notes, provenance.sourceText);
  const refPart = ref ? ` — ${escapeMdx(clean(ref))}` : '';
  const datePart = ` (${S.checkedOn(provenance.sourceCheckedAt)})`;
  return `${S.legal}${refPart}${datePart}`;
}

/** Collects a labeled quote for `renderQuotesBlock()` below — `null` when this provenance is
 *  `unverified` (there is no citation to quote) or carries no extractable quoted text. */
function provenanceQuoteEntry(label, provenance) {
  if (provenance?.kind !== 'legal') return null;
  const quote = extractQuotedFragments(provenance.sourceText);
  return quote ? { label, quote } : null;
}

/** Renders every collected quote as ONE `<details>` block, as its own top-level element (blank
 *  lines on both sides) — never nested inside a table cell or a list item, see the two functions
 *  above. This is the ONLY place a `sourceText` citation's actual words appear — rule #2: a
 *  citation is cited, never paraphrased, never left loose in a page's own-language prose. */
function renderQuotesBlock(entries, locale) {
  const S = STRINGS[locale].common;
  const items = entries.filter(Boolean);
  if (!items.length) return '';
  // `<details>` and `<summary>…</summary>` MUST sit on separate lines: MDX parses a JSX opening
  // tag that shares its line with other already-balanced JSX as ordinary PARAGRAPH content, which
  // cannot span the blank line that follows — verified by this task's own doc build, which failed
  // to compile every page using the combined `<details><summary>…` one-liner. On its own line,
  // `<details>` is instead parsed as an MDX flow (block) element that correctly spans the blank
  // lines, the list, and its own closing tag below.
  const lines = ['', '<details>', `<summary>${escapeMdx(S.sourceOriginal)}</summary>`, ''];
  for (const { label, quote } of items) {
    lines.push(`- **${escapeMdx(clean(label))}**: ${escapeMdx(quote)}`);
  }
  lines.push('', '</details>', '');
  return lines.join('\n');
}

function formatPercent(rate, locale) {
  if (rate === undefined || rate === null) return null;
  const raw = String(rate);
  const localized = locale === 'fr' ? raw.replace('.', ',') : raw;
  return locale === 'fr' ? `${localized} %` : `${localized}%`;
}

/** The matrix Tax column: kind + every non-exempt rate this country's own vat-rates catalog
 *  declares (or, absent that catalog, the single standard rate `tax-systems/` alone knows) — rule
 *  #3. Never invents a category the source data does not have. */
function taxSummary(cc, locale) {
  const S = STRINGS[locale];
  const fact = taxSystems[cc];
  if (!fact) return S.common.dash;
  const kindLabel = S.kinds[fact.kind] ?? fact.kind;
  if (fact.kind === 'SALES_TAX') {
    return `${kindLabel} (${S.common[fact.provenance.kind === 'legal' ? 'legal' : 'unverified']})`;
  }
  if (fact.kind === 'NONE') {
    return `${kindLabel} (${S.common[fact.provenance.kind === 'legal' ? 'legal' : 'unverified']})`;
  }
  // VAT / GST
  const vat = vatRates[cc];
  const statusWord = S.common[fact.provenance.kind === 'legal' ? 'legal' : 'unverified'];
  if (vat) {
    const rates = vat.rates.filter((r) => r.category !== 'EXEMPT').slice().sort((a, b) => b.rate - a.rate);
    const allLegal = fact.provenance.kind === 'legal' && vat.rates.every((r) => r.provenance.kind === 'legal');
    const list = rates.map((r) => formatPercent(r.rate, locale)).join(' / ');
    return `${kindLabel} ${list} (${allLegal ? S.common.legal : S.common.unverified})`;
  }
  const { rate } = resolveStandardRate(cc, fact);
  if (rate === undefined) return `${kindLabel} (${statusWord})`;
  return `${kindLabel} ${formatPercent(rate, locale)} (${statusWord})`;
}

// =================================================================================================
// Union of every country code known to ANY mechanism this script reads.
// =================================================================================================
const ALL_SOURCES = [
  countryPolicy,
  b2gRouting,
  correctionRoutes,
  channelPolicy,
  taxSystems,
  countryIdentifiers,
  mentions,
  countryFields,
  contentRequirements,
  vatRates,
];
const unionCountries = Array.from(new Set(ALL_SOURCES.flatMap((src) => Object.keys(src)))).sort();

const SOURCE_FILE_LABELS = [
  ['country-policy/data', countryPolicy],
  ['b2g-routing/data', b2gRouting],
  ['correction-routes/data', correctionRoutes],
  ['transports/channel-policy/data', channelPolicy],
  ['tax/tax-systems/data', taxSystems],
  ['country-identifiers/data', countryIdentifiers],
  ['mentions/data', mentions],
  ['country-fields/data', countryFields],
  ['content-requirements/data', contentRequirements],
  ['vat-rates/data', vatRates],
];

// =================================================================================================
// MATRIX PAGE
// =================================================================================================
function buildMatrixPage(locale) {
  const S = STRINGS[locale];
  const mark = createGlossaryMarker(locale);
  const lines = [];
  lines.push('---');
  lines.push(`title: ${yamlString(S.matrix.title)}`);
  lines.push(`description: ${yamlString(S.matrix.description)}`);
  lines.push('sidebar_position: 1');
  lines.push(`sidebar_label: ${yamlString(locale === 'fr' ? 'Vue générale' : 'Overview')}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${mark(S.matrix.heading)}`);
  lines.push('');
  lines.push(`> ${S.matrix.generatedNotice}`);
  lines.push('');
  lines.push(S.matrix.countCaption(unionCountries.length));
  lines.push('');
  lines.push(
    `| ${S.matrix.colCountry} | ${S.matrix.colPolicy} | ${mark(S.matrix.colB2g)} | ${S.matrix.colCorrection} | ` +
      `${S.matrix.colCancel} | ${S.matrix.colTax} | ${S.matrix.colIdentifiers} | ${S.matrix.colChannel} |`,
  );
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const cc of unionCountries) {
    const name = countryName(cc, locale);
    const hasDetail = DETAIL_PAGES.includes(cc);
    const label = hasDetail ? `[${name} (${cc})](./${cc.toLowerCase()}.md)` : `${name} (${cc})`;

    const policy = countryPolicy[cc] ? '✓' : S.common.dash;

    const b2g = b2gRouting[cc]
      ? mark(`${transportWithModel(b2gRouting[cc].transportId, locale)} / ${formatLabel(b2gRouting[cc].formatSyntax)}`)
      : S.common.dash;

    const corr = correctionRoutes[cc]
      ? (() => {
          const { sourced, total } = sourcedRouteCount(correctionRoutes[cc]);
          return `${sourced}/${total}`;
        })()
      : S.common.dash;

    const cancelResult = resolveCancelPolicy(cc);
    const cancelCell = { NONE: S.cancel.tagNone, NO: S.cancel.tagNo, DRIFT: S.cancel.tagDrift, RESTRICTED: S.cancel.tagRestricted, YES: S.cancel.tagYes }[cancelResult.key];

    const tax = taxSummary(cc, locale);

    const idents = countryIdentifiers[cc]
      ? `${countryIdentifiers[cc].schemes.length} — ${countryIdentifiers[cc].schemes.map((s) => s.scheme).join(', ')}`
      : S.common.dash;

    const chan = channelPolicy[cc]
      ? channelPolicy[cc].facts
          .map((f) =>
            f.requirement === 'mandated'
              ? `${mark(transportLabel(f.providerId))}: ${S.common.mandated} (${f.mandatedFrom})`
              : `${mark(transportLabel(f.providerId))}: ${S.common.suggested}`,
          )
          .join('; ')
      : S.common.dash;

    lines.push(
      `| ${label} | ${policy} | ${cellHtml(b2g)} | ${cell(corr)} | ${cell(cancelCell)} | ${cell(tax)} | ` +
        `${cell(idents)} | ${cellHtml(chan)} |`,
    );
  }

  lines.push('');
  lines.push(`## ${S.matrix.legendHeading}`);
  lines.push('');
  lines.push(`| ${S.matrix.legendCol} | ${S.matrix.legendDir} | ${S.matrix.legendMeaning} |`);
  lines.push('|---|---|---|');
  const legendRows = [
    [S.matrix.colPolicy, 'country-policy/data', S.matrix.legendPolicy],
    [S.matrix.colB2g, 'b2g-routing/data', S.matrix.legendB2g],
    [S.matrix.colCorrection, 'correction-routes/data', S.matrix.legendCorrection],
    [S.matrix.colCancel, 'correction-routes/cancel-policy.ts', S.matrix.legendCancel],
    [S.matrix.colTax, 'tax/tax-systems/data + vat-rates/data', S.matrix.legendTax],
    [S.matrix.colIdentifiers, 'country-identifiers/data', S.matrix.legendIdentifiers],
    [S.matrix.colChannel, 'transports/channel-policy/data', S.matrix.legendChannel],
  ];
  for (const [col, dir, meaning] of legendRows) {
    lines.push(`| ${col} | \`backend/src/modules/documents/${dir}\` | ${mark(meaning)} |`);
  }

  lines.push('');
  lines.push(`## ${S.matrix.glossaryHeading}`);
  lines.push('');
  lines.push(S.matrix.glossaryIntro);
  lines.push('');
  const glossaryIds = Object.keys(GLOSSARY).sort((a, b) => GLOSSARY[a].term[locale].localeCompare(GLOSSARY[b].term[locale]));
  for (const id of glossaryIds) {
    const c = GLOSSARY[id];
    lines.push(`- **${c.term[locale]}** — ${c.def[locale]}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  const dirs = SOURCE_FILE_LABELS.map(([dir]) => `\`backend/src/modules/documents/${dir}/\``).join(', ');
  lines.push(S.matrix.footer(dirs));
  lines.push('');
  return lines.join('\n');
}

// =================================================================================================
// COUNTRY PAGE — SECTIONS
// =================================================================================================
function renderPolicySection(cc, locale, mark) {
  const S = STRINGS[locale].country;
  const file = countryPolicy[cc];
  if (!file) return `_${STRINGS[locale].common.noFile('country-policy')}_\n`;
  const out = [];
  out.push(S.policyIntro(file.documentTypes.join(', ')));
  out.push('');
  out.push(`| ${S.policyColType} | ${S.policyColAction} | ${S.policyColAllowed} | ${S.policyColRestrictedTo} | ${S.policyColProvenance} |`);
  out.push('|---|---|---|---|---|');
  const quotes = [];
  for (const r of file.rules) {
    out.push(
      `| ${r.typeId} | ${r.actionId} | ${r.allowed ? '✓' : S.forbidden} | ` +
        `${r.statuses ? r.statuses.join(', ') : STRINGS[locale].common.dash} | ${provenanceCell(r.provenance, locale, r.notes)} |`,
    );
    quotes.push(provenanceQuoteEntry(`${r.typeId}.${r.actionId}`, r.provenance));
  }
  out.push(renderQuotesBlock(quotes, locale));
  out.push('');
  return out.join('\n');
}

function renderB2gSection(cc, locale, mark) {
  const S = STRINGS[locale].country;
  const rule = b2gRouting[cc];
  if (!rule) return `_${STRINGS[locale].common.noFile('b2g-routing')}_\n`;
  const out = [];
  out.push(mark(S.b2gCiusNote));
  out.push('');
  out.push(`- **${S.b2gTransport}**: ${mark(transportWithModel(rule.transportId, locale))} (\`${rule.transportId}\`)`);
  out.push(`- **${S.b2gFormat}**: ${mark(formatLabel(rule.formatSyntax))} (\`${rule.formatSyntax}\`)`);
  if (rule.requiredClientIdentifiers?.length) {
    out.push(
      `- **${S.b2gClientIdentifiers}**: ${rule.requiredClientIdentifiers
        .map((r) => `${r.scheme} — ${escapeMdx(clean(r.label))}`)
        .join('; ')}`,
    );
  }
  if (rule.requiredDocumentFields?.length) {
    out.push(
      `- **${S.b2gDocumentFields}**: ${rule.requiredDocumentFields
        .map((f) => `${escapeMdx(clean(f.label))} (${f.required ? STRINGS[locale].common.required : STRINGS[locale].common.optional})`)
        .join('; ')}`,
    );
  }
  out.push(`- **${S.b2gProvenance}**: ${provenanceBlock(rule.provenance, locale, rule.notes)}`);
  out.push(renderQuotesBlock([provenanceQuoteEntry(S.b2gProvenance, rule.provenance)], locale));
  out.push('');
  return out.join('\n');
}

function renderCorrectionRoutesSection(cc, locale, mark) {
  const S = STRINGS[locale].country;
  const RS = STRINGS[locale].routes;
  const STS = STRINGS[locale].routeStatuses;
  const file = correctionRoutes[cc];
  if (!file) return `_${STRINGS[locale].common.noFile('correction-routes')}_\n`;
  const out = [];
  const { sourced, total } = sourcedRouteCount(file);
  out.push(S.correctionIntro(sourced, total));
  out.push('');
  out.push(`| ${S.correctionColRoute} | ${S.correctionColStatus} | ${S.correctionColProvenance} |`);
  out.push('|---|---|---|');
  const quotes = [];
  for (const r of file.routes) {
    const routeLabel = mark(RS[r.routeId] ?? r.routeId);
    out.push(`| ${routeLabel} | ${STS[r.status] ?? r.status} | ${provenanceCell(r.provenance, locale, r.notes)} |`);
    quotes.push(provenanceQuoteEntry(RS[r.routeId] ?? r.routeId, r.provenance));
  }
  out.push(renderQuotesBlock(quotes, locale));
  out.push('');
  return out.join('\n');
}

function renderCancelSection(cc, locale) {
  const S = STRINGS[locale].cancel;
  const result = resolveCancelPolicy(cc);
  const tag = { NONE: S.tagNone, NO: S.tagNo, DRIFT: S.tagDrift, RESTRICTED: S.tagRestricted, YES: S.tagYes }[result.key];
  const detail =
    result.key === 'NONE'
      ? S.detailNone
      : result.key === 'NO'
        ? S.detailNo(result.routeStatus)
        : result.key === 'DRIFT'
          ? S.detailDrift(result.expected, result.actual)
          : result.key === 'RESTRICTED'
            ? S.detailRestricted(result.statuses)
            : S.detailYes;
  return `**${tag}** — ${detail}\n`;
}

function renderTaxSection(cc, locale, mark) {
  const S = STRINGS[locale].country;
  const CS = STRINGS[locale];
  const fact = taxSystems[cc];
  if (!fact) return `_${STRINGS[locale].common.noFile('tax-systems')}_\n`;
  const out = [];
  out.push(`- **${S.taxColKind}**: ${CS.kinds[fact.kind] ?? fact.kind}`);
  if (fact.kind === 'VAT' || fact.kind === 'GST') {
    const { rate, derived } = resolveStandardRate(cc, fact);
    if (rate !== undefined) {
      out.push(`- **${S.taxStandardRate}**: ${formatPercent(rate, locale)}${derived ? S.taxStandardRateDerived : ''}`);
    }
  }
  if (fact.reducedRates?.length) {
    out.push(`- **Reduced rates**: ${fact.reducedRates.map((r) => formatPercent(r, locale)).join(', ')}`);
  }
  if (fact.hasDomesticZeroRate !== undefined) {
    out.push(`- **${S.taxDomesticZeroRate}**: ${fact.hasDomesticZeroRate ? CS.common.yes : CS.common.no}`);
  }
  if (fact.schemes?.length) {
    out.push(`- **${S.taxSchemes}**: ${fact.schemes.map((s) => mark(CS.schemes[s] ?? s)).join(', ')}`);
  }
  if (fact.stateRates) {
    out.push(
      `- **${S.taxStateRates}**: ${Object.entries(fact.stateRates)
        .map(([k, v]) => `${k} ${formatPercent(v, locale)}`)
        .join(', ')}`,
    );
  }
  out.push(`- **${S.taxProvenance}**: ${provenanceBlock(fact.provenance, locale, fact.notes)}`);
  const quotes = [provenanceQuoteEntry(S.taxProvenance, fact.provenance)];
  const vat = vatRates[cc];
  if (vat) {
    out.push('');
    out.push(S.taxCatalogIntro);
    out.push('');
    out.push(`| ${S.taxRateColRate} | ${S.taxRateColLabel} | ${S.taxRateColCategory} | ${S.taxRateColProvenance} |`);
    out.push('|---|---|---|---|');
    for (const r of vat.rates) {
      out.push(
        `| ${formatPercent(r.rate, locale)} | ${cell(r.label)} | ${CS.categories[r.category] ?? r.category} | ` +
          `${provenanceCell(r.provenance, locale, r.notes)} |`,
      );
      quotes.push(provenanceQuoteEntry(`${formatPercent(r.rate, locale)} (${CS.categories[r.category] ?? r.category})`, r.provenance));
    }
  } else {
    out.push('');
    out.push(`_${S.taxNoCatalogNote}_`);
  }
  out.push(renderQuotesBlock(quotes, locale));
  out.push('');
  return out.join('\n');
}

function renderIdentifiersSection(cc, locale) {
  const S = STRINGS[locale].country;
  const CS = STRINGS[locale];
  const file = countryIdentifiers[cc];
  if (!file) return `_${STRINGS[locale].common.noFile('country-identifiers')}_\n`;
  const out = [];
  out.push(`| ${S.identifiersColScheme} | ${S.identifiersColAppliesTo} | ${S.identifiersColLabel} | ${S.identifiersColRequired} | ${S.identifiersColProvenance} |`);
  out.push('|---|---|---|---|---|');
  const quotes = [];
  for (const s of file.schemes) {
    out.push(
      `| ${s.scheme} | ${CS.partyTypes[s.appliesTo] ?? s.appliesTo} | ${cell(s.label)} | ` +
        `${s.required ? CS.common.yes : CS.common.no} | ${provenanceCell(s.provenance, locale, s.notes)} |`,
    );
    quotes.push(provenanceQuoteEntry(s.scheme, s.provenance));
  }
  out.push(renderQuotesBlock(quotes, locale));
  out.push('');
  return out.join('\n');
}

function renderMentionsSection(cc, locale) {
  const S = STRINGS[locale].country;
  const file = mentions[cc];
  if (!file) return `_${STRINGS[locale].common.noFile('mentions')}_\n`;
  const out = [];
  out.push(`| ${S.mentionsColSubject} | ${S.mentionsColText} | ${S.mentionsColLegalRef} | ${S.mentionsColValidFrom} |`);
  out.push('|---|---|---|---|');
  for (const entry of file.invoiceNotes) {
    const v = entry.value;
    out.push(`| ${cell(v.subjectCode) || STRINGS[locale].common.dash} | ${cell(v.text)} | ${cell(v.legalRef)} | ${entry.validFrom} |`);
  }
  out.push('');
  return out.join('\n');
}

function renderChannelMandateSection(cc, locale, mark) {
  const S = STRINGS[locale].country;
  const CS = STRINGS[locale];
  const file = channelPolicy[cc];
  if (!file) return `_${STRINGS[locale].common.noFile('channel-policy')}_\n`;
  const out = [];
  out.push(mark(S.channelEreportingNote));
  out.push('');
  out.push(`| ${S.channelColChannel} | ${S.channelColRequirement} | ${S.channelColMandatedFrom} | ${S.channelColProvenance} |`);
  out.push('|---|---|---|---|');
  const quotes = [];
  for (const f of file.facts) {
    out.push(
      `| ${mark(transportLabel(f.providerId))} (\`${f.providerId}\`) | ${CS.common[f.requirement] ?? f.requirement} | ` +
        `${f.mandatedFrom ?? STRINGS[locale].common.dash} | ${provenanceCell(f.provenance, locale, f.notes)} |`,
    );
    quotes.push(provenanceQuoteEntry(transportLabel(f.providerId), f.provenance));
  }
  out.push(renderQuotesBlock(quotes, locale));
  out.push('');
  return out.join('\n');
}

function renderBonusSections(cc, locale) {
  const S = STRINGS[locale].country;
  const out = [];
  const fields = countryFields[cc];
  if (fields) {
    out.push(`### ${S.sectionFieldOverlay}`);
    out.push('');
    out.push(S.fieldOverlayIntro);
    out.push('');
    for (const overlay of fields.overlays) {
      for (const op of overlay.operations) {
        const on = `${overlay.typeId}${op.path ? `.${op.path}` : ''}`;
        if (op.op === 'add') out.push(`- ${S.fieldOverlayAdd(op.field.key, on)}`);
        else if (op.op === 'modify') out.push(`- ${S.fieldOverlayModify(op.key, on)}`);
        else out.push(`- ${S.fieldOverlayRemove(op.key, on)}`);
      }
    }
    out.push('');
  }
  const content = contentRequirements[cc];
  if (content) {
    out.push(`### ${S.sectionContentRequirements}`);
    out.push('');
    out.push(`| ${S.contentReqColField} | ${S.contentReqColMandatedFrom} | ${S.contentReqColProvenance} |`);
    out.push('|---|---|---|');
    const quotes = [];
    for (const f of content.facts) {
      out.push(`| ${f.field} | ${f.mandatedFrom} | ${provenanceCell(f.provenance, locale, f.notes)} |`);
      quotes.push(provenanceQuoteEntry(f.field, f.provenance));
    }
    out.push(renderQuotesBlock(quotes, locale));
    out.push('');
  }
  return out.join('\n');
}

// =================================================================================================
// PART 1 — "IN PLAIN WORDS" RENDERERS.
//
// Every sentence below is assembled from the exact same STRUCTURED facts (booleans, enums, dates,
// numbers, labels) Part 2's render*Section functions above already read — never from a data file's
// own free-form `notes`/`resolutionNote` prose. That is rule #2 (this file's own header) applied to
// a friendlier register: "clear enough for a 15-year-old" is a tone requirement, not a license to
// paraphrase a legal citation nobody actually re-checked, or to invent a reason "why" beyond what
// the structured fact itself says.
//
// A mechanism with NO file for this country returns `null` here — buildCountryPage's own
// `notConfiguredCallout()` renders the honest "not yet configured" admonition in exactly the same
// shape for every mechanism, so a reader never has to guess whether a missing paragraph is a bug in
// this script or a real, named gap in the data (the brief's own "never a blank, always a reason").
// =================================================================================================

function notConfiguredCallout(name, mechanismPlain, locale) {
  const S = STRINGS[locale].country;
  return [`:::info ${S.notConfiguredTitle}`, '', S.notConfiguredBody(name, mechanismPlain), '', ':::', ''].join('\n');
}

/** country-policy, in plain words — see country-policy/data/*.json: every shipped country today
 *  ALLOWS every action, so the only thing worth calling out in Part 1 is a per-status narrowing
 *  (`invoice.save-draft` -> only while "draft", `received-invoice.receive` -> only while "received")
 *  or an outright forbidden action (none exist today, but the code does not assume that stays true —
 *  see `plainPolicyForbidden` above). */
function renderPlainPolicy(cc, locale, name) {
  const file = countryPolicy[cc];
  if (!file) return null;
  const S = STRINGS[locale].country;
  const out = [S.plainPolicyIntro(name, plainTypesList(file.documentTypes, locale))];
  const restricted = file.rules.filter((r) => r.allowed && r.statuses?.length);
  const forbidden = file.rules.filter((r) => !r.allowed);
  if (restricted.length || forbidden.length) {
    out.push('');
    for (const r of restricted) {
      const statusLabel = r.statuses.map((s) => plainStatusLabel(s, locale)).join(', ');
      out.push(`- ${S.plainPolicyRestriction(plainActionLabel(r.actionId, locale), plainTypeArticled(r.typeId, locale), statusLabel)}`);
    }
    for (const r of forbidden) {
      out.push(`- ${S.plainPolicyForbidden(plainActionLabel(r.actionId, locale), plainTypeArticled(r.typeId, locale))}`);
    }
  }
  return out.join('\n');
}

/** b2g-routing, in plain words — the transport/format a GOVERNMENT client in this country forces,
 *  plus the concrete pieces of information the plain reader actually has to go get before sending
 *  (a client identifier scheme, a required document field) — never the full technical rule shape
 *  (that stays Part 2's job). */
function renderPlainB2g(cc, locale, name, mark) {
  const rule = b2gRouting[cc];
  if (!rule) return null;
  const S = STRINGS[locale].country;
  const out = [mark(S.plainB2gIntro(name, transportWithModel(rule.transportId, locale), formatLabel(rule.formatSyntax)))];
  const needs = [
    ...(rule.requiredClientIdentifiers ?? []).map((r) => S.plainB2gIdentifierNeeded(r.label)),
    ...(rule.requiredDocumentFields ?? []).filter((f) => f.required).map((f) => S.plainB2gFieldNeeded(f.label)),
  ];
  if (needs.length) {
    out.push('', S.plainB2gNeedsIntro, '');
    for (const n of needs) out.push(`- ${n}`);
  }
  return out.join('\n');
}

/** correction-routes, in plain words — states the four-way vocabulary ONCE (required/allowed/
 *  forbidden/unverified), then lists only the routes actually checked against the law
 *  (`provenance.kind === 'legal'`) — an `unverified` route is real information (see this file's own
 *  header on why "unverified" is a first-class, honest state) but belongs in Part 2's full table,
 *  not the plain summary, which would otherwise be dominated by "not researched yet" noise. */
function renderPlainCorrection(cc, locale, name, mark) {
  const file = correctionRoutes[cc];
  if (!file) return null;
  const S = STRINGS[locale].country;
  const RS = STRINGS[locale].routes;
  const STS = STRINGS[locale].routeStatuses;
  const { sourced, total } = sourcedRouteCount(file);
  const out = [mark(S.plainCorrectionLegend), '', S.plainCorrectionIntro(name, sourced, total)];
  const known = file.routes.filter((r) => r.provenance.kind === 'legal');
  if (known.length) {
    out.push('');
    for (const r of known) out.push(`- **${mark(RS[r.routeId] ?? r.routeId)}** — ${STS[r.status] ?? r.status}`);
  } else {
    out.push('', S.plainCorrectionNoneSourced);
  }
  return out.join('\n');
}

/** The local-cancel derived fact, in plain words — same YES/RESTRICTED/NO/DRIFT/NONE outcomes
 *  `resolveCancelPolicy` already computes for the matrix and for Part 2's own `renderCancelSection`,
 *  just without the internal `CANCEL_AND_REPLACE` identifier in the reader-facing sentence. */
function renderPlainCancel(cc, locale) {
  const S = STRINGS[locale].country;
  const result = resolveCancelPolicy(cc);
  switch (result.key) {
    case 'NONE':
      return S.plainCancelNone;
    case 'NO':
      return S.plainCancelNo;
    case 'DRIFT':
      return S.plainCancelDrift;
    case 'RESTRICTED':
      return S.plainCancelRestricted(result.statuses.map((s) => plainStatusLabel(s, locale)).join(', '));
    default:
      return S.plainCancelYes;
  }
}

/** tax-systems + vat-rates, in plain words — the standard rate (declared, or derived from the VAT
 *  rate catalog — same `resolveStandardRate` Part 2 uses) plus, when a fuller catalog exists, every
 *  non-standard, non-exempt category as a short "reduced rate" list. */
function renderPlainTax(cc, locale, name) {
  const fact = taxSystems[cc];
  if (!fact) return null;
  const S = STRINGS[locale].country;
  const CS = STRINGS[locale];
  if (fact.kind === 'NONE') return S.plainTaxNone(name);
  if (fact.kind === 'SALES_TAX') return S.plainTaxOtherKind(name, CS.kinds[fact.kind] ?? fact.kind);
  const kindLabel = CS.kinds[fact.kind] ?? fact.kind;
  const { rate } = resolveStandardRate(cc, fact);
  const out = [rate === undefined ? S.plainTaxIntroNoRate(name, kindLabel) : S.plainTaxIntro(name, kindLabel, formatPercent(rate, locale))];
  const vat = vatRates[cc];
  if (vat) {
    const reduced = vat.rates.filter((r) => r.category !== 'STANDARD' && r.category !== 'EXEMPT');
    if (reduced.length) {
      const list = reduced
        .map((r) => `${formatPercent(r.rate, locale)} (${(CS.categories[r.category] ?? r.category).toLowerCase()})`)
        .join(', ');
      out.push(S.plainTaxReduced(list));
    }
  }
  return out.join(' ');
}

/** country-identifiers, in plain words — every scheme this country's own catalog declares, split
 *  only on required-vs-optional (the technical `appliesTo`/`pattern`/provenance stay Part 2's job). */
function renderPlainIdentifiers(cc, locale, name) {
  const file = countryIdentifiers[cc];
  if (!file || !file.schemes?.length) return null;
  const S = STRINGS[locale].country;
  const CS = STRINGS[locale];
  const out = [S.plainIdentifiersIntro(name), ''];
  for (const s of file.schemes) {
    const partyType = CS.partyTypes[s.appliesTo] ?? s.appliesTo;
    out.push(`- ${s.required ? S.plainIdentifierRequired(s.label, partyType) : S.plainIdentifierOptional(s.label, partyType)}`);
  }
  return out.join('\n');
}

/** mentions, in plain words — deliberately just a COUNT and a pointer to Part 2: the mention TEXT
 *  itself is the law's own words (a `legalRef`-backed quote, per-mention), so it belongs exactly
 *  once, in the table that already carries its citation — repeating it here in a "simplified" form
 *  would be exactly the kind of paraphrase-of-a-citation rule #2 forbids. */
function renderPlainMentions(cc, locale, name) {
  const file = mentions[cc];
  if (!file || !file.invoiceNotes?.length) return null;
  const S = STRINGS[locale].country;
  return S.plainMentionsIntro(name, file.invoiceNotes.length);
}

/** channel-policy (the SELLER's own country), in plain words — the one binary a plain reader needs:
 *  is this legally forced (mandated, with a date) or merely the going habit (suggested)? Multiple
 *  facts (more than one channel) are listed one bullet each, same as B2G's own "needs" list above. */
function renderPlainChannel(cc, locale, name, mark) {
  const file = channelPolicy[cc];
  if (!file || !file.facts?.length) return null;
  const S = STRINGS[locale].country;
  const lines = file.facts.map((f) => {
    const label = mark(transportLabel(f.providerId));
    return f.requirement === 'mandated' ? S.plainChannelMandated(name, label, f.mandatedFrom) : S.plainChannelSuggested(name, label);
  });
  return lines.length === 1 ? lines[0] : lines.map((l) => `- ${l}`).join('\n');
}

/** content-requirements, in plain words — grouped into the SAME Part-1 subsection as mentions (both
 *  are "extra legal text/fields an invoice must carry"), but rendered separately since a country can
 *  have one without the other (today, only France has either). Deliberately just a COUNT, same
 *  restraint as `renderPlainMentions` above: the field id itself (e.g. "BT-23") is an EN 16931
 *  business-term code, not plain English, so Part 2's own table is where it belongs. */
function renderPlainContentRequirements(cc, locale, name) {
  const file = contentRequirements[cc];
  if (!file || !file.facts?.length) return null;
  const S = STRINGS[locale].country;
  return S.plainContentRequirementsIntro(name, file.facts.length);
}

/**
 * A country page is now TWO passes over the exact same loaded data, at two different altitudes —
 * the brief's own "an elève de seconde reads Part 1, a professional reads Part 2" split:
 *
 *  - PART 1 ("in plain words") is built ENTIRELY from `renderPlain*` functions above: short,
 *    complete sentences, no internal identifier (`CANCEL_AND_REPLACE`, `BT-23`, a raw `routeId`)
 *    ever appears unexplained, and every technical noun that DOES appear (VAT, B2G, Peppol, CIUS,
 *    schemeID, XAdES, …) is glossary-marked so hovering it explains it inline. A mechanism absent
 *    for this country renders the SAME `notConfiguredCallout` admonition here, every time — never a
 *    blank paragraph a reader has to interpret as either "nothing to say" or "the page is broken".
 *  - PART 2 ("the details") is the ORIGINAL, pre-this-task render*Section machinery, UNCHANGED in
 *    substance (same tables, same citations, same `<details>` quote blocks) — only its own headings
 *    are demoted from `##` to `###` so both parts nest cleanly under one `##` each in the sidebar's
 *    table of contents.
 *
 * The SAME `mark()` glossary-marker instance is threaded through both parts (created once, right
 * here), so a term explained once in Part 1 is not re-annotated (redundantly) the first time Part 2
 * also happens to use it — see `createGlossaryMarker`'s own "first occurrence, per page" contract.
 */
function buildCountryPage(cc, locale, position) {
  const S = STRINGS[locale].country;
  const mark = createGlossaryMarker(locale);
  const name = countryName(cc, locale);
  const sources = SOURCE_FILE_LABELS.filter(([, data]) => data[cc]).map(
    ([dir]) => `backend/src/modules/documents/${dir}/${cc.toLowerCase()}.json`,
  );
  const lines = [];
  lines.push('---');
  lines.push(`title: ${yamlString(`${name} (${cc})`)}`);
  lines.push(`description: ${yamlString(S.descriptionOf(name))}`);
  lines.push(`sidebar_position: ${position}`);
  lines.push(`sidebar_label: ${yamlString(name)}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${name} (${cc})`);
  lines.push('');
  lines.push(S.generatedNotice);
  lines.push('');

  // ============================================================= PART 1 — IN PLAIN WORDS =========
  lines.push(`## ${mark(S.part1Heading)}`);
  lines.push('');
  lines.push(S.part1Intro(name));
  lines.push('');

  /** Pushes one Part-1 subsection: its heading, then either the given (already-rendered) plain
   *  content or the shared "not yet configured" admonition when that content is `null` — the one
   *  place every `renderPlain*` function's "no file for this country" case actually surfaces. */
  const pushPlain = (heading, mechanismPlain, content) => {
    lines.push(`### ${mark(capitalize(heading))}`);
    lines.push('');
    lines.push(content ?? notConfiguredCallout(name, mechanismPlain, locale));
    lines.push('');
  };

  pushPlain(S.mechanismPlainPolicy, S.mechanismPlainPolicy, renderPlainPolicy(cc, locale, name));
  pushPlain(S.mechanismPlainTax, S.mechanismPlainTax, renderPlainTax(cc, locale, name));
  pushPlain(S.mechanismPlainCorrection, S.mechanismPlainCorrection, renderPlainCorrection(cc, locale, name, mark));
  // Local cancel has no "not configured" state of its own: `resolveCancelPolicy` always resolves to
  // a real answer (down to "NONE" when correction-routes itself has no file), so this subsection
  // never needs the shared callout — see renderPlainCancel's own header.
  lines.push(`### ${capitalize(S.mechanismPlainCancel)}`);
  lines.push('');
  lines.push(renderPlainCancel(cc, locale));
  lines.push('');
  pushPlain(S.mechanismPlainIdentifiers, S.mechanismPlainIdentifiers, renderPlainIdentifiers(cc, locale, name));
  pushPlain(S.mechanismPlainB2g, S.mechanismPlainB2g, renderPlainB2g(cc, locale, name, mark));
  pushPlain(S.mechanismPlainChannel, S.mechanismPlainChannel, renderPlainChannel(cc, locale, name, mark));

  // Mentions + content-requirements share ONE Part-1 subsection ("extra legal text and fields an
  // invoice must carry") since both answer the same plain question, even though they are two
  // independently-absent mechanisms (only France ships either today) — see
  // renderPlainContentRequirements's own header.
  {
    const mentionsPlain = renderPlainMentions(cc, locale, name);
    const contentReqPlain = renderPlainContentRequirements(cc, locale, name);
    lines.push(`### ${mark(capitalize(S.mechanismPlainMentions))}`);
    lines.push('');
    if (mentionsPlain || contentReqPlain) {
      if (mentionsPlain) lines.push(mentionsPlain);
      if (mentionsPlain && contentReqPlain) lines.push('');
      if (contentReqPlain) lines.push(contentReqPlain);
    } else {
      lines.push(notConfiguredCallout(name, S.mechanismPlainMentions, locale));
    }
    lines.push('');
  }

  // ============================================================= PART 2 — THE DETAILS ============
  lines.push(`## ${mark(S.part2Heading)}`);
  lines.push('');
  lines.push(S.part2Intro);
  lines.push('');
  lines.push(`### ${mark(S.sectionPolicy)}`);
  lines.push('');
  lines.push(renderPolicySection(cc, locale, mark));
  lines.push(`### ${mark(S.sectionB2g)}`);
  lines.push('');
  lines.push(`_${S.b2gIntro}_`);
  lines.push('');
  lines.push(renderB2gSection(cc, locale, mark));
  lines.push(`### ${S.sectionCorrection}`);
  lines.push('');
  lines.push(renderCorrectionRoutesSection(cc, locale, mark));
  lines.push(`### ${S.sectionCancel}`);
  lines.push('');
  lines.push(renderCancelSection(cc, locale));
  lines.push('');
  lines.push(`### ${S.sectionTax}`);
  lines.push('');
  lines.push(renderTaxSection(cc, locale, mark));
  lines.push(`### ${S.sectionIdentifiers}`);
  lines.push('');
  lines.push(renderIdentifiersSection(cc, locale));
  lines.push(`### ${S.sectionMentions}`);
  lines.push('');
  lines.push(renderMentionsSection(cc, locale));
  lines.push(`### ${mark(S.sectionChannel)}`);
  lines.push('');
  lines.push(renderChannelMandateSection(cc, locale, mark));
  const bonus = renderBonusSections(cc, locale);
  if (bonus.trim()) lines.push(bonus);
  lines.push(S.seeGlossaryLink);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(S.footer(sources.length ? sources.map((s) => `\`${s}\``).join(', ') : STRINGS[locale].common.dash));
  lines.push('');
  return lines.join('\n');
}

// =================================================================================================
// WRITE
// =================================================================================================
function main() {
  for (const locale of LOCALES) {
    const outDir = OUT_DIRS[locale];
    if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    writeFileSync(
      join(outDir, '_category_.json'),
      `${JSON.stringify({ label: locale === 'fr' ? 'Support par pays' : 'Country Support', position: 7 }, null, 2)}\n`,
    );

    writeFileSync(join(outDir, 'index.md'), buildMatrixPage(locale));

    DETAIL_PAGES.forEach((cc, i) => {
      writeFileSync(join(outDir, `${cc.toLowerCase()}.md`), buildCountryPage(cc, locale, i + 2));
    });

    console.log(
      `generate-country-matrix: wrote index.md + ${DETAIL_PAGES.length} country pages to ${outDir} ` +
        `(${unionCountries.length} countries in the matrix, locale=${locale}).`,
    );
  }
}

main();
