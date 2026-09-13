/**
 * Schematron validation harness — REPRISED almost verbatim from
 * `compliance/schemas/validate.ts` (git tag `avant-refonte-documents`), amputated of its XSD half.
 *
 * ## Why there is no XSD half here
 *
 * The original request behind this file called for "XSD (xmllint-wasm) THEN Schematron" for CII/UBL.
 * Fact verified before writing a line of code (grep across the ENTIRE git history, not just the
 * `avant-refonte-documents` reference): this repository has NEVER vendored the UN/CEFACT CII (D16B)
 * root XSD, nor the OASIS UBL 2.1 root XSD. The old engine, already, only ever validated CII/UBL EN
 * 16931 via Schematron (see `providers.ts` at the reference: `validateXsd` was only ever called there
 * for the NATIONAL formats — PL FA(2)/FA(3), ES Facturae, IT FatturaPA, MX CFDI — each with its own
 * vendored XSD). Inventing a home-made EN16931 root XSD to fill this gap would be exactly the
 * "home-made compiler" this work forbids. The structural gate that DID genuinely exist before
 * Schematron in the old `providers.ts` is the well-formed-XML check plus the expected root element —
 * reprised here under the honest name `validateStructural` (see `../structural-check.ts`), never
 * presented as an XSD validation. A future NATIONAL format (PL/ES/IT/MX, out of scope here) that
 * wanted to reuse `validateXsd` from the reference would only need to re-import that function from the
 * tag — nothing here stands in the way of that.
 *
 * Schematron runs via node-schematron (executes the .sch directly, no compilation step).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
const { Schema } = require('node-schematron');

/**
 * Registers the custom XPath function `u:slack` (± tolerance on an amount/price comparison) that the
 * Peppol BIS Billing 3.0 Schematron (PEPPOL-EN16931-UBL.sch, wired by `../peppol-bis-provider.ts`)
 * declares as an XSLT function. node-schematron relies on fontoxpath, which requires explicit
 * registration via `registerCustomXPathFunction` — the .sch's own internal `xsl:function`
 * declarations are not read automatically. Reprised VERBATIM from the reference.
 * Idempotent (same key → no-op on re-import, via the module cache).
 */
