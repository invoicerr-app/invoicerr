/**
 * Reusable schema validation helpers for compliance format harness.
 *
 * Vendored schemas live in:
 *   backend/src/compliance/schemas/en16931/   — EN16931 CII Schematron (preprocessed + compiled SEF)
 *   backend/src/compliance/schemas/pl/        — PL FA(2) XSD
 *
 * Schematron uses saxon-js (SEF) for XPath 2.0 support.
 * XSD uses libxmljs2 (native, in-process).
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── Schematron (EN16931 CII via saxon-js) ─────────────────────────────────

const SEF_CACHE = new Map<string, string>();

function loadSef(relPath: string): string {
  const cached = SEF_CACHE.get(relPath);
  if (cached) return cached;
  const absPath = path.resolve(__dirname, relPath);
  const content = fs.readFileSync(absPath, 'utf-8');
  SEF_CACHE.set(relPath, content);
  return content;
}

export interface SchematronResult {
  valid: boolean;
  errorCount: number;
  errors: SchematronError[];
}

export interface SchematronError {
  id: string;
  flag: string;
  message: string;
}

/**
 * Validate XML against a compiled Schematron SEF (via saxon-js).
 * The SEF must be pre-compiled from the .sch → .xsl → .sef.json pipeline.
 */
export function validateSchematron(xml: string, sefRelPath: string): SchematronResult {
  // Lazy-load saxon-js (heavy module)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SaxonJS = require('saxon-js');
  const sefText = loadSef(sefRelPath);

  const result = SaxonJS.transform({
    stylesheetText: sefText,
    sourceText: xml,
    destination: 'serialized',
  });

  const output: string = result.principalResult ?? '';
  const failMatches = [...output.matchAll(/<svrl:failed-assert[^>]*id="([^"]+)"[^>]*flag="([^"]*)"[^>]*>/g)];
  const textMatches = [...output.matchAll(/<svrl:failed-assert[^>]*id="([^"]+)"[^>]*>.*?<svrl:text>(.*?)<\/svrl:text>/gs)];

  const errors: SchematronError[] = failMatches.map((m, i) => ({
    id: m[1],
    flag: m[2],
    message: textMatches[i]?.[2] ?? '',
  }));

  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors,
  };
}

// ─── XSD (PL FA(2) via xmllint subprocess) ─────────────────────────────────
// libxmljs2 can't resolve xsd:import/xsd:include from in-memory strings.
// xmllint resolves file-based schema chains correctly.

export interface XsdResult {
  valid: boolean;
  errorCount: number;
  errors: string[];
}

/**
 * Validate XML against an XSD schema (via xmllint --schema subprocess).
 * Returns the list of validation errors (empty = valid).
 */
export function validateXsd(xml: string, xsdRelPath: string): XsdResult {
  const { execSync } = require('child_process');
  const os = require('os');
  const xsdAbsPath = path.resolve(__dirname, xsdRelPath);

  // Write XML to a temp file (xmllint needs a file path)
  const tmpFile = path.join(os.tmpdir(), `xsd-validate-${Date.now()}-${Math.random().toString(36).slice(2)}.xml`);
  try {
    fs.writeFileSync(tmpFile, xml, 'utf-8');
    const stdout = execSync(
      `xmllint --noout --schema "${xsdAbsPath}" "${tmpFile}" 2>&1`,
      { timeout: 10_000 },
    );
    // xmllint exits 0 and prints "... validates" on success
    return { valid: true, errorCount: 0, errors: [] };
  } catch (err: any) {
    // xmllint exits non-zero on validation errors; stderr/stdout contains the error lines
    const output: string = (err.stdout ?? err.stderr ?? String(err)).toString();
    const lines = output.split('\n').filter(l => l.trim() && !l.includes('validates'));
    // Filter out "fails to validate" summary line
    const errors = lines.filter(l => !l.includes('fails to validate') && !l.includes('does not validate'));
    return {
      valid: false,
      errorCount: errors.length,
      errors,
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
