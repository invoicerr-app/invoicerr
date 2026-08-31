/**
 * `splitCiiIncludedNotesInObject` — root TODO item 15's own fix for the gap
 * `facturx-provider.ts`'s header now documents as REACHED (a real superpdp `fr:213` rejection, see
 * `pdp/pdp.live.spec.ts`). The object shape asserted here is the ACTUAL shape
 * `@e-invoice-eu/core@`'s own `FormatCIIService` produces before rendering — verified empirically
 * against the vendored dependency (a small probe script, not assumed from reading its source) before
 * writing this function; this spec pins that shape down as a regression guard.
 */
import { splitCiiIncludedNotesInObject } from './cii-post-process';

function ciiWith(contents: string[] | undefined) {
  return {
    'rsm:CrossIndustryInvoice': {
      'rsm:ExchangedDocument': {
        'ram:ID': 'INV-1',
        ...(contents ? { 'ram:IncludedNote': { 'ram:Content': contents } } : {}),
      },
    },
  };
}

describe('splitCiiIncludedNotesInObject', () => {
  it('splits several notes packed into one ram:IncludedNote into one element per note', () => {
    const cii = ciiWith(['user note', '#PMT#mention pmt', '#PMD#mention pmd', '#AAB#mention aab']);
    splitCiiIncludedNotesInObject(cii);

    const doc = cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument'] as {
      'ram:IncludedNote': unknown;
    };
    expect(doc['ram:IncludedNote']).toEqual([
      { 'ram:Content': 'user note' },
      { 'ram:Content': 'mention pmt', 'ram:SubjectCode': 'PMT' },
      { 'ram:Content': 'mention pmd', 'ram:SubjectCode': 'PMD' },
      { 'ram:Content': 'mention aab', 'ram:SubjectCode': 'AAB' },
    ]);
  });

  // The library wraps a LONE note in a one-element array too (verified empirically) — a subject
  // code must still be recovered for it, so this function never gates on `.length > 1`.
  it('recovers the subject code even for a single, lone note', () => {
    const cii = ciiWith(['#AAB#only one']);
    splitCiiIncludedNotesInObject(cii);
    const doc = cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument'] as {
      'ram:IncludedNote': unknown;
    };
    expect(doc['ram:IncludedNote']).toEqual([{ 'ram:Content': 'only one', 'ram:SubjectCode': 'AAB' }]);
  });

  it('a single plain note with no subject code is left as an equivalent, well-formed note', () => {
    const cii = ciiWith(['just a plain note']);
    splitCiiIncludedNotesInObject(cii);
    const doc = cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument'] as {
      'ram:IncludedNote': unknown;
    };
    expect(doc['ram:IncludedNote']).toEqual([{ 'ram:Content': 'just a plain note' }]);
  });

  it('no note at all is a safe no-op', () => {
    const cii = ciiWith(undefined);
    expect(() => splitCiiIncludedNotesInObject(cii)).not.toThrow();
    const doc = cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument'] as Record<string, unknown>;
    expect(doc['ram:IncludedNote']).toBeUndefined();
  });

  it('a malformed / unexpected object shape is also a safe no-op, never a throw', () => {
    expect(() => splitCiiIncludedNotesInObject({})).not.toThrow();
    expect(() => splitCiiIncludedNotesInObject({ 'rsm:CrossIndustryInvoice': {} })).not.toThrow();
  });
});