try {
  const fontoxpath = require('fontoxpath');
  fontoxpath.registerCustomXPathFunction(
    { localName: 'slack', namespaceURI: 'utils' },
    ['xs:anyAtomicType', 'xs:anyAtomicType', 'xs:anyAtomicType'],
    'xs:boolean',
    (_ctx: unknown, exp: unknown, val: unknown, slack: unknown): boolean =>
      Number(exp) + Number(slack) >= Number(val) && Number(exp) - Number(slack) <= Number(val),
  );

  /**
   * The SIX identifier-checksum functions below (2026-09-02, the B2G audit wave) — found MISSING
   * while proving Belgium's B2G routing end-to-end in Cypress:
   * `PEPPOL-EN16931-UBL.sch` declares u:gln/u:mod11/u:mod97-0208/u:abn/u:TinVerification/
   * u:checkSEOrgnr as `xsl:function`s (same mechanism as `u:slack` above), but — unlike `u:slack` —
   * NONE of them had ever been registered here. fontoxpath does not read `xsl:function` declarations
   * out of the .sch automatically (see this file's own header on `u:slack`); an unregistered one is
   * not a clean Schematron failure, it is a THROWN `XPST0017` ("Function ... not registered") the
   * moment a rule referencing it is even evaluated — surfaced through `peppol-transport.ts#send()` as
   * a raw, unnamed error instead of "Cannot send via Peppol: the generated document failed
   * validation" (`peppol-transport.spec.ts`'s own format-gate tests never exercised this: they mock
   * `build()` entirely, or use fixture identifiers under schemes with NO checksum rule at all — e.g.
   * `0009:11112222`). This is exactly the crash a real BE government client (`PEPPOL_ENDPOINT`
   * scheme `0208`, the CBE/KBO number this catalog documents as BE's own EAS) hit in
   * `40-b2g-routing.cy.ts` while writing that test — and, read further, the SAME gap also breaks a
   * Swedish org-number endpoint (`0007`, `u:checkSEOrgnr`) and a Greek TIN endpoint/VAT number
   * (`9933`, `u:TinVerification`, `GR-R-009`/`GR-R-010`) — THREE of the ten EAS this same audit wave
   * documents (be.json/se.json/gr.json). Each body below is a byte-for-byte port of the .sch's own
   * `xsl:function` (comment cites the exact source lines) — never a re-derived or "improved" version
   * of the checksum algorithm, for the identical reason `u:slack` above is a verbatim port and not a
   * rewrite. `u:gln`/`u:mod11`/`u:abn` are ALSO fixed here even though no rule in THIS wave's ten
   * countries exercises them directly: they gate the very same `cbc:EndpointID`/`cac:PartyIdentification/
   * cbc:ID`/`cbc:CompanyID` family (schemes 0088/0192/0151 — GLN, Norwegian org number, Australian
   * ABN), already offered TODAY by the client's own Peppol scheme selector
   * (`client-upsert.tsx`'s own `peppolSchemeId`, including 0088 as its DEFAULT value) for every
   * ordinary B2B Peppol send this repo already claims to support, not only for B2G — leaving them
   * broken while fixing only the three THIS wave happens to need would leave that existing, unrelated
   * claim just as false. The remaining SIX functions this same .sch declares
   * (u:checkCodiceIPA/u:checkCF/u:checkCF16/u:checkPIVAseIT/u:checkPIVA/u:addPIVA — all Italian
   * Codice Fiscale/Partita IVA/Codice IPA checks on PARTY fields, never on the Peppol electronic
   * address itself) were deliberately left out of THIS wave's scope (Italy already has its own
   * dedicated, real SdI/FatturaPA B2G channel in this repo, `b2g-routing/data/it.json`, not Peppol
   * BIS) — named honestly as a known, separate remaining gap at the time. That
   * gap is closed by the next comment block below (2026-09-04): all twelve of the .sch's declared
   * functions are now registered.
   */
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch, u:gln — GS1 GLN (scheme 0088) mod-10 check digit.
    { localName: 'gln', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const raw = String(val);
      const length = raw.length - 1;
      const digits = raw.slice(0, length).split('').map(Number).reverse();
      let weightedSum = 0;
      for (let i = 0; i < length; i++) {
        weightedSum += digits[i] * (1 + ((i + 1) % 2) * 2);
      }
      const checkDigit = (10 - (weightedSum % 10)) % 10;
      return checkDigit === Number(raw.slice(length, length + 1));
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch, u:mod11 — Norwegian organization number (scheme 0192) MOD11.
    { localName: 'mod11', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const raw = String(val);
      const length = raw.length - 1;
      const digits = raw.slice(0, length).split('').map(Number).reverse();
      let weightedSum = 0;
      for (let i = 0; i < length; i++) {
        weightedSum += digits[i] * ((i % 6) + 2);
      }
      const checkDigit = (11 - (weightedSum % 11)) % 11;
      return Number(raw) > 0 && checkDigit === Number(raw.slice(length, length + 1));
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch, u:mod97-0208 — Belgian enterprise number (scheme 0208) MOD97.
    { localName: 'mod97-0208', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const raw = String(val);
      const checkDigits = raw.slice(8, 10);
      const base = Number(raw.slice(0, 8));
      const calculated = 97 - (base % 97);
      return Number(checkDigits) === calculated;
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch, u:abn — Australian Business Number (scheme 0151) weighted MOD89.
    { localName: 'abn', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const raw = String(val);
      const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
      let sum = (raw.charCodeAt(0) - 49) * weights[0];
      for (let i = 1; i < 11; i++) {
        sum += (raw.charCodeAt(i) - 48) * weights[i];
      }
      return sum % 89 === 0;
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch, u:TinVerification — Greek TIN/AFM (scheme 9933, GR-R-009/GR-R-010).
    { localName: 'TinVerification', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const digits = String(val).split('').map(Number);
      const checksum =
        digits[7] * 2 +
        digits[6] * 4 +
        digits[5] * 8 +
        digits[4] * 16 +
        digits[3] * 32 +
        digits[2] * 64 +
        digits[1] * 128 +
        digits[0] * 256;
      return (checksum % 11) % 10 === digits[8];
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch, u:checkSEOrgnr — Swedish organisationsnummer (scheme 0007), Luhn.
    { localName: 'checkSEOrgnr', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const raw = String(val);
      if (!/^\d+$/.test(raw)) return false;
      const mainPart = raw.slice(0, 9);
      const checkDigit = Number(raw.slice(9, 10));
      const len = mainPart.length;
      let sum = 0;
      for (let pos = 1; pos <= len; pos++) {
        const digit = Number(mainPart[len - pos]);
        if (pos % 2 === 1) {
          const doubled = digit * 2;
          sum += (doubled % 10) + Math.floor(doubled / 10);
        } else {
          sum += digit;
        }
      }
      const calculated = (10 - (sum % 10)) % 10;
      return calculated === checkDigit;
    },
  );

  /**
   * The SIX Italian identifier-checksum functions the comment above named as deliberately left out
   * of the 2026-09-02 B2G wave (added 2026-09-04) — Italy has its own real B2G channel
   * (SdI/FatturaPA), but the SAME `XPST0017` crash class hits ANY ordinary (non-B2G) Peppol BIS send
   * carrying an Italian party identifier: `PEPPOL-COMMON-R044` (scheme `0201`, Codice Univoco
   * Ufficio), `R045`/`R046` (schemes `0210`/`9907`, Codice Fiscale), `R047` (scheme `0211`, Partita
   * IVA) each call one of these via `test="..."`, and none had ever been registered. Byte-for-byte
   * ports of the .sch's own `xsl:function` bodies (comment on each cites the exact source lines) —
   * same discipline as the ten above, never a re-derived checksum.
   *
   * `u:checkCF16` and `u:checkPIVA`/`u:addPIVA` are never referenced directly from a rule's
   * `test="..."` — `u:checkCF` (R045/R046) calls `u:checkCF16` internally when its argument is 16
   * characters long, and `u:checkPIVAseIT` (R047) calls `u:checkPIVA`, which recurses through
   * `u:addPIVA`. All three are still independently registered below (the acceptance bar:
   * "the 12 declared are the 12 registered" — a future rule referencing one of them directly must not
   * crash either), but the compound functions call the plain JS ports of their helpers directly
   * rather than round-tripping back through fontoxpath: the .sch's own `xsl:function` bodies are
   * never interpreted by fontoxpath at all (see this file's header above on `u:slack`), so there is
   * no XPath call to intercept in the first place — wiring the JS call graph directly is the only way
   * for `u:checkCF`'s registered callback to reach `u:checkCF16`'s logic.
   *
   * `u:checkPIVA` and `u:addPIVA` return `xs:integer`, not `xs:boolean` — the .sch itself declares
   * `as="xs:integer"` on both (checkPIVA: 0 for a valid checksum, 1 for a non-numeric argument, the
   * actual nonzero remainder otherwise; addPIVA is its recursive accumulator) — registered with
   * `'xs:integer'` below, matching the .sch exactly rather than "improving" them into booleans.
   */
  // Plain JS helpers shared by the compound functions below — see the comment above on why these
  // are called directly in JS instead of being round-tripped through fontoxpath.
  function checkCF16(arg: string): boolean {
    // PEPPOL-EN16931-UBL.sch:124-140 (u:checkCF16). 1-based XPath substring(s, start, len) below is
    // ported as s.slice(start - 1, start - 1 + len).
    const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const onlyAllowed = (s: string): boolean => [...s].every((ch) => allowed.includes(ch));
    const castableAsInteger = (s: string): boolean => /^[+-]?\d+$/.test(s.trim());
    return (
      onlyAllowed(arg.slice(0, 6)) && // substring($arg,1,6)
      castableAsInteger(arg.slice(6, 8)) && // substring($arg,7,2)
      onlyAllowed(arg.slice(8, 9)) && // substring($arg,9,1)
      castableAsInteger(arg.slice(9, 11)) && // substring($arg,10,2)
      true && // substring($arg,12,3) castable as xs:string — always true, kept here for fidelity
      castableAsInteger(arg.slice(14, 15)) && // substring($arg,15,1)
      onlyAllowed(arg.slice(15, 16)) // substring($arg,16,1)
    );
  }
  function addPIVA(arg: string, pari: number): number {
    // PEPPOL-EN16931-UBL.sch:176-188 (u:addPIVA) — recurses one character at a time, alternating
    // `pari` (odd/even position), exactly like the .sch's own recursive xsl:function.
    const tappo = /^[+-]?\d+$/.test(arg) ? 1 : 0;
    if (tappo === 0) return 0;
    const table = '0246813579';
    const digit = Number(arg.slice(0, 1));
    const mapper = pari === 1 ? Number(table.slice(digit, digit + 1)) : digit;
    return mapper + addPIVA(arg.slice(1), pari === 0 ? 1 : 0);
  }
  function checkPIVA(arg: string): number {
    // PEPPOL-EN16931-UBL.sch:168-175 (u:checkPIVA).
    if (!/^[+-]?\d+$/.test(arg)) return 1;
    return addPIVA(arg, 0) % 10;
  }

  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch:86-91 (u:checkCodiceIPA) — Italian Codice Univoco Ufficio (scheme
    // 0201, PEPPOL-COMMON-R044): exactly 6 characters, all from the alphanumeric charset below. No
    // real checksum in the .sch itself — a format check only.
    { localName: 'checkCodiceIPA', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const arg = String(val);
      const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return arg.length === 6 && [...arg].every((ch) => allowed.includes(ch));
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch:92-123 (u:checkCF) — Italian Codice Fiscale (schemes 0210/9907,
    // PEPPOL-COMMON-R045/R046): length 16 delegates to u:checkCF16 (format check, individuals);
    // length 11 only requires the value be castable as xs:integer (companies — same 11 digits as a
    // Partita IVA, but the .sch does not re-verify the Luhn checksum here); any other length fails.
    { localName: 'checkCF', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const arg = String(val);
      if (arg.length === 16) return checkCF16(arg);
      if (arg.length === 11) return /^[+-]?\d+$/.test(arg.trim());
      return false;
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch:124-140 (u:checkCF16) — never referenced directly from a rule's
    // test="...", only internally by u:checkCF above (see the shared `checkCF16` helper); registered
    // anyway so any future direct reference resolves (this file's own acceptance bar: 12 declared,
    // 12 registered).
    { localName: 'checkCF16', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => checkCF16(String(val)),
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch:141-167 (u:checkPIVAseIT) — Italian Partita IVA (scheme 0211,
    // PEPPOL-COMMON-R047): only validates when the first two characters are the 'IT'/'it' country
    // prefix (passes unconditionally otherwise — the .sch's own leniency, not ours); when Italian,
    // the remaining 11 characters must carry a correct u:checkPIVA checksum.
    { localName: 'checkPIVAseIT', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:boolean',
    (_ctx: unknown, val: unknown): boolean => {
      const arg = String(val);
      const paese = arg.slice(0, 2); // substring($arg,1,2)
      const codice = arg.slice(2); // substring($arg,3)
      if (paese === 'IT' || paese === 'it') {
        return codice.length === 11 && checkPIVA(codice) === 0;
      }
      return true;
    },
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch:168-175 (u:checkPIVA) — returns xs:integer, not xs:boolean, exactly as
    // the .sch declares (`as="xs:integer"`): 1 if not numeric, else the Luhn-like sum mod 10 (0 =
    // valid checksum). Called internally by u:checkPIVAseIT above; registered for the same reason
    // u:checkCF16 is.
    { localName: 'checkPIVA', namespaceURI: 'utils' },
    ['xs:string'],
    'xs:integer',
    (_ctx: unknown, val: unknown): number => checkPIVA(String(val)),
  );
  fontoxpath.registerCustomXPathFunction(
    // PEPPOL-EN16931-UBL.sch:176-188 (u:addPIVA) — u:checkPIVA's own recursive accumulator, also
    // xs:integer per the .sch. Never referenced directly from a rule; registered for the same
    // reason u:checkCF16 is.
    { localName: 'addPIVA', namespaceURI: 'utils' },
    ['xs:string', 'xs:integer'],
    'xs:integer',
    (_ctx: unknown, arg: unknown, pari: unknown): number => addPIVA(String(arg), Number(pari)),
  );
} catch {
  // fontoxpath absent — harmless as long as Peppol BIS (the only ruleset that uses these functions)
  // is not wired in; see the comment above.
}

// Schema.fromString is expensive — cached by path, same as at the reference.
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

/**
 * node-schematron only exposes { id, test, message, isReport } — the ISO Schematron `flag` attribute
 * (fatal|warning, used throughout the EN16931/Peppol .sch files to distinguish a blocking violation
 * from a mere warning) is parsed by the library but never returned. Reprised from the reference: the
 * attribute is read back directly from the .sch source (a plain attribute read, never a
 * reimplementation of the schema) and used to split failures into blocking `errors`
 * (flag="fatal" or absent) vs non-blocking `warnings` (flag="warning" or anything else).
 */
const SEVERITY_CACHE = new Map<string, Map<string, string>>();

function loadSeverityMap(relPath: string): Map<string, string> {
  const cached = SEVERITY_CACHE.get(relPath);
  if (cached) return cached;
  const absPath = path.resolve(__dirname, relPath);
  const content = fs.readFileSync(absPath, 'utf-8');
  const map = new Map<string, string>();
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

export interface SchematronError {
  id: string;
  /** The rule's ISO Schematron `flag` attribute, e.g. 'fatal' | 'warning'. */
  flag: string;
  message: string;
}

export interface SchematronResult {
  /** No blocking violation (fatal/unspecified). A non-blocking violation does not change this. */
  valid: boolean;
  errorCount: number;
  errors: SchematronError[];
  warnings: SchematronError[];
}

/**
 * Validates an XML document against a Schematron .sch file (via node-schematron). Pass the
 * PREPROCESSED .sch (all `<sch:include>`s already resolved) — e.g.
 * 'en16931/EN16931-CII-validation-preprocessed.sch'.
 *
 * node-schematron results: { assertId, isReport, message }. isReport=false → failed assertion,
 * isReport=true → <report> fired (informational, always ignored). Failed assertions are then split
 * by the rule's `flag` (see loadSeverityMap): fatal (or unspecified) → blocking `errors`; everything
 * else (warning, information, ...) → non-blocking `warnings`.
 */
export function validateSchematron(xml: string, schRelPath: string): SchematronResult {
  const schema = loadSchema(schRelPath);
  const severity = loadSeverityMap(schRelPath);
  const results: Array<{ assertId: string; isReport: boolean; message: string }> = schema.validateString(xml);

  const errors: SchematronError[] = [];
  const warnings: SchematronError[] = [];
  for (const r of results) {
    if (r.isReport) continue;
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

/** Paths of the vendored rulesets ACTUALLY wired in today, relative to this file. */
export const EN16931_CII_SCH = 'en16931/EN16931-CII-validation-preprocessed.sch';
export const EN16931_UBL_SCH = 'en16931/EN16931-UBL-validation-preprocessed.sch';
/** The OpenPEPPOL BIS Billing 3.0 delta — runs IN ADDITION TO `EN16931_UBL_SCH`, never instead of it
 *  (see `../peppol-bis-provider.ts`), exactly like the national deltas below. */
export const PEPPOL_BIS_UBL_SCH = 'peppol/PEPPOL-EN16931-UBL.sch';
/** The KoSIT XRechnung 3.0.x delta — likewise, wired by `../xrechnung-provider.ts`. */
export const XRECHNUNG_UBL_SCH = 'de/XRechnung-UBL-validation-preprocessed.sch';
// The SI-UBL 2.0 / NLCIUS (Netherlands) delta used to wire its own vendored Schematron file here —
// removed along with the rest of the Dutch scope (five-country pivot, 2026-09-10): see
// `documentation/docs/developer-guide/live-testing.md` for what this drops.
