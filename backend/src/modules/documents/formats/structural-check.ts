/**
 * The "structural" gate — what stands in for XSD for EN 16931 CII/UBL, since no root XSD for either
 * syntax has ever been vendored in this repository (verified across the FULL git history, not just
 * the `avant-refonte-documents` tag, before writing this file — see
 * `vendored/validate-schematron.ts`'s own header for the fact and why a home-made replacement XSD is
 * refused rather than built). Two checks, both real in the old, removed `providers.ts`:
 *
 *  1. The XML is well-formed — via `@xmldom/xmldom`'s `DOMParser`, an already-whitelisted dependency
 *     (no new npm dependency), never a hand-rolled parser.
 *  2. The document's root element is the one the syntax requires (`wrongRootElement`, reprised
 *     verbatim from `compliance/providers/format/providers.ts` at the same tag) — CII documents are
 *     rooted at `CrossIndustryInvoice`, UBL documents at `Invoice`.
 *
 * Both run BEFORE Schematron: a malformed or wrongly-rooted document is refused with its own message
 * rather than being handed to node-schematron, whose own failure mode on garbage input is far less
 * legible than "this is not a CrossIndustryInvoice document".
 */
import { DOMParser } from '@xmldom/xmldom';

export interface StructuralCheckResult {
  valid: boolean;
  /** Empty when valid. Plain strings, not BR-* rule ids — this gate runs BEFORE Schematron and has
   *  no rule catalog of its own to cite. */
  errors: string[];
}

/** The root local element name each syntax requires. Local name only — the namespace prefix a
 *  builder chooses is that builder's own business, never this gate's. */
const EXPECTED_ROOT: Record<'cii' | 'ubl', string> = {
  cii: 'CrossIndustryInvoice',
  ubl: 'Invoice',
};

export function validateStructural(xml: string, syntax: 'cii' | 'ubl'): StructuralCheckResult {
  const errors: string[] = [];

  // 1. Well-formedness — @xmldom/xmldom's DOMParser reports non-fatal findings via its
  // `onError(level, message)` callback, but a FATAL parse error (an actually malformed document —
  // e.g. a mismatched tag) THROWS a `ParseError` synchronously from `parseFromString` itself (see
  // `dom-parser.js`'s own `reportError`/fatalError implementation — verified by hand against the
  // installed version, since this differs from the DOM-standard `DOMParser`, which never throws).
  // Both paths are handled: a thrown ParseError is caught below, and a non-fatal 'error' collected
  // via the callback is still treated as malformed (an EN 16931 artifact has no room for either).
  const parseErrors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === 'error' || level === 'fatalError') parseErrors.push(message);
    },
  });
  let doc: ReturnType<DOMParser['parseFromString']> | undefined;
  try {
    doc = parser.parseFromString(xml, 'application/xml');
  } catch (error) {
    parseErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (parseErrors.length > 0 || !doc?.documentElement) {
    return { valid: false, errors: [`Malformed XML: ${parseErrors.join('; ') || 'no root element'}`] };
  }

  // 2. Root element — local name only, same convention `wrongRootElement` used at the repère.
  const expected = EXPECTED_ROOT[syntax];
  const actual = doc.documentElement.localName || doc.documentElement.nodeName;
  if (actual !== expected) {
    errors.push(
      `${syntax.toUpperCase()}: root element is <${actual}>, expected <${expected}> — this is not a ${syntax.toUpperCase()} document.`,
    );
  }

  return { valid: errors.length === 0, errors };
}
