import { buildCreditNoteDescriptor } from './credit-note.descriptor';
import { buildExpenseDescriptor } from './expense.descriptor';
import { buildInvoiceDescriptor } from './invoice.descriptor';
import { buildQuoteDescriptor } from './quote.descriptor';
import { DocumentTypeDescriptor } from './types';

/**
 * `listItem` (types.ts) is the one hint the generic frontend list (document-list.tsx) uses to build
 * a card's title and secondary info — see that file's own comment for why this exists instead of
 * the frontend guessing. This is the integrity half of that contract: a `titleFields`/
 * `secondaryFields` entry that doesn't name one of the type's own TOP-LEVEL fields is a
 * misconfiguration the frontend degrades through silently (never a crash — see the comment on
 * `listItem`), which is exactly why it needs a test to catch it here instead: a silent skip on
 * screen looks identical to "this type has nothing to show", not to "someone made a typo".
 *
 * Every document type registered in this codebase is checked — nothing here names "quote" or
 * "invoice" specifically, so a fifth type gets this coverage the moment it is added to the list
 * below, the same discipline the compliance engine's own coverage specs hold for a country profile.
 */
const DESCRIPTOR_BUILDERS: (() => DocumentTypeDescriptor)[] = [
  buildQuoteDescriptor,
  buildInvoiceDescriptor,
  buildCreditNoteDescriptor,
  buildExpenseDescriptor,
];

describe('DocumentTypeDescriptor.listItem — every entry resolves to a real top-level field', () => {
  for (const build of DESCRIPTOR_BUILDERS) {
    const descriptor = build();

    it(`${descriptor.id}: titleFields and secondaryFields name declared fields`, () => {
      const fieldKeys = new Set(descriptor.fields.map((field) => field.key));

      for (const key of descriptor.listItem?.titleFields ?? []) {
        // Jest's `expect` (unlike Chai's) takes no assertion message — the unmatched key is put IN
        // the value under test instead, so a failure still names which key and which type broke.
        expect({ typeId: descriptor.id, field: 'titleFields', key, known: fieldKeys.has(key) }).toEqual({
          typeId: descriptor.id,
          field: 'titleFields',
          key,
          known: true,
        });
      }
      for (const key of descriptor.listItem?.secondaryFields ?? []) {
        expect({ typeId: descriptor.id, field: 'secondaryFields', key, known: fieldKeys.has(key) }).toEqual({
          typeId: descriptor.id,
          field: 'secondaryFields',
          key,
          known: true,
        });
      }
    });

    it(`${descriptor.id}: declares at least a title field so the list never falls back silently`, () => {
      expect({
        typeId: descriptor.id,
        hasTitleField: (descriptor.listItem?.titleFields?.length ?? 0) > 0,
      }).toEqual({ typeId: descriptor.id, hasTitleField: true });
    });
  }
});
