import { assertValidMentionRule, InvalidMentionRuleError, InvoiceNoteRule, Temporal } from './schema';

const base: Omit<InvoiceNoteRule, 'legalRef'> = {
  subjectCode: 'PMT',
  text: 'Some mention text.',
  statutory: true,
};

function entry(value: InvoiceNoteRule, validFrom = '1900-01-01'): Temporal<InvoiceNoteRule> {
  return { validFrom, value };
}

describe('assertValidMentionRule', () => {
  it('accepts a well-formed statutory mention with a legalRef', () => {
    expect(() =>
      assertValidMentionRule(entry({ ...base, legalRef: 'C. com. art. L441-9' }), 'test'),
    ).not.toThrow();
  });

  // The mutation this exact test rehearses: a mention with no legalRef must NEVER load — the same
  // "a mandate without a citation does not load" discipline root TODO item 11 established.
  it('rejects a mention with no legalRef at all — the discipline this task’s brief names by name', () => {
    expect(() => assertValidMentionRule(entry({ ...base, legalRef: '' }), 'test')).toThrow(
      InvalidMentionRuleError,
    );
    expect(() => assertValidMentionRule(entry({ ...base, legalRef: '' }), 'test')).toThrow(/no "legalRef"/);
  });

  it('rejects a mention with a whitespace-only legalRef', () => {
    expect(() => assertValidMentionRule(entry({ ...base, legalRef: '   ' }), 'test')).toThrow(
      InvalidMentionRuleError,
    );
  });

  it('rejects a mention with no text', () => {
    expect(() =>
      assertValidMentionRule(entry({ ...base, text: '', legalRef: 'C. com. art. L441-9' }), 'test'),
    ).toThrow(/no "text"/);
  });

  it('rejects a mention with a non-boolean statutory flag', () => {
    expect(() =>
      assertValidMentionRule(
        entry({ ...base, legalRef: 'C. com. art. L441-9', statutory: undefined as never }),
        'test',
      ),
    ).toThrow(/statutory/);
  });

  it('rejects an entry with no validFrom', () => {
    expect(() =>
      assertValidMentionRule(entry({ ...base, legalRef: 'C. com. art. L441-9' }, ''), 'test'),
    ).toThrow(/no "validFrom"/);
  });

  it('a subject code is optional — BT-22 alone is a valid note', () => {
    expect(() =>
      assertValidMentionRule(
        entry({ text: 'Free text mention.', legalRef: 'Some article', statutory: true }),
        'test',
      ),
    ).not.toThrow();
  });
});
