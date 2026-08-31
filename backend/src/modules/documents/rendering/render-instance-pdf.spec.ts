/**
 * `legalMentionsFor` (root TODO item 15) is the ONE piece of `render-instance-pdf.ts` that is pure —
 * everything else in that file needs Prisma + Puppeteer (see this file's own header for why no
 * broader spec exists here today). Proven directly, against the REAL shipped `data/fr.json`, the
 * same discipline `mentions/invoice-notes.spec.ts` already holds for the resolver itself — this file
 * only proves the GATING (the `usesLegalMentions` flag, the country/date extraction), not the
 * resolution logic a second time.
 */
import { DocumentTypeDescriptor } from '../descriptors/types';
import { legalMentionsFor } from './render-instance-pdf';

const invoiceDescriptor: DocumentTypeDescriptor = {
  id: 'invoice',
  label: 'Invoice',
  fields: [],
  actions: [],
  usesLegalMentions: true,
};

const plainDescriptor: DocumentTypeDescriptor = {
  id: 'expense',
  label: 'Expense',
  fields: [],
  actions: [],
};

describe('legalMentionsFor', () => {
  it('a French company printing an invoice gets the three mentions, frozen at the document’s own issue date', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2026-06-30' });
    expect(mentions.map((m) => m.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
    expect(mentions.find((m) => m.subjectCode === 'PMD')?.text).toContain('12,15 %');
  });

  it('the same company, an invoice issued after 1 July, prints the second-half rate — the freeze is per-document, not per-render', () => {
    const mentions = legalMentionsFor(invoiceDescriptor, 'France', { issueDate: '2026-07-02' });
    expect(mentions.find((m) => m.subjectCode === 'PMD')?.text).toContain('12,40 %');
  });

  it('a document type that does not declare usesLegalMentions gets none, whatever its data says', () => {
    expect(legalMentionsFor(plainDescriptor, 'France', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a country with no mentions file gets none — no invented mandate for Germany', () => {
    expect(legalMentionsFor(invoiceDescriptor, 'Germany', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a company with no resolvable country gets none — never a guessed jurisdiction', () => {
    expect(legalMentionsFor(invoiceDescriptor, null, { issueDate: '2026-08-30' })).toEqual([]);
    expect(legalMentionsFor(invoiceDescriptor, 'Nowhereland', { issueDate: '2026-08-30' })).toEqual([]);
  });

  it('a missing or unparsable issueDate gets none — never a guessed "today"', () => {
    expect(legalMentionsFor(invoiceDescriptor, 'France', {})).toEqual([]);
    expect(legalMentionsFor(invoiceDescriptor, 'France', { issueDate: 'not-a-date' })).toEqual([]);
  });
});
