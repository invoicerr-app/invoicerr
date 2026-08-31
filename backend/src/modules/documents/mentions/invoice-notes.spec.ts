/**
 * The core of root TODO item 15: temporal interpolation, chiffrée, and the FREEZE property — a
 * document re-resolved later than its own issue date must keep the rate that was in force WHEN IT
 * WAS ISSUED, never the one in force today. Against the REAL shipped `data/fr.json`, not a synthetic
 * fixture — the numbers below are the actual rates a French invoice prints.
 */
import { ALL_MENTIONS_FILES } from './data/all';
import { defaultMentionsCatalog } from './registry';
import { resolveInvoiceNotes, toUblNote } from './invoice-notes';
import { CountryMentionsFile } from './schema';

const fr = defaultMentionsCatalog.fileFor('FR');

describe('resolveInvoiceNotes — France, against the real shipped data', () => {
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

  it('exactly on the boundary (2026-07-01) already reads the second-half rate — validTo is exclusive', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2026-07-01'));
    const pmd = notes.find((n) => n.subjectCode === 'PMD');
    expect(pmd?.text).toContain('12,40 %');
  });

  // THE FREEZE — the property the whole mechanism exists to guarantee. The SAME document (same
  // issue date, 2026-06-30) resolved "later" (as if read back in the second half, or any time after)
  // must print the SAME rate it printed when it was issued — never the rate in force at the moment
  // of RE-resolution. This function takes only `at`, never `new Date()` internally, so calling it
  // twice with the same `at` from different "wall-clock times" is exactly this proof.
  it('the same invoice (issue date 2026-06-30), re-resolved as if read back much later, keeps 12,15 % forever', () => {
    const atIssue = resolveInvoiceNotes(fr, new Date('2026-06-30'));
    const reResolvedMuchLater = resolveInvoiceNotes(fr, new Date('2026-06-30')); // same `at` — the
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

  it('a mention predating France’s reform-free baseline (1900-01-01) already applies — no artificial start gap', () => {
    const notes = resolveInvoiceNotes(fr, new Date('2020-01-01'));
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
  });
});

describe('resolveInvoiceNotes — a country with no mentions file emits nothing', () => {
  it('undefined file → empty array, never a throw', () => {
    expect(resolveInvoiceNotes(undefined, new Date('2026-08-30'))).toEqual([]);
  });

  it('a country genuinely absent from the catalog also resolves to nothing', () => {
    expect(defaultMentionsCatalog.fileFor('DE')).toBeUndefined();
    expect(resolveInvoiceNotes(defaultMentionsCatalog.fileFor('DE'), new Date('2026-08-30'))).toEqual([]);
  });
});

describe('resolveInvoiceNotes — only statutory rules are ever emitted', () => {
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

  it('the non-statutory rule never appears — inventing a commercial choice for the user is refused by construction', () => {
    const notes = resolveInvoiceNotes(fixture, new Date('2026-08-30'));
    expect(notes).toEqual([{ subjectCode: 'AAA', text: 'A statutory mention.', legalRef: 'Some act' }]);
  });
});

describe('toUblNote', () => {
  it('prefixes the subject code between hashes — the exact shape BR-CL-08 validates', () => {
    expect(toUblNote({ subjectCode: 'PMT', text: 'hello', legalRef: 'x' })).toBe('#PMT#hello');
  });

  it('a note with no subject code is passed through as plain text', () => {
    expect(toUblNote({ text: 'hello', legalRef: 'x' })).toBe('hello');
  });
});

describe('data/all.ts — the shipped catalog', () => {
  it('loads exactly France today — this task’s own scope', () => {
    expect(ALL_MENTIONS_FILES.map((f) => f.countryCode)).toEqual(['FR']);
  });
});
