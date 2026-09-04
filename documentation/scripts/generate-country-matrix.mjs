#!/usr/bin/env node
/**
 * Generates the "Country Support" docs pages FROM the compliance engine's own data files — never
 * the other way around. Same governing idea as before this rewrite (see git history for the prior
 * version's own header): nobody hand-writes "Poland allows X" in a markdown file that can silently
 * rot the day someone edits `backend/src/modules/documents/**\/data/pl.json` and forgets the doc.
 *
 * THIS REWRITE (feedback mandant, TODO_DOCUMENTS.md "Vague A") fixes six things the previous
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

// The 17 countries that get a full narrative page: the 8 country-policy jurisdictions plus the 9
// Peppol-BIS-only B2G countries from the 2026-09-02 audit (B2G_COVERAGE.md) — every other country
// in the union below appears ONLY as a row in the matrix, honestly thin.
const DETAIL_PAGES = [
  'FR',
  'DE',
  'IT',
  'PL',
  'ES',
  'MX',
  'US',
  'HU',
  'BE',
  'CY',
  'EE',
  'GR',
  'LT',
  'LU',
  'LV',
  'MT',
  'SE',
];

// =================================================================================================
// TEXT / MDX HELPERS
// =================================================================================================
function clean(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
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
    for (const { term, title } of entries) {
      if (seen.has(term)) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'u');
      const m = re.exec(out);
      if (!m) continue;
      seen.add(term);
      const idx = m.index;
      out = `${out.slice(0, idx)}<abbr title="${escapeAttr(title)}">${m[1]}</abbr>${out.slice(idx + m[1].length)}`;
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
    out.push(`## ${S.sectionFieldOverlay}`);
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
    out.push(`## ${S.sectionContentRequirements}`);
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
  lines.push(`## ${mark(S.sectionPolicy)}`);
  lines.push('');
  lines.push(renderPolicySection(cc, locale, mark));
  lines.push(`## ${mark(S.sectionB2g)}`);
  lines.push('');
  lines.push(`_${S.b2gIntro}_`);
  lines.push('');
  lines.push(renderB2gSection(cc, locale, mark));
  lines.push(`## ${S.sectionCorrection}`);
  lines.push('');
  lines.push(renderCorrectionRoutesSection(cc, locale, mark));
  lines.push(`## ${S.sectionCancel}`);
  lines.push('');
  lines.push(renderCancelSection(cc, locale));
  lines.push('');
  lines.push(`## ${S.sectionTax}`);
  lines.push('');
  lines.push(renderTaxSection(cc, locale, mark));
  lines.push(`## ${S.sectionIdentifiers}`);
  lines.push('');
  lines.push(renderIdentifiersSection(cc, locale));
  lines.push(`## ${S.sectionMentions}`);
  lines.push('');
  lines.push(renderMentionsSection(cc, locale));
  lines.push(`## ${mark(S.sectionChannel)}`);
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
