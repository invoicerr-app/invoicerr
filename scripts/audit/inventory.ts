/**
 * PHASE 0 — MECHANICAL INVENTORY (audit/compliance-truth)
 *
 * Throwaway audit script. NOT part of the build, NOT referenced by tsconfig/nest build.
 * Run:  cd backend && npx tsx ../scripts/audit/inventory.ts
 *
 * It answers one question only: WHAT EXISTS IN THE REPO? No judgement, no legal claim,
 * no web lookup. Every number below is produced either by loading the real runtime
 * registries (profiles, transmission, format) or by reading files off disk.
 *
 * Deliberate design choices:
 *  - Registries are LOADED AND EXECUTED, not regex-scraped. `defaultTransmissionRegistry`
 *    and `defaultFormatRegistry` are the same objects production uses, so provider ids,
 *    channel bindings and `maturity` come from the code, not from a doc.
 *  - Format providers are PROBED: every syntax that a profile actually requests is fed a
 *    deliberately invalid payload (`<garbage/>`) through `provider.validate()`. A provider
 *    that returns `valid: true` for that input performs no effective validation. This is a
 *    fact about the code, not an opinion about the country.
 *  - Spec→country attribution is DERIVED from providerId tokens found in the profiles,
 *    never from a hand-written country list.
 *
 * Outputs (both overwritten on each run):
 *   docs/compliance/audit/inventory.json   raw machine-readable facts
 *   docs/compliance/audit/00-INVENTORY.md  the divergence matrix
 */
import * as fs from 'fs';
import * as path from 'path';

import { ALL_PROFILES, BESPOKE_PROFILES } from '../../backend/src/compliance/profiles/data/all';
import type { CountryComplianceProfile, Temporal } from '../../backend/src/compliance/profiles/schema';
import { defaultTransmissionRegistry } from '../../backend/src/compliance/providers/transmission/registry';
import { NATIONAL_PORTAL_PROVIDERS } from '../../backend/src/compliance/providers/transmission/national-portals';
import { defaultFormatRegistry } from '../../backend/src/compliance/providers/format/registry';
import { NATIONAL_FORMAT_PROVIDERS } from '../../backend/src/compliance/providers/format/national-formats';
import type { DocumentSyntax } from '../../backend/src/compliance/types';
import type { ComplianceLogger } from '../../backend/src/compliance/execution/logger';

const REPO = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(REPO, 'backend');
const COMPLIANCE_SRC = path.join(BACKEND, 'src', 'compliance');
const DOCS_COMPLIANCE = path.join(REPO, 'documentation', 'compliance');
const OUT_DIR = path.join(REPO, 'docs', 'compliance', 'audit');

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

