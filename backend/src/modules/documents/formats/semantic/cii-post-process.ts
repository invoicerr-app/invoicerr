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
