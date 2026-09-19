import { DocumentFieldDescriptor, DocumentTypeDescriptor } from './descriptors/types';

/**
 * Resolves the handful of type-descriptor-derived facts `GET /documents`'s `clientId`/`dateFrom`/
 * `dateTo`/`q` filters need — kept separate from `documents.service.ts` (already 1600+ lines) and
 * from `persistence.ts` (a dumb Prisma layer that must stay ignorant of what a "client" or "date"
 * field even is — see that file's own header on `ListDocumentsPageOptions`). Every function here is a
 * pure read of a `DocumentTypeDescriptor`, so a plugin-registered type gets exactly the same
 * treatment as a native one with zero changes here.
 */

/** The first field on this type that references a CLIENT entity — the `clientId` filter, and `q`'s
 *  own "match the client's name" term, both key off this. `undefined` for a type with no such field
 *  (e.g. purchase-order's own "supplier" targets a DIFFERENT entity — see that descriptor's own
 *  header): the caller (`DocumentsService`) turns that into a named 400 rather than silently
 *  ignoring a `clientId` the type could never have honored. */
export function resolveClientFieldKey(descriptor: DocumentTypeDescriptor): string | undefined {
  return descriptor.fields.find((field) => field.kind === 'reference' && field.entity === 'client')?.key;
}

/** The one field this type's own instances carry an issuance date under, if any — `'issueDate'`
 *  (invoice/quote/credit-note/purchase-order/received-invoice) or `'date'` (expense) are the only two
 *  conventions any shipped descriptor uses (`grep -n "kind: 'date'" descriptors/*.descriptor.ts`);
 *  `undefined` for a type that declares neither (e.g. goods-receipt's own "receiptDate" — a real date
 *  field, but not this type's OWN issuance date in the sense `dateFrom`/`dateTo` mean). The caller
 *  refuses a date filter on such a type with a named 400 rather than silently matching nothing. */
export function resolveDateFieldKey(descriptor: DocumentTypeDescriptor): string | undefined {
  const byKey = (key: string): DocumentFieldDescriptor | undefined =>
    descriptor.fields.find((field) => field.key === key && field.kind === 'date');
  return (byKey('issueDate') ?? byKey('date'))?.key;
}

/**
 * Which of this type's own `listItem.titleFields` are plain, free-text-searchable values —
 * `q`'s own "match the title" term. Only 'text'/'longText' fields qualify: a 'reference' titleField
 * (credit-note's own "invoice", purchase-order's own "supplier" against the SUPPLIER entity,
 * goods-receipt's own "purchaseOrder") stores an id, never a human-readable string, so a
 * `string_contains` against it could only ever match an id a user never typed — deliberately left
 * out rather than a search box that pretends to work and never actually hits. Recursively resolving
 * what THAT referenced record is called is its own, separate piece of work (out of scope here — see
 * the issue this endpoint was built for).
 */
export function resolveSearchTextFieldKeys(descriptor: DocumentTypeDescriptor): string[] {
  const titleKeys = descriptor.listItem?.titleFields ?? [];
  return descriptor.fields
    .filter((field) => titleKeys.includes(field.key) && (field.kind === 'text' || field.kind === 'longText'))
    .map((field) => field.key);
}
