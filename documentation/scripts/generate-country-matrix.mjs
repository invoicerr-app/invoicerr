#!/usr/bin/env node
/**
 * Generates the "Country Support" docs pages FROM the compliance engine's own data files —
 * never the other way around. This is the mechanism that keeps
 * `documentation/docs/developer-guide/country-support/` honest: nobody hand-writes "Poland
 * allows X" in a markdown file that can silently rot the day someone edits
 * `backend/src/modules/documents/**\/data/pl.json` and forgets the doc. Every fact in the
 * generated pages is read straight from the same JSON (and, for the cancel whitelist, TS)
 * files the backend itself loads at boot — see each `data/all.ts` in that tree for the
 * loader this script mirrors (directory scan, not a hardcoded list — see `loadDataDir` below
 * for why that is actually MORE faithful to "the data is the truth" than copying each
 * `COUNTRY_FILES` array by hand would be).
 *
 * WIRING: run as `prebuild`/`prestart` (see ../package.json) — npm's own pre-script convention
 * runs this before `docusaurus build` / `docusaurus start` automatically, so the generated
 * pages can never be stale in a build, and a fresh checkout with no generated pages at all
 * still builds correctly. The OUTPUT directory is gitignored (../.gitignore) — regenerating it
 * is the whole point, not an accident to guard against.
 *
 * DETERMINISM: no `Date.now()`, no `Math.random()`, no network call — every byte of output is a
 * pure function of the JSON/TS files this script reads, and every directory listing is sorted
 * before use. Two runs against the same source tree produce byte-identical output (verified by
 * running this script twice and diffing `country-support/` — see the project's own report on
 * this task for the actual diff).
 *
 * SCOPE: this script does not validate the data (the backend's own `assertValid*` gates at
 * `data/all.ts` load time already do that, every time the backend boots or its tests run) — it
 * only READS and RENDERS. A malformed file here fails loudly (the aggregator functions below
 * throw with the offending path) rather than silently skipping a country.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DOCUMENTS_ROOT = join(REPO_ROOT, 'backend', 'src', 'modules', 'documents');
const OUT_DIR = join(__dirname, '..', 'docs', 'developer-guide', 'country-support');

// ---------------------------------------------------------------------------------------------
// Generic "read every <cc>.json in this directory" loader — the one thing every mechanism's own
// data/all.ts already does with `fs.readFileSync` + `JSON.parse` (see each module's own header
// on why: a data file is meant to be editable without a TypeScript rebuild). Scanning the
// directory instead of hardcoding each `COUNTRY_FILES` array is a DELIBERATE choice: this
// script's job is to describe what the data tree actually contains, so it reads the same
// mechanical fact the backend's own loader would (a file named `pl.json` exists) rather than a
// second, hand-copied list that could quietly drift from it.
// ---------------------------------------------------------------------------------------------
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
// Unwrapped here, once, so every consumer below can read `b2gRouting[cc].transportId` directly.
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
// The local-cancellation whitelist lives in TypeScript (`correction-routes/cancel-policy.ts`),
// not JSON, because it is code that cross-checks itself against the correction-routes data at
// read time (see that file's own header). Its `CANCEL_LOCAL_AVAILABILITY` object is nonetheless
// a PLAIN data literal (no TS-only syntax inside the braces) — extracted here by locating the
// matching braces and evaluating the literal, rather than hand-copying the four country rows
// into this script where they could drift from the real whitelist silently.
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
  // The literal is a trusted, checked-in repo source file (not user input) — evaluating it is
  // the same trust boundary this whole script already crosses by `require`-ing nothing and
  // `JSON.parse`-ing the rest of the tree.
  return new Function(`"use strict"; return (${literal});`)();
}

const cancelWhitelist = loadCancelWhitelist();

function findCorrectionRoute(file, routeId) {
  return file?.routes?.find((r) => r.routeId === routeId);
}

/** Mirrors `resolveCancelPolicyForCountry` in cancel-policy.ts — see that function's own header
 *  for the full reasoning. Returns a short tag (`'oui' | 'restreinte' | 'non' | '—'`) plus the
 *  prose explaining it, for the matrix cell and the country page respectively. */
