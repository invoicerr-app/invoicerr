import { DocumentFieldDescriptor, DocumentTypeDescriptor } from './types';

/**
 * The two EntityReferenceRegistry entities that count as "the recipient this document type
 * addresses" - both back onto the SAME `Client` table under two different search scopes
 * (`client-reference.provider.ts`'s own header): "client" for an outbound document's billable party
 * (the quote's/invoice's own field), "supplier" for one addressed to a supplier
 * (`received-invoice.descriptor.ts`'s own `supplierClient`, and `purchase-order.descriptor.ts`'s own
 * `supplier` - the first type in this trunk that actually SENDS to one). A `{recipientName}`/
 * recipient-language lookup means the identical thing for either: resolve the referenced Client's own
 * label/language. Kept as a closed set of ENTITY ids, never a `typeId` branch - the same "never key
 * off which document type this is" discipline every other generic mechanism in this module already
 * holds (see e.g. `stock/apply-stock-on-issuance.ts`'s own header for the identical argument made for
 * a different concern).
 */
const RECIPIENT_REFERENCE_ENTITIES = new Set(['client', 'supplier']);

/**
 * The 'reference' field this type uses to point at one of `RECIPIENT_REFERENCE_ENTITIES` above, if it
 * has one - the SINGLE source of the `{recipientName}` presence rule, shared by
 * `buildEmailTemplateParts` (which fills the value in for a real send) and
 * `describeDocumentEmailVocabulary` (which advertises the key to an editor). Exported so
 * `rendering/render-instance-pdf.ts` can reuse the exact same rule a THIRD time, to find the
 * document's own recipient id for recipient-language resolution
 * (`rendering/language/resolve-recipient-language.ts`) - one rule, three readers, so a type can never
 * be offered a placeholder the send would then treat as unknown, and can never have its language
 * resolved from a field this module wouldn't otherwise recognize as "the recipient".
 *
 * Widening this from "client" only to also "supplier" (purchase orders & goods receipts, "bons de
 * commande") has one small,
 * accepted side effect: `received-invoice`'s own settings-screen email-template preview now also
 * advertises `{recipientName}` as an available placeholder, even though that type never actually
 * sends anything (`received-invoice.descriptor.ts` declares no `email` at all) - harmless, since a
 * placeholder nothing ever substitutes is simply never reached, and keying this by ENTITY rather than
 * by `typeId` is what keeps this rule generic for the type that DOES need it (purchase-order).
 */
export function findClientReferenceField(
  descriptor: DocumentTypeDescriptor,
): DocumentFieldDescriptor | undefined {
  return descriptor.fields.find(
    (field) => field.kind === 'reference' && !!field.entity && RECIPIENT_REFERENCE_ENTITIES.has(field.entity),
  );
}
