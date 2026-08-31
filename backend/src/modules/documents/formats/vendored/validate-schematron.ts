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
 * montant/prix) que le Peppol BIS Billing 3.0 Schematron (PEPPOL-EN16931-UBL.sch, rangé mais pas
 * encore branché — voir vendored/peppol/) déclare comme fonction XSLT. node-schematron s'appuie sur
 * fontoxpath, qui exige un enregistrement explicite via `registerCustomXPathFunction` — les
 * déclarations `xsl:function` internes au .sch ne sont pas lues automatiquement. Reprise VERBATIM du
 * repère : ce fichier ne branche pas encore Peppol BIS (item 10/16), mais le jour où il le fera, la
 * fonction sera déjà enregistrée ici plutôt que redécouverte en prod sur un premier échec silencieux.
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
} catch {
  // fontoxpath absent — sans conséquence tant que Peppol BIS (seul ruleset à utiliser u:slack) n'est
  // pas branché ; voir le commentaire ci-dessus.
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