function resolveCancelPolicy(cc) {
  const route = findCorrectionRoute(correctionRoutes[cc], 'CANCEL_AND_REPLACE');
  if (!route) {
    return { tag: '—', detail: 'No correction-routes data (CANCEL_AND_REPLACE) declared for this country.' };
  }
  const whitelisted = cancelWhitelist[cc];
  if (!whitelisted) {
    return {
      tag: 'non',
      detail:
        `Not implementable locally: CANCEL_AND_REPLACE is "${route.status}" in this country's own ` +
        `correction-routes data, but no local cancellation mechanism is wired for it (see ` +
        'correction-routes/cancel-policy.ts — this is the documented "the route exists in law, ' +
        'the channel/mechanism to realize it does not" case).',
    };
  }
  if (route.status !== whitelisted.expectedStatus) {
    // The whitelist's own drift guard (cancel-policy.ts throws on this at read time) — surfaced
    // here as a loud page note instead of a script crash, so a real drift is visible in the
    // generated doc rather than silently swallowed, but a human still has to fix the whitelist.
    return {
      tag: '⚠ drift',
      detail:
        `cancel-policy.ts's whitelist expected CANCEL_AND_REPLACE status "${whitelisted.expectedStatus}" ` +
        `but the data now says "${route.status}" — the whitelist in correction-routes/cancel-policy.ts ` +
        'needs review; this line is not a reliable fact until it is.',
    };
  }
  if (whitelisted.restrictedToStatuses) {
    return {
      tag: 'restreinte',
      detail:
        `Available, but only while the invoice is in status ${whitelisted.restrictedToStatuses.join(', ')} ` +
        `— CANCEL_AND_REPLACE (status: ${route.status}) narrows to this in this country's own data.`,
    };
  }
  return {
    tag: 'oui',
    detail: `Available, unrestricted — CANCEL_AND_REPLACE is "${route.status}" with no status narrowing.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Presentation-only label maps. These are NOT legal claims — they never affect which facts are
// shown, only how a raw id (`fa3`, `ksef`) is spelled out next to itself. Extending coverage
// never requires touching this map: an unknown id just prints as-is.
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
const COUNTRY_NAMES = {
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
};

function countryName(cc) {
  return COUNTRY_NAMES[cc] ?? cc;
}
function transportLabel(id) {
  return TRANSPORT_LABELS[id] ?? id;
}
function formatLabel(id) {
  return FORMAT_LABELS[id] ?? id;
}

// The 17 countries that get a full narrative page (root task's own list): the 8 country-policy
// jurisdictions plus the 9 Peppol-BIS-only B2G countries from the 2026-09-02 audit
// (B2G_COVERAGE.md) — every other country in the union below appears ONLY as a row in the
// matrix, honestly thin (usually just a VAT rate from the EU TEDB).
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

// ---------------------------------------------------------------------------------------------
// Text helpers — collapse whitespace (a lot of the source `sourceText`/`resolutionNote` strings
// carry embedded newlines from being pasted verbatim from a legal PDF) and truncate cleanly.
// Never paraphrases: what is kept is a PREFIX of the real quoted text, never a rewrite.
// ---------------------------------------------------------------------------------------------
function clean(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
function truncate(text, max) {
  const c = clean(text);
  if (c.length <= max) return c;
  return `${c.slice(0, max).trimEnd()}…`;
}
/**
 * These pages are MDX, not plain Markdown — Docusaurus parses `{...}` as a JS expression and a
 * bare `<Word` as the start of a JSX tag. Several legal citations quoted VERBATIM in the source
 * data are HTML fragments straight from an API response (the EU TEDB's own `<p>Article 1...</p>`)
 * or contain a literal `{ ... }` (a JSON snippet quoted as-is, a `{ role: 'B2B' }` scope example).
 * Escaping to HTML entities keeps the citation's actual characters visible to the reader while
 * making them inert to the MDX compiler — the alternative (stripping them) would be lying about
 * what the source text says.
 */
function escapeMdx(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}
function cell(text) {
  // Markdown table cell + MDX escaping: no raw pipes/newlines, nothing MDX would try to parse.
  return escapeMdx(clean(text)).replace(/\|/g, '\\|');
}

function provenanceCell(p, max = 200) {
  if (!p || !p.kind) return '_no provenance_';
  if (p.kind === 'legal') {
    return `legal (checked ${p.sourceCheckedAt}) — "${cell(truncate(p.sourceText, max))}"`;
  }
  return `unverified — ${cell(truncate(p.resolutionNote, max))}`;
}
function provenanceBadge(p) {
  return p?.kind === 'legal' ? 'legal' : p?.kind === 'unverified' ? 'unverified' : '—';
}

/** `standardRate` is OPTIONAL on a VAT/GST fact — when absent, `tax/tax-systems/registry.ts`
 *  derives it from `vat-rates/registry.ts`'s own STANDARD-category entry for the same country
 *  (schema.ts's own "DELIBERATE NON-DUPLICATION" header; France is the shipped example: its own
 *  tax-systems/data/fr.json carries no `standardRate` at all). Mirrored here rather than printed
 *  as a literal `undefined` — the derivation is itself a documented, sourced fact (the vat-rates
 *  entry carries its own provenance), never a guess this script invents. */
function resolveStandardRate(cc, fact) {
  if (fact.standardRate !== undefined) return { rate: fact.standardRate, derived: false };
  const standard = vatRates[cc]?.rates?.find((r) => r.category === 'STANDARD');
  return standard ? { rate: standard.rate, derived: true } : { rate: undefined, derived: false };
}

function taxSummary(cc, fact) {
  if (!fact) return '—';
  switch (fact.kind) {
    case 'VAT':
    case 'GST': {
      const { rate, derived } = resolveStandardRate(cc, fact);
      const rateText = rate === undefined ? 'rate not declared' : `${rate}%${derived ? ', derived' : ''}`;
      return `${fact.kind} ${rateText} (${provenanceBadge(fact.provenance)})`;
    }
    case 'SALES_TAX':
      return `SALES_TAX, state-based (${provenanceBadge(fact.provenance)})`;
    case 'NONE':
      return `NONE (${provenanceBadge(fact.provenance)})`;
    default:
      return fact.kind;
  }
}

function sourcedRouteCount(file) {
  if (!file) return null;
  const total = file.routes.length;
  const sourced = file.routes.filter((r) => r.status !== 'unverified').length;
  return { sourced, total };
}

// ---------------------------------------------------------------------------------------------
// Union of every country code known to ANY mechanism this script reads — the matrix's own row
// set. A country appearing here with mostly "—" cells is not a bug in this script: it is the
// honest state of that country's coverage today.
// ---------------------------------------------------------------------------------------------
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
  ['country-policy/data', countryPolicy, 'Document-action policy'],
  ['b2g-routing/data', b2gRouting, 'B2G routing'],
  ['correction-routes/data', correctionRoutes, 'Correction routes'],
  ['transports/channel-policy/data', channelPolicy, 'Channel policy (seller-country mandate)'],
  ['tax/tax-systems/data', taxSystems, 'Tax system'],
  ['country-identifiers/data', countryIdentifiers, 'Required identifiers'],
  ['mentions/data', mentions, 'Mandatory mentions'],
  ['country-fields/data', countryFields, 'Field overlay'],
  ['content-requirements/data', contentRequirements, 'Content requirements'],
  ['vat-rates/data', vatRates, 'VAT rate catalog (dropdown)'],
];

// =================================================================================================
// MATRIX PAGE
// =================================================================================================
function buildMatrixPage() {
  const lines = [];
  lines.push('---');
  lines.push('title: Country Compliance Matrix');
  lines.push('description: Every mechanism, per country, read straight from the compliance engine\'s own data files.');
  lines.push('sidebar_position: 1');
  lines.push('sidebar_label: Overview');
  lines.push('---');
  lines.push('');
  lines.push('# Country compliance matrix');
  lines.push('');
  lines.push(
    '> **This page is generated.** Every cell below is read directly from the JSON data files ' +
      'the compliance engine itself loads at boot — nobody hand-typed these facts, and nobody ' +
      'can let them drift: rerun `npm run build` (or `npm run start`) in `documentation/` and this ' +
      'page is rebuilt from whatever the data files say today. See ' +
      '[Adding a country](../adding-a-country.md) to add a row or a column.',
  );
  lines.push('');
  lines.push(
    `${unionCountries.length} countries are known to at least one mechanism. A **✓** or a value ` +
      'means the fact is declared and sourced (or explicitly marked unverified — see the country ' +
      'page); a **—** means this exact mechanism has no file for this country at all: an honest ' +
      'absence, never a guessed default.',
  );
  lines.push('');
  lines.push(
    '| Country | Policy | B2G route | Correction routes | Local cancel | Tax system | ' +
      'Identifiers | Mentions | Channel mandate |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');

  for (const cc of unionCountries) {
    const name = countryName(cc);
    const hasDetail = DETAIL_PAGES.includes(cc);
    const label = hasDetail ? `[${name} (${cc})](./${cc.toLowerCase()}.md)` : `${name} (${cc})`;

    const policy = countryPolicy[cc] ? '✓' : '—';

    const b2g = b2gRouting[cc]
      ? `${transportLabel(b2gRouting[cc].transportId)} / ${formatLabel(b2gRouting[cc].formatSyntax)}`
      : '—';

    const corr = correctionRoutes[cc]
      ? (() => {
          const { sourced, total } = sourcedRouteCount(correctionRoutes[cc]);
          return `${sourced}/${total} sourced`;
        })()
      : '—';

    // resolveCancelPolicy already returns '—' when there is no correction-routes file at all —
    // no extra branching needed here.
    const cancelCell = resolveCancelPolicy(cc).tag;

    const tax = taxSystems[cc] ? taxSummary(cc, taxSystems[cc]) : '—';

    const idents = countryIdentifiers[cc]
      ? countryIdentifiers[cc].schemes.map((s) => s.scheme).join(', ')
      : '—';

    const ments = mentions[cc] ? `${mentions[cc].invoiceNotes.length} mentions` : '—';

    const chan = channelPolicy[cc]
      ? channelPolicy[cc].facts
          .map((f) =>
            f.requirement === 'mandated'
              ? `${transportLabel(f.providerId)}: mandated (from ${f.mandatedFrom})`
              : `${transportLabel(f.providerId)}: suggested`,
          )
          .join('; ')
      : '—';

    lines.push(
      `| ${label} | ${policy} | ${cell(b2g)} | ${cell(corr)} | ${cell(cancelCell)} | ${cell(tax)} | ` +
        `${cell(idents)} | ${cell(ments)} | ${cell(chan)} |`,
    );
  }

  lines.push('');
  lines.push('## What each column reads');
  lines.push('');
  lines.push('| Column | Source directory | Meaning |');
  lines.push('|---|---|---|');
  lines.push(
    '| Policy | `backend/src/modules/documents/country-policy/data/` | Whether this country has a ' +
      'document-action policy file at all (which document ACTIONS — send, save-draft, ... — are ' +
      'allowed, and under what restriction). |',
  );
  lines.push(
    '| B2G route | `backend/src/modules/documents/b2g-routing/data/` | The transport + format used ' +
      'when THIS country is the government CLIENT\'s country, regardless of the seller\'s own country. |',
  );
  lines.push(
    '| Correction routes | `backend/src/modules/documents/correction-routes/data/` | How many of the ' +
      '11 canonical correction routes (credit note, corrective invoice, cancel-and-replace, ...) are ' +
      'sourced to a real legal citation for this country, out of 11. |',
  );
  lines.push(
    '| Local cancel | `correction-routes/cancel-policy.ts` | Whether cancelling an already-issued ' +
      'invoice is actually implementable in this app for this country — **oui** (yes, unrestricted), ' +
      '**restreinte** (yes, but only from certain statuses), or **non** (the legal route may exist, ' +
      'but no channel/mechanism in this repo realizes it — see the country page). |',
  );
  lines.push(
    '| Tax system | `backend/src/modules/documents/tax/tax-systems/data/` | The tax kind (VAT/GST/' +
      'SALES_TAX/NONE) and standard rate the cross-border tax engine assumes for this country. |',
  );
  lines.push(
    '| Identifiers | `backend/src/modules/documents/country-identifiers/data/` | Which national ' +
      'identifier schemes (SIRET, EIN, VAT number, ...) this country requires on a party. |',
  );
  lines.push(
    '| Mentions | `backend/src/modules/documents/mentions/data/` | How many mandatory free-text ' +
      'mentions (BG-1/BT-21/BT-22) this country requires on every invoice. |',
  );
  lines.push(
    '| Channel mandate | `backend/src/modules/documents/transports/channel-policy/data/` | What this ' +
      'country says about a transmission channel for a SELLER established there: merely the usual one ' +
      '(**suggested**) or legally required from a given date (**mandated**). |',
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '_Generated from the compliance engine\'s own data files — do not edit by hand. Sources: ' +
      SOURCE_FILE_LABELS.map(([dir]) => `\`backend/src/modules/documents/${dir}/\``).join(', ') +
      '.  See [Adding a country](../adding-a-country.md) for how to extend any of these.  Regenerate ' +
      'with `node documentation/scripts/generate-country-matrix.mjs` (also runs automatically before ' +
      '`npm run build`/`npm run start` in `documentation/`).',
  );
  lines.push('');
  return lines.join('\n');
}