const silentLogger: ComplianceLogger = { todo: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every temporal value, flattened — an audit must see superseded rules too, not just today's. */
function allValues<T>(rules: Temporal<T>[] | undefined): T[] {
  return (rules ?? []).map((r) => r.value);
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. runtime registries
// ─────────────────────────────────────────────────────────────────────────────

const transmissionProviders = defaultTransmissionRegistry.allProviders().map((p) => ({
  id: p.id,
  channel: p.channel as string,
  maturity: (p as { maturity?: string }).maturity ?? null,
  hasPoll: typeof (p as { poll?: unknown }).poll === 'function',
  hasConfigSchema: Boolean((p as { configSchema?: unknown }).configSchema),
}));
const transmissionById = new Map(transmissionProviders.map((p) => [p.id, p]));

/** Providers built by the stub factory in national-portals.ts (zero real transport by construction). */
const nationalPortalIds = new Set(NATIONAL_PORTAL_PROVIDERS.map((p) => p.id));
/** Format providers built by the stub factory in national-formats.ts (emit `new Uint8Array()`). */
const nationalFormatStubIds = new Set(NATIONAL_FORMAT_PROVIDERS.map((p) => p.id));

// ─────────────────────────────────────────────────────────────────────────────
// 2. source-file facts per transmission provider
//    Which file declares this id, how big is it, does it perform any I/O at all?
// ─────────────────────────────────────────────────────────────────────────────

const transmissionFiles = walk(path.join(COMPLIANCE_SRC, 'providers', 'transmission')).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
);

/**
 * Transport detection.
 *
 * A first pass keyed on "does the source mention HttpPort" was useless: EVERY portal mentions one,
 * because the seam is the abstraction. The question that actually matters is narrower and
 * checkable — **with no port injected (which is what the production registry does), can this
 * provider perform any I/O at all?** Three source shapes answer "no":
 *   1. `if (!httpPort) return SKIPPED`            → short-circuits before any call
 *   2. `httpPort ?? { … throw new Error(…) }`     → the fallback port throws
 *   3. `httpPort ?? buildStub() | this.stubHttp`  → the fallback port is an explicit stub
 * Plus the whole generic-portal factory tier, which is shape 1 by construction.
 */
const RE_HTTP_CALL = /\bfetch\s*\(|\baxios\b|\bundici\b|https?\.request\s*\(|\bgot\s*\(|node-fetch/g;
const RE_MAIL_PORT = /InvoiceMailPort|nodemailer/;
const RE_NO_PORT_SHORT_CIRCUIT = /if\s*\(\s*!\s*(this\.)?httpPort\s*\)/;
const RE_THROWING_DEFAULT_PORT = /httpPort\s*\?\?\s*\{[\s\S]{0,800}?throw new Error/;
const RE_STUB_DEFAULT_PORT = /httpPort\s*\?\?\s*(this\.stubHttp|buildStub\(\)|new\s+\w*Stub)/;
/** A module-level stub port constant, hardcoded at the call site (no injection seam at all). */
const RE_HARDCODED_STUB_PORT = /(?:const|let)\s+(?:STUB_HTTP|STUB_PORT|stubHttp)\b[\s\S]{0,900}?throw new Error/;

/**
 * A provider class rarely holds its own transport: `ksef-transmission.ts` declares the id, hands
 * off to `./ksef/ksef-client.ts`, which hands off again to `./ksef/fetch-http-client.ts`. Looking
 * only at the declaring file would report "no I/O" for a provider that plainly has some. So we
 * follow relative imports two hops and treat the union as the provider's source neighbourhood —
 * deep enough to reach the low-level client, shallow enough not to drag in the whole module graph.
 */
function resolveRelImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

/**
 * file → provider ids it declares. Needed because `national-portals.ts` is an aggregator: it both
 * declares stub ids of its own (zatca…) AND imports every dedicated provider class. Expanding its
 * imports blindly credited `zatca` with ChorusPro's network calls. Expansion therefore stops at any
 * file that declares a DIFFERENT provider — a provider never borrows another provider's transport.
 */
const declaredIdsByFile = new Map<string, Set<string>>();
for (const f of transmissionFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const ids = new Set<string>();
  for (const p of defaultTransmissionRegistry.allProviders()) {
    if (new RegExp(`\\bid\\s*[:=]\\s*['"\`]${p.id}['"\`]`).test(src)) ids.add(p.id);
  }
  declaredIdsByFile.set(f, ids);
}

function sourceFactsFor(id: string) {
  // A provider "declares" an id when a non-spec file assigns it: id = 'x' | id: 'x'.
  const declaring = transmissionFiles.filter((f) => declaredIdsByFile.get(f)!.has(id));

  // Two hops: transmission-provider → client → low-level http client. Stopping at one hop
  // reported "no I/O" for providers whose fetch lives one file deeper (ksef/fetch-http-client.ts).
  const neighbourhood = new Set(declaring);
  let frontier = declaring;
  for (let hop = 0; hop < 2; hop++) {
    const next: string[] = [];
    for (const f of frontier) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'/g)) {
        const target = resolveRelImport(f, m[1] ?? m[2]);
        if (!target || target.endsWith('.spec.ts') || neighbourhood.has(target)) continue;
        const declaresOther = [...(declaredIdsByFile.get(target) ?? [])].some((other) => other !== id);
        if (declaresOther) continue;
        neighbourhood.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }

  let loc = 0;
  let httpCallSites = 0;
  let mailPort = false;
  let throwingDefaultPort = false;
  let stubDefaultPort = false;
  let noPortShortCircuit = false;
  let hardcodedStubPort = false;
  for (const f of neighbourhood) {
    const src = fs.readFileSync(f, 'utf8');
    loc += src.split('\n').length;
    httpCallSites += (src.match(RE_HTTP_CALL) ?? []).length;
    if (RE_MAIL_PORT.test(src)) mailPort = true;
    if (RE_THROWING_DEFAULT_PORT.test(src)) throwingDefaultPort = true;
    if (RE_STUB_DEFAULT_PORT.test(src)) stubDefaultPort = true;
    if (RE_NO_PORT_SHORT_CIRCUIT.test(src)) noPortShortCircuit = true;
    if (RE_HARDCODED_STUB_PORT.test(src)) hardcodedStubPort = true;
  }
  // Two distinct stub tiers, told apart by WHICH FILE declares the id — not by membership of
  // NATIONAL_PORTAL_PROVIDERS, which also contains the dedicated per-authority classes:
  //   *smaller-portals.ts → buildGenericPortalProvider(): returns SKIPPED unless a port is injected
  //   national-portals.ts → nationalPortal(): a pure log.todo note, no I/O code path at all
  const genericPortalStubFactory = declaring.some((f) => /smaller-portals\.ts$/.test(f));
  const logTodoStubFactory = declaring.some((f) => /\/national-portals\.ts$/.test(f));
  return {
    declaredIn: declaring.map((f) => path.relative(REPO, f)),
    neighbourhood: [...neighbourhood].map((f) => path.relative(REPO, f)),
    loc,
    httpCallSites,
    mailPort,
    throwingDefaultPort,
    stubDefaultPort,
    noPortShortCircuit,
    hardcodedStubPort,
    genericPortalStubFactory,
    logTodoStubFactory,
    /**
     * The load-bearing fact. The production registry constructs every provider with credentials
     * only — never an httpPort (registry.ts:70-88). So a provider with zero HTTP call sites
     * anywhere in its two-hop source neighbourhood cannot put a byte on the wire as wired.
     */
    noDefaultTransport: httpCallSites === 0 && !mailPort,
  };
}

const providerSource = new Map(transmissionProviders.map((p) => [p.id, sourceFactsFor(p.id)]));

// ─────────────────────────────────────────────────────────────────────────────
// 3. spec inventory — mocked vs live, and which live flag / creds each live spec needs
// ─────────────────────────────────────────────────────────────────────────────

const allSpecs = walk(COMPLIANCE_SRC).filter((f) => f.endsWith('.spec.ts'));
const LIVE_NAME = /(-live|\.live)\.spec\.ts$/;

interface SpecFact {
  file: string;
  live: boolean;
  flags: string[];
  requiredEnv: string[];
}

const specs: SpecFact[] = allSpecs.map((f) => {
  const src = fs.readFileSync(f, 'utf8');
  const flags = uniq(Array.from(src.matchAll(/liveDescribe\(\s*'([A-Z0-9_]+)'/g)).map((m) => m[1]));
  // Credential list is the array literal that follows the flag in the same call.
  const requiredEnv = uniq(
    Array.from(src.matchAll(/liveDescribe\(\s*'[A-Z0-9_]+'\s*,\s*\[([^\]]*)\]/g))
      .flatMap((m) => m[1].split(','))
      .map((s) => s.trim().replace(/['"`]/g, ''))
      .filter(Boolean),
  );
  return { file: path.relative(REPO, f), live: LIVE_NAME.test(f) || flags.length > 0, flags, requiredEnv };
});

/** The parametrized harness that loops over every national portal (coverage ≠ execution). */
const genericPortalHarness = 'backend/src/compliance/providers/transmission/portal-live.spec.ts';
const hasGenericHarness = specs.some((s) => s.file === genericPortalHarness);

// ─────────────────────────────────────────────────────────────────────────────
// 4. documentation pages + the routes the Docusaurus plugin generates
//    (plugin rule, read from documentation/plugins/compliance-content-plugin.ts:
//     any documentation/compliance/*.md matching /^([A-Z]{2})-/ → /compliance/<cc>)
// ─────────────────────────────────────────────────────────────────────────────

interface DocFact {
  code: string;
  file: string;
  name: string;
  lines: number;
  status: string | null;
  priority: string | null;
  progress: string | null;
  formats: string[];
  scope: string[];
  route: string;
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (out[listKey] as string[]).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2].trim() === '') {
      listKey = kv[1];
      out[listKey] = [];
    } else {
      listKey = null;
      out[kv[1]] = kv[2].trim();
    }
  }
  return out;
}

const docs: DocFact[] = fs
  .readdirSync(DOCS_COMPLIANCE)
  .filter((f) => f.endsWith('.md') && /^[A-Z]{2}-/.test(f))
  .map((f) => {
    const raw = fs.readFileSync(path.join(DOCS_COMPLIANCE, f), 'utf8');
    const fm = parseFrontmatter(raw);
    const code = f.slice(0, 2);
    return {
      code,
      file: `documentation/compliance/${f}`,
      name: f.replace(/^[A-Z]{2}-/, '').replace(/\.md$/, ''),
      lines: raw.split('\n').length,
      status: (fm.status as string) ?? null,
      priority: (fm.priority as string) ?? null,
      progress: (fm.progress as string) ?? null,
      formats: (fm.formats as string[]) ?? [],
      scope: (fm.scope as string[]) ?? [],
      route: `/compliance/${code.toLowerCase()}`,
    };
  });
const docByCode = new Map(docs.map((d) => [d.code, d]));

// ─────────────────────────────────────────────────────────────────────────────
// 5. vendored schemas on disk
// ─────────────────────────────────────────────────────────────────────────────

const schemaFiles = walk(path.join(COMPLIANCE_SRC, 'schemas'))
  .filter((f) => /\.(xsd|sch)$/.test(f))
  .map((f) => path.relative(path.join(COMPLIANCE_SRC, 'schemas'), f));

// ─────────────────────────────────────────────────────────────────────────────
// 6. format-provider probe — does validate() reject an obviously invalid payload?
// ─────────────────────────────────────────────────────────────────────────────

interface FormatProbe {
  syntax: string;
  providerId: string | null;
  stubByConstruction: boolean;
  /**
   * `<garbage/>` — well-formed XML that is not an invoice in any syntax.
   * CAVEAT, stated so the number is not over-read: Schematron rules only fire inside their
   * `context` pattern, so a document matching no context trivially raises zero assertions and
   * comes back valid. A `true` here therefore proves only that NO STRUCTURAL GATE (an XSD, a
   * root-element check) stands in front of the ruleset — not that the ruleset is empty.
   */
  garbageAccepted: boolean | null;
  garbageErrors: number | null;
  /**
   * Zero bytes — exactly what the `national-formats.ts` stub builders emit (`new Uint8Array()`).
   * This probe has no Schematron caveat: an empty document is invalid under every syntax on
   * earth, so `true` means the pipeline will carry an empty artifact through to signing,
   * archival and transmission without a single component objecting.
   */
  emptyAccepted: boolean | null;
  emptyErrors: number | null;
  warnings: string[];
  threw: string | null;
}

const GARBAGE = new TextEncoder().encode('<garbage/>');
const EMPTY = new Uint8Array();

async function probeSyntax(syntax: string): Promise<FormatProbe> {
  const provider = defaultFormatRegistry.resolve(syntax as DocumentSyntax);
  const base: FormatProbe = {
    syntax,
    providerId: provider?.id ?? null,
    stubByConstruction: provider ? nationalFormatStubIds.has(provider.id) : false,
    garbageAccepted: null,
    garbageErrors: null,
    emptyAccepted: null,
    emptyErrors: null,
    warnings: [],
    threw: null,
  };
  if (!provider) return base;
  const run = (bytes: Uint8Array) =>
    provider.validate(
      { role: 'AUTHORITATIVE', syntax: syntax as DocumentSyntax, mime: 'application/xml', bytes },
      silentLogger,
    );
  try {
    const garbage = await run(GARBAGE);
    base.garbageAccepted = garbage.valid === true;
    base.garbageErrors = garbage.errors?.length ?? 0;
    base.warnings = (garbage.warnings ?? []).slice(0, 3);
  } catch (e) {
    base.threw = e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
  }
  try {
    const empty = await run(EMPTY);
    base.emptyAccepted = empty.valid === true;
    base.emptyErrors = empty.errors?.length ?? 0;
  } catch (e) {
    base.threw = base.threw ?? (e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. per-country assembly
// ─────────────────────────────────────────────────────────────────────────────

const bespokeCodes = new Set(BESPOKE_PROFILES.map((p) => p.countryCode));

/** Bespoke profiles override archetype-built duplicates (all.ts orders them last). */
const profileByCode = new Map<string, CountryComplianceProfile>();
for (const p of ALL_PROFILES) profileByCode.set(p.countryCode, p);

/**
 * providerId → countries reaching it, resolved the way production resolves: an explicit
 * providerId wins, otherwise the ChannelType picks its first-registered provider. Counting only
 * explicit providerIds wrongly reported `email`/`peppol`/`pdp`/`sdi` as referenced by nobody.
 */
const providerToCountries = new Map<string, string[]>();
for (const p of profileByCode.values()) {
  for (const rule of allValues(p.transmission)) {
    for (const ch of rule.channels ?? []) {
      const resolved = defaultTransmissionRegistry.resolve(ch);
      const key = resolved?.id ?? ch.providerId;
      if (!key) continue;
      providerToCountries.set(key, uniq([...(providerToCountries.get(key) ?? []), p.countryCode]));
    }
  }
}

/** Spec files attributable to a provider id (token match on the path). */
function specsForProvider(id: string): SpecFact[] {
  const token = id.replace(/[^a-z0-9-]/g, '');
  return specs.filter((s) => {
    const base = s.file.toLowerCase();
    return base.includes(`/${token}/`) || base.includes(`/${token}-`) || base.includes(`/${token}.`);
  });
}

async function buildCountry(code: string) {
  const profile = profileByCode.get(code);
  const doc = docByCode.get(code);

  const channels = profile
    ? uniq(
        allValues(profile.transmission).flatMap((r) =>
          (r.channels ?? []).map((c) => `${c.type}${c.providerId ? `:${c.providerId}` : ''}`),
        ),
      )
    : [];

  // Resolve through the SAME code path production uses: an explicit providerId wins, otherwise the
  // ChannelType falls back to its first-registered provider (PEPPOL → peppol, EMAIL → email…).
  // Reading only explicit providerIds would have reported "no provider" for every Peppol country.
  const channelSpecs = profile
    ? allValues(profile.transmission).flatMap((r) => r.channels ?? [])
    : [];
  const resolvedByChannel = uniq(
    channelSpecs.map((spec) => {
      const resolved = defaultTransmissionRegistry.resolve(spec);
      return JSON.stringify({
        type: spec.type,
        declared: spec.providerId ?? null,
        id: resolved?.id ?? null,
      });
    }),
  ).map((j) => JSON.parse(j) as { type: string; declared: string | null; id: string | null });

  const resolvedProviders = resolvedByChannel.map((entry) => {
    const id = entry.id;
    if (!id) {
      return {
        id: entry.declared ?? `(${entry.type} sans providerId)`,
        channelType: entry.type,
        registered: false,
        resolvesToNothing: true,
        channel: null,
        maturity: null,
        stubFactory: false,
        noDefaultTransport: true,
        httpCallSites: 0,
        sourceLoc: 0,
        declaredIn: [] as string[],
        mockedSpecs: [] as string[],
        liveSpecs: [] as string[],
      };
    }
    const p = transmissionById.get(id);
    const src = providerSource.get(id);
    const own = specsForProvider(id);
    return {
      id,
      channelType: entry.type,
      resolvesToNothing: false,
      registered: Boolean(p),
      channel: p?.channel ?? null,
      maturity: p?.maturity ?? null,
      stubFactory: nationalPortalIds.has(id),
      noDefaultTransport: src?.noDefaultTransport ?? false,
      httpCallSites: src?.httpCallSites ?? 0,
      sourceLoc: src?.loc ?? 0,
      declaredIn: src?.declaredIn ?? [],
      mockedSpecs: own.filter((s) => !s.live).map((s) => s.file),
      liveSpecs: own.filter((s) => s.live).map((s) => s.file),
    };
  });

  const syntaxes = profile
    ? uniq(
        allValues(profile.formats).flatMap((r) =>
          [r.primary?.syntax, r.human?.syntax].filter((x): x is DocumentSyntax => Boolean(x)),
        ),
      )
    : [];
  // The LEGALLY REQUIRED artifact, separate from the human companion. Scoring a country's format
  // capability on the merged list would credit Brazil's stub NFE with the plain-PDF human copy.
  const primarySyntaxes = profile
    ? uniq(
        allValues(profile.formats)
          .map((r) => r.primary?.syntax)
          .filter((x): x is DocumentSyntax => Boolean(x)),
      )
    : [];

  const formatProbes: (FormatProbe & { primary: boolean })[] = [];
  for (const s of syntaxes) formatProbes.push({ ...(await probeSyntax(s)), primary: primarySyntaxes.includes(s) });

  const lifecycles = profile ? allValues(profile.lifecycle) : [];
  const archivals = profile ? allValues(profile.archival) : [];
  const numberings = profile ? allValues(profile.numbering) : [];

  return {
    code,
    name: profile?.displayName ?? doc?.name ?? null,
    profile: profile
      ? {
          present: true,
          bespoke: bespokeCodes.has(code),
          confidence: profile.confidence,
          delegatesTo: profile.delegatesTo ?? null,
          schemaVersion: profile.schemaVersion,
          regimeModels: uniq(allValues(profile.regime).map((r) => r.model)),
          regimeBlocking: allValues(profile.regime).some((r) => r.blocking),
          temporalCounts: {
            regime: profile.regime.length,
            formats: profile.formats.length,
            transmission: profile.transmission.length,
            lifecycle: profile.lifecycle.length,
            archival: profile.archival.length,
            reporting: profile.reporting.length,
            numbering: profile.numbering.length,
          },
          syntaxes,
          primarySyntaxes,
          mandatoryReceiveSyntax: profile.mandatoryReceiveSyntax ?? null,
          channels,
          immutableAfter: uniq(lifecycles.map((l) => l.immutableAfter)),
          correctionModels: uniq(lifecycles.map((l) => l.correctionModel)),
          cancellationAllowed: lifecycles.some((l) => l.cancellation?.allowed),
          responsePolicyDefined: lifecycles.some((l) => Boolean(l.response)),
          contingencyDefined: lifecycles.some((l) => Boolean(l.contingency)),
          archival: uniq(
            archivals.map((a) => `${a.retentionYears}y/${a.archivedForm}/${a.integrity}${a.residency ? `/${a.residency}` : ''}`),
          ),
          reportingKinds: uniq(allValues(profile.reporting).flatMap((r) => r.kinds)),
          numbering: uniq(numberings.map((n) => `${n.model}${n.hashChain ? '+hashChain' : ''}`)),
          requiredIdentifiers: profile.requiredIdentifiers?.map((i) => i.scheme) ?? [],
          taxSystem: profile.taxSystem.kind,
        }
      : { present: false },
    doc: doc ?? null,
    route: doc?.route ?? null,
    providers: resolvedProviders,
    formats: formatProbes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. run + render
// ─────────────────────────────────────────────────────────────────────────────

type Country = Awaited<ReturnType<typeof buildCountry>>;
type SourceFacts = ReturnType<typeof sourceFactsFor>;

/** Names the exact source shape that decides whether an un-injected provider can emit anything. */
function transportLabel(s: SourceFacts): string {
  if (s.httpCallSites > 0) return `réseau (${s.httpCallSites} sites d'appel)`;
  if (s.mailPort) return 'SMTP (port courriel)';
  if (s.logTodoStubFactory) return 'aucun — fabrique `log.todo`';
  if (s.genericPortalStubFactory) return 'aucun — fabrique générique, `SKIPPED`';
  if (s.hardcodedStubPort) return 'aucun — port stub **codé en dur**';
  if (s.throwingDefaultPort) return 'aucun — port par défaut `throw`';
  if (s.stubDefaultPort) return 'aucun — port par défaut = stub';
  if (s.noPortShortCircuit) return 'aucun — court-circuit `SKIPPED`';
  return 'aucun — aucun site d\'appel réseau';
}

function md(countries: Country[], generatedAt: string): string {
  const L: string[] = [];
  const P = (s = '') => L.push(s);

  const withProfile = countries.filter((c) => c.profile.present);
  const withDoc = countries.filter((c) => c.doc);

  P('# 00 — Inventaire mécanique (Phase 0)');
  P();
  P(`> Généré par \`scripts/audit/inventory.ts\` le ${generatedAt}. **Aucun jugement, aucune`);
  P('> vérification juridique, aucune recherche web.** Uniquement ce qui existe dans le dépôt,');
  P('> obtenu en chargeant les registres réels et en lisant les fichiers.');
  P('>');
  P("> Toute colonne de ce document est une *observation*, pas une *conformité*. Un pays présent");
  P('> partout dans ce tableau peut être entièrement non conforme : ce fichier ne le dit pas.');
  P();

  P('## 1. Volumétrie');
  P();
  P('| Objet | Compte | Source |');
  P('| --- | ---: | --- |');
  P(`| Profils pays chargés (\`ALL_PROFILES\`) | ${withProfile.length} | runtime |`);
  P(`| dont profils bespoke | ${withProfile.filter((c) => c.profile.bespoke).length} | \`BESPOKE_PROFILES\` |`);
  P(`| Fiches pays publiées (\`documentation/compliance/*.md\`) | ${withDoc.length} | disque |`);
  P(`| Routes publiques générées (\`/compliance/<cc>\`) | ${withDoc.length} | plugin Docusaurus |`);
  P(`| Providers de transmission enregistrés | ${transmissionProviders.length} | runtime |`);
  P(`| dont produits par la fabrique stub \`national-portals.ts\` | ${nationalPortalIds.size} | runtime |`);
  P(`| Providers de format produits par \`national-formats.ts\` (bytes vides) | ${nationalFormatStubIds.size} | runtime |`);
  P(`| Schémas vendorisés sur disque (.xsd/.sch) | ${schemaFiles.length} | disque |`);
  P(`| Specs sous \`src/compliance\` | ${specs.length} | disque |`);
  P(`| dont specs live (nom \`-live.spec.ts\` ou usage \`liveDescribe\`) | ${specs.filter((s) => s.live).length} | disque |`);
  P();

  P('### Maturités déclarées');
  P();
  const byMat = new Map<string, string[]>();
  for (const p of transmissionProviders) {
    const k = p.maturity ?? '(aucune)';
    byMat.set(k, [...(byMat.get(k) ?? []), p.id]);
  }
  P('| Maturité | Nb | Providers |');
  P('| --- | ---: | --- |');
  for (const [k, v] of [...byMat.entries()].sort()) P(`| \`${k}\` | ${v.length} | ${v.sort().join(', ')} |`);
  P();

  P('### Specs live existantes et ce qu’elles exigent');
  P();
  P('| Spec | Flag | Variables d’env requises |');
  P('| --- | --- | --- |');
  for (const s of specs.filter((x) => x.live).sort((a, b) => a.file.localeCompare(b.file))) {
    P(`| \`${s.file}\` | ${s.flags.map((f) => `\`${f}\``).join(', ') || '—'} | ${s.requiredEnv.map((e) => `\`${e}\``).join(', ') || '(aucune)'} |`);
  }
  P();
  P(
    `Harnais paramétré générique sur tous les portails nationaux : ${hasGenericHarness ? `présent (\`${genericPortalHarness}\`)` : 'absent'}.`,
  );
  P();
  P(
    '> Fait mécanique : le dépôt ne contient **aucune trace machine-lisible d’une exécution live réussie** ' +
      '(pas de fichier de résultat, pas d’horodatage de dernier run, pas d’artefact de réponse d’autorité versionné). ' +
      'Les dates de « dernier run » n’existent que dans de la prose. Rien ici ne les confirme ni ne les infirme.',
  );
  P();

  // ── Matrice principale ────────────────────────────────────────────────────
  P('## 2. Matrice pays × capacités');
  P();
  P('Légende — `providers` : `id(maturité)`, `⊘` = aucun transport atteignable tel que câblé');
  P('(zéro site d’appel réseau dans le voisinage source, port jamais injecté par le registre).');
  P('`fmt` : `SYNTAXE→provider`, `∅` = builder à bytes vides, `!` = `validate()` accepte un document vide.');
  P();
  P('| Pays | Profil | Conf. | Régime | Fiche | status/progress | Canaux | Providers | Formats | Specs live |');
  P('| --- | :-: | --- | --- | :-: | --- | --- | --- | --- | --- |');
  for (const c of countries.sort((a, b) => a.code.localeCompare(b.code))) {
    const prof = c.profile.present ? (c.profile.bespoke ? 'bespoke' : 'archétype') : '—';
    const conf = c.profile.present ? c.profile.confidence : '—';
    const regime = c.profile.present ? c.profile.regimeModels.join('/') : '—';
    const fiche = c.doc ? '✓' : '—';
    const st = c.doc ? `${c.doc.status ?? '—'}/${c.doc.progress ?? '—'}` : '—';
    const chans = c.profile.present ? c.profile.channels.join('<br>') || '—' : '—';
    const provs =
      c.providers.length === 0
        ? '—'
        : c.providers
            .map((p) => `${p.id}(${p.maturity ?? '?'})${p.noDefaultTransport ? '⊘' : ''}`)
            .join('<br>');
    const fmts =
      c.formats.length === 0
        ? '—'
        : c.formats
            .map((f) => `${f.syntax}→${f.providerId ?? 'AUCUN'}${f.stubByConstruction ? '∅' : ''}${f.emptyAccepted ? '!' : ''}`)
            .join('<br>');
    const live = c.providers.flatMap((p) => p.liveSpecs).length;
    P(
      `| **${c.code}** ${c.name ?? ''} | ${prof} | ${conf} | ${regime} | ${fiche} | ${st} | ${chans} | ${provs} | ${fmts} | ${live || '0'} |`,
    );
  }
  P();

  // ── Les 4 catégories demandées ────────────────────────────────────────────
  P('## 3. Matrice de divergence');
  P();

  // Catégorie 1
  const cat1 = withDoc.filter((c) => {
    const real = c.providers.filter((p) => p.registered && !p.noDefaultTransport);
    return real.length === 0;
  });
  P(`### Catégorie 1a — Fiche publique **sans aucun** transport atteignable (${cat1.length})`);
  P();
  P('Critère mécanique : une page `/compliance/<cc>` est générée, mais aucun `ChannelSpec` du profil');
  P('ne résout — via `defaultTransmissionRegistry.resolve()`, la logique de production — vers un');
  P('provider disposant d’un site d’appel réseau. Pour ces pays, `transmit()` ne peut structurellement');
  P('rien émettre : le résultat est `SKIPPED` ou une exception interne.');
  P();
  P('| Pays | Route publique | status fiche | Régime déclaré | Canaux du profil | Providers résolus |');
  P('| --- | --- | --- | --- | --- | --- |');
  for (const c of cat1.sort((a, b) => a.code.localeCompare(b.code))) {
    P(
      `| ${c.code} ${c.name ?? ''} | \`${c.route}\` | ${c.doc?.status ?? '—'} | ${c.profile.present ? c.profile.regimeModels.join('/') : '—'} | ${c.profile.present ? c.profile.channels.join(', ') || '—' : 'PAS DE PROFIL'} | ${c.providers.map((p) => `${p.id}(${p.maturity ?? '?'})⊘`).join(', ') || '**aucun**'} |`,
    );
  }
  P();

  // Catégorie 1b — the sharper divergence: the profile's OWN declared regime demands an authority
  // channel, and the only thing that can actually leave the process is a buyer e-mail.
  const AUTHORITY_CHANNELS = new Set(['GOV_PORTAL_API', 'SDI', 'PDP', 'PEPPOL']);
  const cat1b = countries.filter((c) => {
    if (!c.profile.present) return false;
    const needsAuthority = c.profile.regimeModels.some((m) =>
      ['CLEARANCE', 'REAL_TIME_REPORTING', 'DECENTRALIZED_CTC'].includes(m),
    );
    if (!needsAuthority) return false;
    const reachable = c.providers.filter((p) => p.registered && !p.noDefaultTransport);
    if (reachable.length === 0) return false; // already in 1a
    return !reachable.some((p) => AUTHORITY_CHANNELS.has(p.channelType));
  });
  P(
    `### Catégorie 1b — Régime **déclaré par le profil lui-même** comme clearance/temps réel, mais seul un courriel peut sortir (${cat1b.length})`,
  );
  P();
  P('Ce n’est pas une affirmation juridique : c’est une contradiction interne aux données du dépôt.');
  P('Le profil déclare `CLEARANCE` / `REAL_TIME_REPORTING` / `DECENTRALIZED_CTC` — donc, selon ses');
  P('propres données, un canal autorité est requis — et le seul provider joignable est `email`.');
  P();
  P('| Pays | Régime déclaré | Bloquant | Canaux déclarés | Seul transport atteignable |');
  P('| --- | --- | :-: | --- | --- |');
  for (const c of cat1b.sort((a, b) => a.code.localeCompare(b.code))) {
    P(
      `| ${c.code} ${c.name ?? ''} | ${c.profile.regimeModels.join('/')} | ${c.profile.regimeBlocking ? '✓' : ''} | ${c.profile.channels.join(', ')} | ${c.providers.filter((p) => !p.noDefaultTransport).map((p) => p.id).join(', ')} |`,
    );
  }
  P();

  // Catégorie 2
  const cat2 = countries.filter((c) => {
    const hasProv = c.providers.some((p) => p.registered);
    if (!hasProv) return false;
    return c.formats.some(
      (f) => f.providerId === null || f.stubByConstruction || f.emptyAccepted === true,
    );
  });
  const allProbes = new Map<string, (typeof countries)[number]['formats'][number]>();
  for (const c of countries) for (const f of c.formats) if (!allProbes.has(f.syntax)) allProbes.set(f.syntax, f);
  const probes = [...allProbes.values()].sort((a, b) => a.syntax.localeCompare(b.syntax));
  P(`### Catégorie 2 — Provider présent **sans** schéma ni validation de format effective (${cat2.length})`);
  P();
  P('Critère mécanique : le pays a au moins un provider de transmission enregistré, mais au moins');
  P("une de ses syntaxes n'a aucun provider de format, ou est servie par un builder à bytes vides,");
  P("ou son `validate()` déclare `valid: true` sur l'entrée `<garbage/>`.");
  P();
  P('Plutôt que de répéter la même ligne pour chaque pays partageant une syntaxe, voici la sonde');
  P(`par **syntaxe** (${probes.length} syntaxes distinctes réellement demandées par les profils), puis la liste`);
  P('des pays concernés.');
  P();
  P('| Syntaxe | Provider | Builder à bytes vides | `<garbage/>` rejeté | **Document vide rejeté** | Pays |');
  P('| --- | --- | :-: | :-: | :-: | --- |');
  for (const f of probes) {
    const users = countries.filter((c) => c.formats.some((x) => x.syntax === f.syntax)).map((c) => c.code);
    P(
      `| \`${f.syntax}\` | ${f.providerId ?? '**aucun**'} | ${f.stubByConstruction ? '✓' : ''} | ${f.garbageAccepted === false ? '✓' : '**non**'} | ${f.emptyAccepted === false ? '✓' : '**non**'} | ${users.length > 8 ? `${users.slice(0, 8).join(', ')} … (${users.length})` : users.join(', ')} |`,
    );
  }
  P();
  const emptyOk = probes.filter((f) => f.emptyAccepted !== false).length;
  const garbageOk = probes.filter((f) => f.garbageAccepted !== false).length;
  P(
    `**${emptyOk} syntaxes sur ${probes.length} déclarent \`valid: true\` pour un document de zéro octet**, ` +
      `et ${garbageOk} sur ${probes.length} pour \`<garbage/>\`.`,
  );
  P();
  P(
    'Le second chiffre doit être lu avec la réserve Schematron rappelée plus haut (une règle qui ne ' +
      "trouve pas son contexte ne lève rien). Le premier n'a aucune réserve : `providers.ts:145` " +
      "court-circuite explicitement — `if (!rendered.bytes.length) return okValidation(…'stub path')` — " +
      "et les 42 providers de `national-formats.ts` renvoient `{ valid: true, warnings: ['… (stub)'] }` " +
      'quoi qu’on leur passe. Un artefact vide traverse donc build → validate sans objection. ' +
      'Le comportement en aval (signature, archivage, transmission) est un point de la phase 1, pas d’ici.',
  );
  P();
  P(`Pays concernés par au moins une syntaxe non validée : ${cat2.length}.`);
  P();

  // Catégorie 3
  const cat3providers = transmissionProviders
    .map((p) => ({ ...p, own: specsForProvider(p.id), src: providerSource.get(p.id)! }))
    .filter((p) => p.own.filter((s) => s.live).length === 0);
  P(`### Catégorie 3 — Provider **sans aucune** spec live dédiée, jamais (${cat3providers.length} / ${transmissionProviders.length})`);
  P();
  P('Critère mécanique : aucun fichier `*-live.spec.ts` / `*.live.spec.ts` n’est attribuable à cet id.');
  P(
    `Le harnais paramétré \`portal-live.spec.ts\` boucle sur les ${NATIONAL_PORTAL_PROVIDERS.length} portails nationaux, ` +
      "mais cela prouve l'existence d'un point d'entrée de test, pas qu'il ait jamais été exécuté ni qu'il puisse l'être.",
  );
  P();
  P('| Provider | Canal | Maturité | Fabrique | LOC voisinage | Transport tel que câblé | Pays référençants |');
  P('| --- | --- | --- | :-: | ---: | --- | --- |');
  for (const p of cat3providers.sort((a, b) => (a.maturity ?? '').localeCompare(b.maturity ?? '') || a.id.localeCompare(b.id))) {
    P(
      `| \`${p.id}\` | ${p.channel} | ${p.maturity ?? '**aucune**'} | ${p.src.logTodoStubFactory ? '`log.todo`' : p.src.genericPortalStubFactory ? 'générique' : 'dédiée'} | ${p.src.loc} | ${transportLabel(p.src)} | ${(providerToCountries.get(p.id) ?? []).join(', ') || '—'} |`,
    );
  }
  P();

  // Catégorie 4
  P('### Catégorie 4 — Maturité déclarée que rien dans le dépôt ne justifie');
  P();
  P('`provider-maturity.spec.ts` assied ses trois classes sur `COMPLIANCE_AUDIT.md` et des notes');
  P("de handoff — c'est-à-dire sur de la prose, pas sur une preuve d'exécution. Le tableau ci-dessous");
  P('confronte la maturité déclarée aux seuls faits vérifiables mécaniquement.');
  P();
  P('| Provider | Maturité déclarée | Spec live dédiée | Transport tel que câblé | Sites d’appel réseau | Écart mécanique |');
  P('| --- | --- | :-: | --- | ---: | --- |');
  for (const p of transmissionProviders.sort((a, b) => a.id.localeCompare(b.id))) {
    const own = specsForProvider(p.id);
    const live = own.filter((s) => s.live).length > 0;
    const src = providerSource.get(p.id)!;
    let gap = '';
    const gaps: string[] = [];
    if (p.maturity === 'PROVEN' && !live) gaps.push('PROVEN sans spec live dédiée');
    if (p.maturity === 'IMPLEMENTED' && src.noDefaultTransport)
      gaps.push('IMPLEMENTED alors que le transport par défaut ne peut rien émettre');
    if (p.maturity === 'IMPLEMENTED' && !live) gaps.push('IMPLEMENTED sans spec live dédiée');
    if (!p.maturity) gaps.push('aucune maturité déclarée');
    gap = gaps.join(' ; ');
    if (!gap) continue;
    P(`| \`${p.id}\` | ${p.maturity ?? '—'} | ${live ? '✓' : '✗'} | ${transportLabel(src)} | ${src.httpCallSites} | ${gap} |`);
  }
  P();

  // ── Divergences transverses ───────────────────────────────────────────────
  P('## 4. Divergences transverses');
  P();
  const docNoProfile = docs.filter((d) => !profileByCode.has(d.code)).map((d) => d.code);
  const profileNoDoc = [...profileByCode.keys()].filter((c) => !docByCode.has(c));
  const orphanProviders = transmissionProviders
    .filter((p) => (providerToCountries.get(p.id) ?? []).length === 0)
    .map((p) => p.id);
  P(`- Fiche publique **sans** profil moteur (${docNoProfile.length}) : ${docNoProfile.join(', ') || '—'}`);
  P(`- Profil moteur **sans** fiche publique (${profileNoDoc.length}) : ${profileNoDoc.join(', ') || '—'}`);
  P(
    `- Providers enregistrés qu'**aucun profil n'atteint** (${orphanProviders.length}) : ${orphanProviders.join(', ') || '—'}`,
  );
  P(
    "  (résolution faite via `defaultTransmissionRegistry.resolve()` : un provider n'est \"atteint\" " +
      "que s'il gagne réellement la résolution d'un `ChannelSpec` d'un profil.)",
  );
  P();
  P('### Schémas vendorisés');
  P();
  P('| Répertoire | Fichiers |');
  P('| --- | --- |');
  const byDir = new Map<string, string[]>();
  for (const f of schemaFiles) {
    const d = path.dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), path.basename(f)]);
  }
  for (const [d, fl] of [...byDir.entries()].sort()) P(`| \`${d}\` | ${fl.sort().join(', ')} |`);
  P();
  P(
    `Les ${schemaFiles.length} schémas couvrent ${byDir.size} espaces. Toutes les autres syntaxes déclarées ` +
      'dans les profils n’ont aucun schéma vendorisé — voir catégorie 2.',
  );
  P();

  P('## 5. Ce que ce document ne dit pas');
  P();
  P('- Il ne dit pas si une règle légale est correcte : aucune source primaire n’a été consultée (phase 2).');
  P("- Il ne dit pas si un sandbox existe pour un portail donné (phase 3).");
  P('- Il ne dit pas si une fiche publique surpromet : la comparaison prose ↔ preuve est la phase 1.7 / le livrable `01-CLAIM-AUDIT.md`.');
  P("- La présence d'un provider `IMPLEMENTED` avec de l'I/O dans la source ne prouve pas que l'API distante existe, ni que le protocole est le bon.");
  P();
  return L.join('\n');
}

async function main() {
  const codes = uniq([...profileByCode.keys(), ...docs.map((d) => d.code)]).sort();
  const countries: Country[] = [];
  for (const c of codes) countries.push(await buildCountry(c));

  const generatedAt = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'inventory.json'),
    `${JSON.stringify(
      {
        generated_at: generatedAt,
        generator: 'scripts/audit/inventory.ts',
        totals: {
          profiles: profileByCode.size,
          docs: docs.length,
          transmissionProviders: transmissionProviders.length,
          nationalPortalStubs: nationalPortalIds.size,
          nationalFormatStubs: nationalFormatStubIds.size,
          schemaFiles: schemaFiles.length,
          specs: specs.length,
          liveSpecs: specs.filter((s) => s.live).length,
        },
        transmissionProviders: transmissionProviders.map((p) => ({
          ...p,
          source: providerSource.get(p.id),
          countries: providerToCountries.get(p.id) ?? [],
          specs: specsForProvider(p.id).map((s) => ({ file: s.file, live: s.live, flags: s.flags })),
        })),
        specs,
        schemaFiles,
        countries,
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(path.join(OUT_DIR, '00-INVENTORY.md'), `${md(countries, generatedAt)}\n`);

  process.stdout.write(
    `inventory: ${countries.length} countries, ${transmissionProviders.length} providers, ${specs.length} specs → ${path.relative(REPO, OUT_DIR)}\n`,
  );
}

void main();
