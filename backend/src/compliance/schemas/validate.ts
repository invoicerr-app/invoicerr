/**
 * Reusable schema validation helpers for compliance format harness.
 *
 * Vendored schemas live in:
 *   backend/src/compliance/schemas/en16931/   — EN16931 CII Schematron (preprocessed .sch)
 *   backend/src/compliance/schemas/pl/        — PL FA(2)/FA(3) XSD
 *
 * Schematron uses node-schematron (runs .sch directly, no compile step).
 * XSD uses xmllint-wasm (no native binary dependency).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Schematron (EN16931 CII + Peppol BIS UBL via node-schematron) ─────────

const { Schema } = require('node-schematron');

// Register the Peppol BIS `u:slack` custom function with fontoxpath.
// The Peppol BIS Schematron (PEPPOL-EN16931-UBL.sch) defines u:slack as an
// XSLT function for ±tolerance comparisons (price/amount rounding checks).
// node-schematron uses fontoxpath which requires custom functions to be
// pre-registered via registerCustomXPathFunction — they are not parsed from
// xsl:function declarations inside the .sch file.
// Registration is idempotent (same key → no-op on re-import via module cache).
try {
  const fontoxpath = require('fontoxpath');
  // Peppol BIS calls u:slack with numeric values that fontoxpath evaluates as xs:double.
  // Use xs:anyAtomicType to accept both xs:decimal and xs:double without a cast error.
  fontoxpath.registerCustomXPathFunction(
    { localName: 'slack', namespaceURI: 'utils' },
    ['xs:anyAtomicType', 'xs:anyAtomicType', 'xs:anyAtomicType'],
    'xs:boolean',
    (_ctx: unknown, exp: unknown, val: unknown, slack: unknown): boolean =>
      Number(exp) + Number(slack) >= Number(val) && Number(exp) - Number(slack) <= Number(val),
  );
} catch {
  // fontoxpath not available — Peppol BIS Schematron validation will skip u:slack rules
}

// Cache compiled Schema instances by path (Schema.fromString is expensive)
const SCH_CACHE = new Map<string, ReturnType<typeof Schema.fromString>>();

function loadSchema(relPath: string) {
  const cached = SCH_CACHE.get(relPath);
  if (cached) return cached;
  const absPath = path.resolve(__dirname, relPath);
  const content = fs.readFileSync(absPath, 'utf-8');
  const schema = Schema.fromString(content);
  SCH_CACHE.set(relPath, schema);
  return schema;
}

// M-1: node-schematron's Assert/Result classes only expose { id, test, message, isReport } — the
// ISO Schematron `flag` attribute (fatal|warning, used throughout the vendored EN16931/Peppol .sch
// files to distinguish a hard rule violation from an advisory one) is parsed by the library but
// never surfaced on the result. Since every failed assertion (isReport=false) would otherwise be
// treated as an "error" regardless of what the schema author intended, we extract id→flag straight
// from the .sch source (a plain attribute read, not a schema re-implementation) and use it to split
// failures into blocking `errors` (flag="fatal"/unspecified) vs non-blocking `warnings`
// (flag="warning"). Cached per path alongside the compiled Schema.
const SEVERITY_CACHE = new Map<string, Map<string, string>>();

function loadSeverityMap(relPath: string): Map<string, string> {
  const cached = SEVERITY_CACHE.get(relPath);
  if (cached) return cached;
  const absPath = path.resolve(__dirname, relPath);
  const content = fs.readFileSync(absPath, 'utf-8');
  const map = new Map<string, string>();
  // Attribute order varies across vendored .sch files (id-then-flag, flag-then-id, multi-line) —
  // match the whole opening <assert ...> tag then pull id/flag out independently.
  const assertTagRe = /<assert\b([^>]*)>/g;
  for (const match of content.matchAll(assertTagRe)) {
    const attrs = match[1];
    const idMatch = attrs.match(/\bid="([^"]*)"/);
    const flagMatch = attrs.match(/\bflag="([^"]*)"/);
    if (idMatch) map.set(idMatch[1], flagMatch ? flagMatch[1] : 'fatal');
  }
  SEVERITY_CACHE.set(relPath, map);
  return map;
}

export interface SchematronResult {
  /** No blocking (fatal/unspecified) findings. Non-fatal-level findings do not affect this. */
  valid: boolean;
  /** Count of blocking (fatal/unspecified) findings — mirrors `errors.length`. */
  errorCount: number;
  /** Blocking findings (flag="fatal" or no flag attribute on the rule). */
  errors: SchematronError[];
  /** Non-blocking findings (flag="warning", flag="information", or any other non-"fatal" token —
   *  ISO Schematron only reserves "fatal" as a universally-recognized blocking severity; schema
   *  authors are free to define others, e.g. KoSIT's XRechnung-UBL-validation.sch uses
   *  flag="information" for BR-DE-TMP-32, a recommendation-only rule) — surfaced for visibility,
   *  never block. */
  warnings: SchematronError[];
}