// =================================================================================================
// COUNTRY PAGE
// =================================================================================================
function renderPolicySection(cc) {
  const file = countryPolicy[cc];
  if (!file) return '_No document-action policy file declared for this country — every document ' +
    'action is refused for it today (see `country-policy.ts`\'s own "no permissive fallback" rule)._\n';
  const out = [];
  out.push(`Document types shown for a company of this country: ${file.documentTypes.join(', ')}.`);
  out.push('');
  out.push('| Type | Action | Allowed | Restricted to status | Provenance |');
  out.push('|---|---|---|---|---|');
  for (const r of file.rules) {
    out.push(
      `| ${r.typeId} | ${r.actionId} | ${r.allowed ? '✓' : '✗ forbidden'} | ` +
        `${r.statuses ? r.statuses.join(', ') : '—'} | ${provenanceCell(r.provenance)} |`,
    );
  }
  if (file.notes) {
    out.push('');
    out.push(`> ${cell(truncate(file.notes, 400))}`);
  }
  out.push('');
  return out.join('\n');
}

function renderB2gSection(cc) {
  const rule = b2gRouting[cc];
  if (!rule) {
    return '_No B2G routing rule declared — sending to a government client of this country has no ' +
      'founded channel/format in this repo yet._\n';
  }
  const out = [];
  out.push(`- **Transport**: ${transportLabel(rule.transportId)} (\`${rule.transportId}\`)`);
  out.push(`- **Format**: ${formatLabel(rule.formatSyntax)} (\`${rule.formatSyntax}\`)`);
  if (rule.requiredClientIdentifiers?.length) {
    out.push(
      `- **Required client identifiers**: ${rule.requiredClientIdentifiers
        .map((r) => `${r.scheme} — ${cell(r.label)}`)
        .join('; ')}`,
    );
  }
  if (rule.requiredDocumentFields?.length) {
    out.push(
      `- **Document fields**: ${rule.requiredDocumentFields
        .map((f) => `${cell(f.label)} (${f.required ? 'required' : 'optional'})`)
        .join('; ')}`,
    );
  }
  out.push(`- **Provenance**: ${provenanceCell(rule.provenance, 260)}`);
  out.push('');
  return out.join('\n');
}

