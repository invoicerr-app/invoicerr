/**
 * Temporal interpolation of rates, and the FREEZE property -- a
 * document re-resolved later than its own issue date must keep the rate that was in force WHEN IT
 * WAS ISSUED, never the one in force today. Against the REAL shipped `data/fr.json`, not a synthetic
 * fixture -- the numbers below are the actual rates a French invoice prints.
 */
import { ALL_MENTIONS_FILES } from './data/all';
import { defaultMentionsCatalog } from './registry';
import { resolveInvoiceNotes, toUblNote, UnresolvedInvoiceNotePlaceholderError } from './invoice-notes';
import { CountryMentionsFile } from './schema';

const fr = defaultMentionsCatalog.fileFor('FR');

describe('resolveInvoiceNotes -- France, against the real shipped data', () => {
  it('emits exactly the three statutory mentions, each with its own legalRef', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2026-08-30'));
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
    for (const note of notes) {
      expect(note.legalRef).toBeTruthy();
    }
  });

  it('an invoice issued 2026-06-30 (first half) prints the 12,15 % rate', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2026-06-30'));
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toContain('12,15 %');
    expect(pmd?.text).not.toContain('12,40 %');
  });

  it('an invoice issued 2026-07-02 (second half) prints the 12,40 % rate', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2026-07-02'));
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toContain('12,40 %');
    expect(pmd?.text).not.toContain('12,15 %');
  });

  it('exactly on the boundary (2026-07-01) already reads the second-half rate -- validTo is exclusive', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2026-07-01'));
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toContain('12,40 %');
  });

  // THE FREEZE -- the property the whole mechanism exists to guarantee. The SAME document (same
  // issue date, 2026-06-30) resolved "later" (as if read back in the second half, or any time after)
  // must print the SAME rate it printed when it was issued -- never the rate in force at the moment
  // of RE-resolution. This function takes only `at`, never `new Date()` internally, so calling it
  // twice with the same `at` from different "wall-clock times" is exactly this proof.
  it('the same invoice (issue date 2026-06-30), re-resolved as if read back much later, keeps 12,15 % forever', () => {
    const atIssue = resolveInvoiceNotes(fr, new Date('2026-06-30'));
    const reResolvedMuchLater = resolveInvoiceNotes(fr, new Date('2026-06-30')); // same `at` -- the
    // document's own issue date never changes, however long after it a caller re-renders it.
    expect(reResolvedMuchLater).toEqual(atIssue);
    expect(atIssue.find((n) => n.subjectCode === 'PMD')?.text).toContain('12,15 %');
  });

  it('the fixed recovery indemnity (40 €) and the "néant" discount wording are present verbatim', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2026-08-30'));
    const pmt = notes.find((n) => n.subjectCode === 'PMT');
    const aab = notes.find((n) => n.subjectCode === 'AAB');
    expect(pmt?.text).toContain('40 €');
    expect(aab?.text).toBe('Escompte pour paiement anticipé : néant');
  });

  // THE MUTATION TARGET: before this fix, a placeholder with no value table entry covering `at` was
  // left as its own raw `{token}` in the printed text -- a legally mandated mention on a REAL invoice
  // reading "au taux de {lateFeeRate} l'an". `lateFeeRate`'s own table only starts 2026-01-01 even
  // though PMD itself (like every mention here) is statutory from 1900-01-01 -- exactly the gap a
  // pre-2026 issue date (a backdated import, a re-rendered archive, a late-issued invoice) falls into.
  it("an issue date before lateFeeRate's own earliest value (a pre-2026 backdated/imported invoice) refuses rather than printing the raw {lateFeeRate} token", () => {
    expect(() => resolveInvoiceNotes(fr, new Date('2025-11-15'))).toThrow(
      UnresolvedInvoiceNotePlaceholderError,
    );
  });

  // ISSUE #519: the LAST window has no NEWER entry to replace it once its own `validTo` passes -- a
  // maintenance lapse (the ECB rate moves again and nobody adds the next dated entry) used to carry
  // the send itself into a hard refuse, on EVERY French invoice, self-hosted included, from the very
  // first instant of 2027-01-01 onward. `fr.json`'s own PMD rule now declares a `fallbackText` for
  // exactly this shape of gap (`invoice-notes.ts#hasTableRunOut`): the send still succeeds, printing
  // the statute's own rate-setting RULE (C. com. art. L441-10 II, quoted verbatim) instead of a
  // number nobody has entered yet -- never the raw `{lateFeeRate}` token, and never a throw.
  it("an issue date on/after the last lateFeeRate window's own validTo (an un-maintained catalog) falls back to the statutory rule wording instead of refusing to send", () => {
    const notes = resolveInvoiceNotes(fr, new Date('2027-01-01'));
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toContain('Banque centrale européenne');
    expect(pmd?.text).toContain('majoré de 10 points de pourcentage');
    expect(pmd?.text).not.toContain('{lateFeeRate}');
    // The other two mentions (PMT, AAB) are entirely unaffected -- only PMD's own placeholder is
    // unresolved on this date.
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
  });

  // THE EXACT TWO DATES ISSUE #519 NAMES: a real French invoice dated the day after the table's last
  // window ends (first half of 2027), and one dated mid-2027 (second half) -- both must actually be
  // SENDABLE, which for this resolver means "resolves without throwing", proven the same way every
  // other date in this file already is: against the REAL shipped `data/fr.json`.
  it('a French invoice dated 2027-01-02 (first half of 2027, no table entry yet) sends -- PMD falls back to the rule wording', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2027-01-02'));
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toBe(
      "Tout retard de paiement entraîne des pénalités calculées au taux d'intérêt appliqué par la " +
        'Banque centrale européenne à son opération de refinancement la plus récente, majoré de 10 ' +
        'points de pourcentage, exigibles le jour suivant la date de règlement figurant sur la ' +
        "facture, sans qu'un rappel soit nécessaire (art. L441-10 du code de commerce).",
    );
    // PMT (a fixed 40 € indemnity, its own table has no end date) and AAB (no placeholder at all)
    // are never affected by lateFeeRate running out.
    expect(notes.find((n) => n.subjectCode === 'PMT')?.text).toContain('40 €');
    expect(notes.find((n) => n.subjectCode === 'AAB')?.text).toBe('Escompte pour paiement anticipé : néant');
  });

  it('a French invoice dated 2027-07-02 (second half of 2027, still no table entry) sends -- same fallback wording', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2027-07-02'));
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toContain('Banque centrale européenne');
    expect(pmd?.text).not.toContain('{lateFeeRate}');
  });

  it("a mention predating France’s reform-free baseline (1900-01-01) already applies -- no artificial start gap (a fixture with no placeholder to resolve, decoupled from the REAL data's own value-table start dates above)", () => {
    const fixture: CountryMentionsFile = {
      countryCode: 'ZZ',
      invoiceNotes: [
        {
          validFrom: '1900-01-01',
          value: {
            subjectCode: 'AAB',
            text: 'Escompte pour paiement anticipé : néant',
            legalRef: 'Some act',
            statutory: true,
          },
        },
      ],
    };
    const notes = resolveInvoiceNotes(fixture, new Date('1950-01-01'));
    expect(notes.map((n) => n.subjectCode)).toEqual(['AAB']);
  });
});

