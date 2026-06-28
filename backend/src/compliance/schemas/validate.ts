/**
 * Reusable schema validation helpers for compliance format harness.
 *
 * Vendored schemas live in:
 *   backend/src/compliance/schemas/en16931/   — EN16931 CII Schematron (preprocessed .sch)
 *   backend/src/compliance/schemas/pl/        — PL FA(2) XSD
 *
 * Schematron uses node-schematron (runs .sch directly, no compile step).
 * XSD uses xmllint-wasm (no native binary dependency).
 */
import * as fs from 'fs';
import * as path from 'path';

// ─── Schematron (EN16931 CII via node-schematron) ──────────────────────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Schema } = require('node-schematron');

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
 * Validate XML against a Schematron .sch file (via node-schematron).
 * Pass the preprocessed .sch (with all includes resolved) — e.g.
 * 'en16931/EN16931-CII-validation-preprocessed.sch'.
 *
 * node-schematron result items: { assertId: string, isReport: boolean, message: string }
 * isReport=false → failed assertion (error), isReport=true → fired report (informational).
 */
export function validateSchematron(xml: string, schRelPath: string): SchematronResult {
  const schema = loadSchema(schRelPath);
  const results: Array<{ assertId: string; isReport: boolean; message: string }> =
    schema.validateString(xml);

  // Only count failed assertions (isReport=false); reports are informational
  const errors: SchematronError[] = results
    .filter((r) => !r.isReport)
    .map((r) => ({
      id: r.assertId,
      flag: 'error',
      message: r.message,
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