function renderCorrectionRoutesSection(cc) {
  const file = correctionRoutes[cc];
  if (!file) return '_No correction-routes file declared for this country._\n';
  const out = [];
  const { sourced, total } = sourcedRouteCount(file);
  out.push(`Sourced: ${sourced}/${total} routes (the rest are honestly \`unverified\`).`);
  out.push('');
  out.push('| Route | Status | Provenance |');
  out.push('|---|---|---|');
  for (const r of file.routes) {
    out.push(`| ${r.routeId} | ${r.status} | ${provenanceCell(r.provenance)} |`);
  }
  if (file.notes) {
    out.push('');
    out.push(`> ${cell(truncate(file.notes, 400))}`);
  }
  out.push('');
  return out.join('\n');
}

function renderCancelSection(cc) {
  const { tag, detail } = resolveCancelPolicy(cc);
  return `**${tag}** — ${detail}\n`;
}

function renderTaxSection(cc) {
  const fact = taxSystems[cc];
  if (!fact) return '_No tax-system fact declared for this country._\n';
  const out = [];
  out.push(`- **Kind**: ${fact.kind}`);
  if (fact.kind === 'VAT' || fact.kind === 'GST') {
    const { rate, derived } = resolveStandardRate(cc, fact);
    if (rate !== undefined) {
      out.push(
        `- **Standard rate**: ${rate}%` +
          (derived
            ? ' _(not declared in this tax-system file — derived from the vat-rates catalog\'s own STANDARD entry below)_'
            : ''),
      );
    }
  }
  if (fact.reducedRates?.length) out.push(`- **Reduced rates**: ${fact.reducedRates.join(', ')}%`);
  if (fact.hasDomesticZeroRate !== undefined) {
    out.push(`- **Domestic zero rate**: ${fact.hasDomesticZeroRate ? 'yes' : 'no'}`);
  }
  if (fact.schemes?.length) out.push(`- **VAT schemes**: ${fact.schemes.join(', ')}`);
  if (fact.stateRates) {
    out.push(
      `- **State rates**: ${Object.entries(fact.stateRates)
        .map(([k, v]) => `${k} ${v}%`)
        .join(', ')}`,
    );
  }
  out.push(`- **Provenance**: ${provenanceCell(fact.provenance, 260)}`);
  const vat = vatRates[cc];
  if (vat) {
    out.push('');
    out.push('Dropdown VAT rate catalog (what a user actually picks per line):');
    out.push('');
    out.push('| Rate | Label | Category | Provenance |');
    out.push('|---|---|---|---|');
    for (const r of vat.rates) {
      out.push(`| ${r.rate}% | ${cell(r.label)} | ${r.category} | ${provenanceCell(r.provenance, 160)} |`);
    }
  }
  out.push('');
  return out.join('\n');
}

