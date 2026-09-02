/**
 * Schematron validation harness — REPRISE quasi verbatim de
 * `compliance/schemas/validate.ts` (git tag `avant-refonte-documents`), amputée de sa moitié XSD.
 *
 * ## Pourquoi pas de moitié XSD ici
 *
 * La tâche qui a créé ce fichier demandait "XSD (xmllint-wasm) PUIS Schematron" pour CII/UBL. Fait
 * vérifié avant d'écrire une ligne de code (grep sur TOUT l'historique git, pas seulement le repère
 * `avant-refonte-documents`) : ce dépôt n'a JAMAIS vendoré le XSD racine UN/CEFACT CII (D16B) ni le
 * XSD racine OASIS UBL 2.1. L'ancien moteur, déjà, ne validait CII/UBL EN 16931 QUE par Schematron
 * (voir `providers.ts` au repère : `validateXsd` n'y était appelé que pour les formats NATIONAUX —
 * PL FA(2)/FA(3), ES Facturae, IT FatturaPA, MX CFDI — chacun avec son propre XSD vendoré). Inventer
 * un XSD racine EN16931 maison pour combler ce manque serait exactement le "compilateur maison"
 * interdit par cette tâche. La porte structurelle qui EXISTAIT réellement avant le Schematron dans
 * l'ancien `providers.ts` est le contrôle de bonne formation XML + élément racine attendu — reprise
 * ici sous le nom honnête `validateStructural` (voir `../structural-check.ts`), jamais présentée
 * comme une validation XSD. Un futur format NATIONAL (PL/ES/IT/MX, hors périmètre de cette tâche) qui
 * voudrait reprendre `validateXsd` du repère n'aurait qu'à réimporter cette fonction depuis le tag —
 * rien ici ne s'y oppose.
 *
 * Schematron passe par node-schematron (exécute le .sch directement, aucune étape de compilation).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Schema } = require('node-schematron');

/**
 * Enregistre la fonction XPath personnalisée `u:slack` (tolérance ± sur une comparaison de
 * montant/prix) que le Peppol BIS Billing 3.0 Schematron (PEPPOL-EN16931-UBL.sch, branché par
 * `../peppol-bis-provider.ts`) déclare comme fonction XSLT. node-schematron s'appuie sur fontoxpath,
 * qui exige un enregistrement explicite via `registerCustomXPathFunction` — les déclarations
 * `xsl:function` internes au .sch ne sont pas lues automatiquement. Reprise VERBATIM du repère.
 * Idempotent (même clé → no-op au réimport via le cache de modules).
 */
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fontoxpath = require('fontoxpath');
  fontoxpath.registerCustomXPathFunction(
    { localName: 'slack', namespaceURI: 'utils' },
    ['xs:anyAtomicType', 'xs:anyAtomicType', 'xs:anyAtomicType'],
    'xs:boolean',
    (_ctx: unknown, exp: unknown, val: unknown, slack: unknown): boolean =>
      Number(exp) + Number(slack) >= Number(val) && Number(exp) - Number(slack) <= Number(val),
  );

  /**
   * The SIX identifier-checksum functions below (2026-09-02, the B2G audit wave, `B2G_COVERAGE.md`
   * at the repo root) — found MISSING while proving `b2g-routing/data/be.json` end-to-end in Cypress:
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
   * address itself) are DELIBERATELY NOT fixed here — out of this wave's own scope (Italy already has
   * its own dedicated, real SdI/FatturaPA B2G channel in this repo, `b2g-routing/data/it.json`, not
   * Peppol BIS) — named honestly in `B2G_COVERAGE.md` as a known, separate remaining gap.
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
} catch {
  // fontoxpath absent — sans conséquence tant que Peppol BIS (seul ruleset à utiliser ces fonctions)
  // n'est pas branché ; voir le commentaire ci-dessus.
}

// Schema.fromString est coûteux — mis en cache par chemin, comme au repère.
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
 * node-schematron n'expose que { id, test, message, isReport } — l'attribut ISO Schematron `flag`
 * (fatal|warning, utilisé partout dans les .sch EN16931/Peppol pour distinguer une violation
 * bloquante d'un simple avertissement) est parsé par la lib mais jamais restitué. Repris du repère :
 * on relit l'attribut directement dans la source .sch (une simple lecture d'attribut, jamais une
 * réimplémentation du schéma) et on l'utilise pour scinder les échecs en `errors` bloquantes
 * (flag="fatal" ou absent) vs `warnings` non bloquantes (flag="warning" ou autre).
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
  /** L'attribut ISO Schematron `flag` de la règle, p.ex. 'fatal' | 'warning'. */
  flag: string;
  message: string;
}

export interface SchematronResult {
  /** Aucune violation bloquante (fatal/non spécifiée). Une violation non bloquante n'y change rien. */
  valid: boolean;
  errorCount: number;
  errors: SchematronError[];
  warnings: SchematronError[];
}

/**
 * Valide un XML contre un fichier Schematron .sch (via node-schematron). Passer le .sch PRÉTRAITÉ
 * (tous les `<sch:include>` déjà résolus) — p.ex. 'en16931/EN16931-CII-validation-preprocessed.sch'.
 *
 * Résultats node-schematron : { assertId, isReport, message }. isReport=false → assertion échouée,
 * isReport=true → <report> déclenché (informationnel, toujours ignoré). Les assertions échouées sont
 * ensuite scindées par le `flag` de la règle (voir loadSeverityMap) : fatal (ou non spécifié) →
 * `errors` (bloquant) ; tout le reste (warning, information, ...) → `warnings` (non bloquant).
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

/** Chemins des rulesets vendorés RÉELLEMENT branchés aujourd'hui, relatifs à ce fichier. */
export const EN16931_CII_SCH = 'en16931/EN16931-CII-validation-preprocessed.sch';
export const EN16931_UBL_SCH = 'en16931/EN16931-UBL-validation-preprocessed.sch';
/** Le delta OpenPEPPOL BIS Billing 3.0 — s'exécute EN PLUS de `EN16931_UBL_SCH`, jamais à la place
 *  (voir `../peppol-bis-provider.ts`), exactement comme les deltas nationaux ci-dessous. */
export const PEPPOL_BIS_UBL_SCH = 'peppol/PEPPOL-EN16931-UBL.sch';
/** Le delta KoSIT XRechnung 3.0.x — idem, branché par `../xrechnung-provider.ts`. */
export const XRECHNUNG_UBL_SCH = 'de/XRechnung-UBL-validation-preprocessed.sch';
