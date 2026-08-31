/**
 * REPRISE PARTIELLE de `compliance/schemas/cii-post-process.ts` (git tag `avant-refonte-documents`) —
 * seule `splitCiiIncludedNotes` survit ici, verbatim. `normalizeCiiNamespaces` et
 * `postProcessCiiForCtc` ne sont PAS repris : les deux existaient pour le besoin d'un transporteur
 * précis (le PDP français "superpdp", qui exige un style de namespace par défaut plutôt que préfixé,
 * et une adresse de routage réécrite après coup) — un souci de TRANSMISSION (item 10), pas de FORMAT.
 * Ce ticket construit un CII/UBL EN 16931 générique, jamais adressé à un transporteur particulier ;
 * réintroduire ce post-traitement ici anticiperait une décision qui appartient à la reprise du
 * transport FR, pas à celle-ci.
 */

/**
 * Split the one-note-many-contents block the generator emits into one note per mention.
 *
 * `@e-invoice-eu/core` maps an array of `cbc:Note` onto a SINGLE `ram:IncludedNote` holding several
 * `ram:Content`. That is invalid CII — `Content` occurs at most once in a note. Measured against a
 * real French PDP rejection at the repère, not deduced: several mentions in, one note with several
 * contents out.
 *
 * The same pass recovers BT-21: EN 16931 UBL carries a subject code as a `#CODE#` prefix on the note
 * text; CII wants it as its own `ram:SubjectCode`, and the generator does not translate between the
 * two, so the prefix travels into CII as literal text otherwise.
 *
 * A no-op when there is nothing to split, so it is safe to run on any CII document.
 */
export function splitCiiIncludedNotes(ciiXml: string): string {
  return ciiXml.replace(/<ram:IncludedNote>([\s\S]*?)<\/ram:IncludedNote>/g, (whole, inner: string) => {
    const contents = [...String(inner).matchAll(/<ram:Content>([\s\S]*?)<\/ram:Content>/g)].map((m) => m[1]);
    // Leave a well-formed note alone — including one that already carries a SubjectCode.
    if (contents.length <= 1 && !/^#[A-Z0-9]{3}#/.test(contents[0] ?? '')) return whole;

    return contents
      .map((raw) => {
        const m = raw.match(/^#([A-Z0-9]{3})#([\s\S]*)$/);
        const text = m ? m[2] : raw;
        const code = m ? m[1] : undefined;
        return code
          ? `<ram:IncludedNote><ram:Content>${text}</ram:Content><ram:SubjectCode>${code}</ram:SubjectCode></ram:IncludedNote>`
          : `<ram:IncludedNote><ram:Content>${text}</ram:Content></ram:IncludedNote>`;
      })
      .join('');
  });
}

/**
 * The SAME fix as `splitCiiIncludedNotes` above, but applied to the library's own INTERMEDIATE JS
 * object rather than the rendered XML string — found necessary, live, by root TODO item 15 ("mentions
 * obligatoires"): `facturx-provider.ts`'s Factur-X embed step asks `@e-invoice-eu/core` to
 * REGENERATE the CII internally from `EuInvoice` (there is no way to hand it a pre-built XML string
 * instead — the library takes the semantic model, not text — see that file's own header), so the
 * string-based fix above, which only ever runs on the PLAIN CII this bridge builds for the structural
 * gate, never reaches the copy that ends up embedded in the PDF. A REAL superpdp deposit surfaced
 * this the moment a French invoice carried more than one note (this task's own three mentions): the
 * conformity check came back `fr:213`, still citing every mention as ABSENT, with the platform's own
 * XML-schema error underneath — "Element 'ram:Content' must occur exactly 1 times" — the exact defect
 * this function exists to prevent, not a new one.
 *
 * `@e-invoice-eu/core`'s `InvoiceServiceOptions.postProcessor` is the library's OWN, public extension
 * point (`(data: ExpandObject) => Promise<void>`, called on the intermediate object right before it
 * is rendered to XML — verified directly against the vendored dependency, not assumed) — passing this
 * function as `postProcessor` for BOTH the plain 'CII' generate call and the 'Factur-X-EN16931' embed
 * call (the latter internally re-runs the exact same CII generation step) applies the identical split
 * to whichever copy is actually produced, using a channel the library ships for exactly this kind of
 * mutation rather than a second regex pass over text that, for the embed call, was never exposed.
 *
 * The shape this mutates: `@e-invoice-eu/core` maps an array of `cbc:Note` onto
 * `rsm:ExchangedDocument['ram:IncludedNote'] = { 'ram:Content': [<one string per note>] }` — verified
 * empirically against the vendored dependency (see this task's own report for the exact probe run),
 * including for a SINGLE note (`ram:Content` is still a one-element array, which is why this function
 * runs unconditionally whenever the array exists at all, never gated on `.length > 1` the way it might
 * look like it should be — a lone `#CODE#text` note still needs its SubjectCode recovered). A no-op
 * whenever there is no note at all (`ram:IncludedNote` absent) — safe to pass unconditionally.
 */
export function splitCiiIncludedNotesInObject(cii: Record<string, unknown>): void {
  const invoiceRoot = cii?.['rsm:CrossIndustryInvoice'] as Record<string, unknown> | undefined;
  const exchangedDocument = invoiceRoot?.['rsm:ExchangedDocument'] as Record<string, unknown> | undefined;
  const includedNote = exchangedDocument?.['ram:IncludedNote'] as Record<string, unknown> | undefined;
  const contents = includedNote?.['ram:Content'];
  if (!exchangedDocument || !Array.isArray(contents)) return; // nothing to split — safe no-op

  exchangedDocument['ram:IncludedNote'] = contents.map((raw) => {
    const m = /^#([A-Z0-9]{3})#([\s\S]*)$/.exec(String(raw));
    return m ? { 'ram:Content': m[2], 'ram:SubjectCode': m[1] } : { 'ram:Content': raw };
  });
}