function renderIdentifiersSection(cc) {
  const file = countryIdentifiers[cc];
  if (!file) return '_No identifier requirements declared for this country._\n';
  const out = [];
  out.push('| Scheme | Applies to | Label | Required | Provenance |');
  out.push('|---|---|---|---|---|');
  for (const s of file.schemes) {
    out.push(
      `| ${s.scheme} | ${s.appliesTo} | ${cell(s.label)} | ${s.required ? 'yes' : 'no'} | ` +
        `${provenanceCell(s.provenance, 200)} |`,
    );
  }
  out.push('');
  return out.join('\n');
}

function renderMentionsSection(cc) {
  const file = mentions[cc];
  if (!file) return '_No mandatory mentions declared for this country._\n';
  const out = [];
  out.push('| Subject | Text (as issued) | Legal ref | Valid from |');
  out.push('|---|---|---|---|');
  for (const entry of file.invoiceNotes) {
    const v = entry.value;
    out.push(
      `| ${cell(v.subjectCode) || '—'} | ${cell(truncate(v.text, 180))} | ${cell(v.legalRef)} | ${entry.validFrom} |`,
    );
  }
  out.push('');
  return out.join('\n');
}

function renderChannelMandateSection(cc) {
  const file = channelPolicy[cc];
  if (!file) return '_No channel policy declared for this country (as a seller\'s own country)._\n';
  const out = [];
  out.push('| Channel | Requirement | Mandated from | Provenance |');
  out.push('|---|---|---|---|');
  for (const f of file.facts) {
    out.push(
      `| ${transportLabel(f.providerId)} (\`${f.providerId}\`) | ${f.requirement} | ` +
        `${f.mandatedFrom ?? '—'} | ${provenanceCell(f.provenance, 260)} |`,
    );
  }
  out.push('');
  return out.join('\n');
}

