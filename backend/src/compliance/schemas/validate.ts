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

// ─── XSD (PL FA(2) via xmllint-wasm) ──────────────────────────────────────
// xmllint-wasm runs xmllint inside a WASM sandbox — no system binary required.
// All XSD files in the schema directory are preloaded into the WASM VFS so that
// xsd:include and xsd:import chains resolve correctly.

// eslint-disable-next-line @typescript-eslint/no-var-requires
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
export async function validateXsd(xml: string, xsdRelPath: string): Promise<XsdResult> {
  const xsdAbsPath = path.resolve(__dirname, xsdRelPath);
  const xsdDir = path.dirname(xsdAbsPath);
  const mainXsdName = path.basename(xsdAbsPath);

  // Load all .xsd files in the directory so that xsd:include / xsd:import chains resolve.
  const schemaFiles = fs.readdirSync(xsdDir)
    .filter((f) => f.endsWith('.xsd'))
    .map((f) => ({
      fileName: f,
      contents: fs.readFileSync(path.join(xsdDir, f), 'utf-8'),
    }));

  const result = await validateXML({
    xml: { fileName: 'invoice.xml', contents: xml },
    schema: schemaFiles.find((f) => f.fileName === mainXsdName)
      ? schemaFiles
      : [{ fileName: mainXsdName, contents: fs.readFileSync(xsdAbsPath, 'utf-8') }, ...schemaFiles],
  });

  return {
    valid: result.valid,
    errorCount: result.errors.length,
    errors: result.errors.map((e) => e.message),
  };
}