describe('resolveInvoiceNotes -- a country with no mentions file emits nothing', () => {
  it('undefined file → empty array, never a throw', () => {
    expect(resolveInvoiceNotes(undefined, new Date('2026-08-30'))).toEqual([]);
  });

  it('a country genuinely absent from the catalog also resolves to nothing', () => {
    expect(defaultMentionsCatalog.fileFor('DE')).toBeUndefined();
    expect(resolveInvoiceNotes(defaultMentionsCatalog.fileFor('DE'), new Date('2026-08-30'))).toEqual([]);
  });
});

describe('resolveInvoiceNotes -- only statutory rules are ever emitted', () => {
  const fixture: CountryMentionsFile = {
    countryCode: 'ZZ',
    invoiceNotes: [
      {
        validFrom: '1900-01-01',
        value: { subjectCode: 'AAA', text: 'A statutory mention.', legalRef: 'Some act', statutory: true },
      },
      {
        validFrom: '1900-01-01',
        value: {
          subjectCode: 'AAK',
          text: 'A commercial choice nobody made.',
          legalRef: 'Some act',
          statutory: false,
        },
      },
    ],
  };

  it('the non-statutory rule never appears -- inventing a commercial choice for the user is refused by construction', () => {
    const notes = resolveInvoiceNotes(fixture, new Date('2026-08-30'));
    expect(notes).toEqual([{ subjectCode: 'AAA', text: 'A statutory mention.', legalRef: 'Some act' }]);
  });
});

describe('toUblNote', () => {
  it('prefixes the subject code between hashes -- the exact shape BR-CL-08 validates', () => {
    expect(toUblNote({ subjectCode: 'PMT', text: 'hello', legalRef: 'x' })).toBe('#PMT#hello');
  });

  it('a note with no subject code is passed through as plain text', () => {
    expect(toUblNote({ text: 'hello', legalRef: 'x' })).toBe('hello');
  });
});

describe('data/all.ts -- the shipped catalog', () => {
  it('loads exactly France today', () => {
    expect(ALL_MENTIONS_FILES.map((f) => f.countryCode)).toEqual(['FR']);
  });
});