function renderBonusSections(cc) {
  const out = [];
  const fields = countryFields[cc];
  if (fields) {
    out.push('## Field overlay (bonus)');
    out.push('');
    out.push('What this country adds/modifies/removes on top of the trunk document shape:');
    out.push('');
    for (const overlay of fields.overlays) {
      for (const op of overlay.operations) {
        if (op.op === 'add') {
          out.push(`- **add** \`${op.field.key}\` on \`${overlay.typeId}${op.path ? `.${op.path}` : ''}\``);
        } else if (op.op === 'modify') {
          out.push(`- **modify** \`${op.key}\` on \`${overlay.typeId}${op.path ? `.${op.path}` : ''}\``);
        } else {
          out.push(`- **remove** \`${op.key}\` from \`${overlay.typeId}${op.path ? `.${op.path}` : ''}\``);
        }
      }
    }
    out.push('');
  }
  const content = contentRequirements[cc];
  if (content) {
    out.push('## Content requirements (bonus)');
    out.push('');
    out.push('| Field | Mandated from | Provenance |');
    out.push('|---|---|---|');
    for (const f of content.facts) {
      out.push(`| ${f.field} | ${f.mandatedFrom} | ${provenanceCell(f.provenance, 220)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

function buildCountryPage(cc, position) {
  const name = countryName(cc);
  const sources = SOURCE_FILE_LABELS.filter(([, data]) => data[cc]).map(
    ([dir]) => `backend/src/modules/documents/${dir}/${cc.toLowerCase()}.json`,
  );
  const lines = [];
  lines.push('---');
  lines.push(`title: "${name} (${cc})"`);
  lines.push(`description: "What ${name} may do, per the compliance engine's own data files."`);
  lines.push(`sidebar_position: ${position}`);
  lines.push(`sidebar_label: "${name}"`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${name} (${cc})`);
  lines.push('');
  lines.push(
    '> Generated from the compliance engine\'s own data files — do not edit by hand. See ' +
      '[Adding a country](../adding-a-country.md) to change what this page says (by changing the ' +
      'data, never this file).',
  );
  lines.push('');
  lines.push('## Document-action policy');
  lines.push('');
  lines.push(renderPolicySection(cc));
  lines.push('## B2G routing');
  lines.push('');
  lines.push('_What happens when a company sends an invoice to a government client of this country._');
  lines.push('');
  lines.push(renderB2gSection(cc));
  lines.push('## Correction routes');
  lines.push('');
  lines.push(renderCorrectionRoutesSection(cc));
  lines.push('## Local cancellation of an issued invoice');
  lines.push('');
  lines.push(renderCancelSection(cc));
  lines.push('');
  lines.push('## Tax system');
  lines.push('');
  lines.push(renderTaxSection(cc));
  lines.push('## Required identifiers');
  lines.push('');
  lines.push(renderIdentifiersSection(cc));
  lines.push('## Mandatory mentions');
  lines.push('');
  lines.push(renderMentionsSection(cc));
  lines.push('## Channel mandate (this country as a seller\'s own country)');
  lines.push('');
  lines.push(renderChannelMandateSection(cc));
  const bonus = renderBonusSections(cc);
  if (bonus.trim()) {
    lines.push(bonus);
  }
  lines.push('---');
  lines.push('');
  lines.push(
    `_Generated from the compliance engine's own data files — do not edit by hand. Sources: ` +
      `${sources.length ? sources.map((s) => `\`${s}\``).join(', ') : '(none found)'}._`,
  );
  lines.push('');
  return lines.join('\n');
}

// =================================================================================================
// WRITE
// =================================================================================================
function main() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(
    join(OUT_DIR, '_category_.json'),
    `${JSON.stringify({ label: 'Country Support', position: 7 }, null, 2)}\n`,
  );

  writeFileSync(join(OUT_DIR, 'index.md'), buildMatrixPage());

  DETAIL_PAGES.forEach((cc, i) => {
    writeFileSync(join(OUT_DIR, `${cc.toLowerCase()}.md`), buildCountryPage(cc, i + 2));
  });

  console.log(
    `generate-country-matrix: wrote index.md + ${DETAIL_PAGES.length} country pages to ` +
      `${OUT_DIR} (${unionCountries.length} countries in the matrix).`,
  );
}

main();