export interface SchematronError {
  id: string;
  /** The rule's ISO Schematron `flag` attribute, e.g. 'fatal' | 'warning'. */
  flag: string;
  message: string;
}

/**
 * Validate XML against a Schematron .sch file (via node-schematron).
 * Pass the preprocessed .sch (with all includes resolved) — e.g.
 * 'en16931/EN16931-CII-validation-preprocessed.sch'.
 *
 * node-schematron result items: { assertId: string, isReport: boolean, message: string }
 * isReport=false → failed assertion, isReport=true → fired report (informational, always ignored).
 * Failed assertions are further split by the rule's `flag` attribute (see loadSeverityMap): fatal
 * (or unspecified) → `errors` (blocking); anything else (warning, information, ...) → `warnings`
 * (non-blocking) — "fatal" is the only severity ISO Schematron treats as universally blocking.
 */
export function validateSchematron(xml: string, schRelPath: string): SchematronResult {
  const schema = loadSchema(schRelPath);
  const severity = loadSeverityMap(schRelPath);
  const results: Array<{ assertId: string; isReport: boolean; message: string }> = schema.validateString(xml);

  const errors: SchematronError[] = [];
  const warnings: SchematronError[] = [];
  for (const r of results) {
    if (r.isReport) continue; // informational <report> fires — never a validation finding
    const flag = (r.assertId && severity.get(r.assertId)) || 'fatal';
    const entry: SchematronError = { id: r.assertId, flag, message: r.message };
    if (flag === 'fatal') errors.push(entry);
    else warnings.push(entry);
  }

  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors,
    warnings,
  };
}

// ─── XSD (PL FA(2)/FA(3) via xmllint-wasm) ─────────────────────────────────
// xmllint-wasm runs xmllint inside a WASM sandbox — no system binary required.
// All XSD files in the schema directory are preloaded into the WASM VFS so that
// xsd:include and xsd:import chains resolve correctly.

const { validateXML } = require('xmllint-wasm');

export interface XsdResult {
  valid: boolean;
  errorCount: number;
  errors: string[];
}

/**
 * Validate XML against an XSD schema (via xmllint-wasm).
 * All sibling .xsd files in the same directory are preloaded for xsd:import resolution.
 * Returns the list of validation errors (empty = valid).
 */
export async function validateXsd(
  xml: string,
  xsdRelPath: string,
  opts?: { maxMemoryPages?: number },
): Promise<XsdResult> {
  const xsdAbsPath = path.resolve(__dirname, xsdRelPath);
  const xsdDir = path.dirname(xsdAbsPath);
  const mainXsdName = path.basename(xsdAbsPath);

  // Load all .xsd files in the directory for xsd:include / xsd:import chain resolution.
  // The MAIN schema is passed as `schema`; all others are passed as `preload` (VFS-mounted
  // so xmllint can resolve imports, but not used as the primary validation schema).
  const allXsdFiles = fs
    .readdirSync(xsdDir)
    .filter((f) => f.endsWith('.xsd'))
    .map((f) => ({
      fileName: f,
      contents: fs.readFileSync(path.join(xsdDir, f), 'utf-8'),
    }));

  const mainSchema = allXsdFiles.find((f) => f.fileName === mainXsdName) ?? {
    fileName: mainXsdName,
    contents: fs.readFileSync(xsdAbsPath, 'utf-8'),
  };
  const preloadFiles = allXsdFiles.filter((f) => f.fileName !== mainXsdName);

  const result = await validateXML({
    xml: { fileName: 'invoice.xml', contents: xml },
    schema: mainSchema,
    preload: preloadFiles,
    // Allow callers to raise the WASM memory limit for large schema sets (e.g. SAT CFDI catCFDI.xsd ≈ 6 MB)
    ...(opts?.maxMemoryPages ? { maxMemoryPages: opts.maxMemoryPages } : {}),
  });

  return {
    valid: result.valid,
    errorCount: result.errors.length,
    errors: result.errors.map((e) => e.message),
  };
}
