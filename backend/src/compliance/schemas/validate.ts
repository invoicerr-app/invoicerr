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

// ─── XSD (PL FA(2) via libxmljs2) ──────────────────────────────────────────

const XSD_CACHE = new Map<string, any>();

function loadXsd(relPath: string): any {
  const cached = XSD_CACHE.get(relPath);
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const libxmljs = require('libxmljs2');
  const absPath = path.resolve(__dirname, relPath);
  const xsdStr = fs.readFileSync(absPath, 'utf-8');
  const xsd = libxmljs.parseXml(xsdStr);
  XSD_CACHE.set(relPath, xsd);
  return xsd;
}

export interface XsdResult {
  valid: boolean;
  errorCount: number;
  errors: string[];
}

/**
 * Validate XML against an XSD schema (via libxmljs2, native in-process).
 * Returns the list of validation errors (empty = valid).
 */
export function validateXsd(xml: string, xsdRelPath: string): XsdResult {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const libxmljs = require('libxmljs2');
  const xsd = loadXsd(xsdRelPath);
  const doc = libxmljs.parseXml(xml);

  const isValid = doc.validate(xsd);
  if (isValid) {
    return { valid: true, errorCount: 0, errors: [] };
  }

  const validationErrors = doc.validationErrors.map((e: any) => e.message || String(e));
  return {
    valid: false,
    errorCount: validationErrors.length,
    errors: validationErrors,
  };
}
