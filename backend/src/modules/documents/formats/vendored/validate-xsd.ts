/**
 * XSD validation harness — REPRISED almost verbatim from `compliance/schemas/validate.ts` (git tag
 * `avant-refonte-documents`), the XSD half that `validate-schematron.ts`'s own header said was
 * amputated for lack of a real need at the time (neither CII nor UBL has a vendored root XSD, and
 * that admission still holds). This module fills that gap NOW, for the two NATIONAL formats built
 * here — PL FA(3) and IT FatturaPA: each has an OFFICIAL vendored XSD (`vendored/pl/schemat_FA3.xsd`,
 * `vendored/it/Schema_VFPR12.xsd`), so each is judged BY THAT SCHEMA, never by the EN 16931
 * Schematron — a national schema needs no home-made compiler when the authority itself publishes one.
 *
 * xmllint-wasm (already a dependency of this backend — see package.json; no new dependency added)
 * runs xmllint in a WASM sandbox, with no system binary. Every .xsd in the main schema's own
 * DIRECTORY is preloaded into the VFS so its `xsd:include`/`xsd:import` chains resolve
 * (schemat_FA3.xsd imports ElementarneTypyDanych/KodyKrajow/StrukturyDanych; Schema_VFPR12.xsd
 * imports xmldsig-core-schema).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
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
    // (both are modest), kept for the same reason the reference kept it (SAT CFDI's ~6MB catalog).
    ...(opts?.maxMemoryPages ? { maxMemoryPages: opts.maxMemoryPages } : {}),
  });

  return {
    valid: result.valid,
    errorCount: result.errors.length,
    errors: result.errors.map((e: { message: string }) => e.message),
  };
}
