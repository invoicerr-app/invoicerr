/**
 * XSD validation harness — REPRISE quasi verbatim de `compliance/schemas/validate.ts` (git tag
 * `avant-refonte-documents`), la moitié XSD que `validate-schematron.ts`'s propre en-tête disait
 * amputée faute d'un besoin réel à l'époque (item 12 : ni CII ni UBL n'ont de XSD racine vendoré, et
 * cet aveu reste vrai). Ce module comble ce manque MAINTENANT, pour les deux formats NATIONAUX que
 * l'item 10 (vague 2) construit — PL FA(3) et IT FatturaPA : chacun a un XSD OFFICIEL vendoré
 * (`vendored/pl/schemat_FA3.xsd`, `vendored/it/Schema_VFPR12.xsd`), donc chacun est jugé PAR CE
 * SCHÉMA, jamais par le Schematron EN 16931 — un schéma national n'a pas besoin d'un compilateur
 * maison quand l'administration elle-même en publie un.
 *
 * xmllint-wasm (déjà une dépendance de ce backend — voir package.json ; aucune dépendance nouvelle)
 * exécute xmllint dans un bac à sable WASM, sans binaire système. Tous les .xsd du RÉPERTOIRE du
 * schéma principal sont préchargés dans le VFS pour que ses `xsd:include`/`xsd:import` se résolvent
 * (schemat_FA3.xsd importe ElementarneTypyDanych/KodyKrajow/StrukturyDanych ; Schema_VFPR12.xsd
 * importe xmldsig-core-schema).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateXML } = require('xmllint-wasm');

export interface XsdResult {
  valid: boolean;
  errorCount: number;
  errors: string[];
}

/**
 * Validate `xml` against the XSD at `xsdRelPath` (relative to THIS file — e.g. 'pl/schemat_FA3.xsd').
 * Every sibling `.xsd` in that same directory is preloaded so import/include chains resolve.
 */
export async function validateXsd(
  xml: string,
  xsdRelPath: string,
  opts?: { maxMemoryPages?: number },
): Promise<XsdResult> {
  const xsdAbsPath = path.resolve(__dirname, xsdRelPath);
  const xsdDir = path.dirname(xsdAbsPath);
  const mainXsdName = path.basename(xsdAbsPath);

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
    xml: { fileName: 'document.xml', contents: xml },
    schema: mainSchema,
    preload: preloadFiles,
    // Allow callers to raise the WASM memory limit for a large schema set — unused by PL/IT today
    // (both are modest), kept for the same reason the repère kept it (SAT CFDI's ~6MB catalog).
    ...(opts?.maxMemoryPages ? { maxMemoryPages: opts.maxMemoryPages } : {}),
  });

  return {
    valid: result.valid,
    errorCount: result.errors.length,
    errors: result.errors.map((e: { message: string }) => e.message),
  };
}
