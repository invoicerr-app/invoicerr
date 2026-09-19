/**
 * "The four current labels must keep working" — the migration contract this feature's own brief
 * demanded, proven at the exact TWO boundaries this feature actually touched:
 *
 *  1. `invoice.descriptor.ts`'s `record-payment.method` field — before this feature, a hardcoded
 *     four-option `select` (bank_transfer/card/cash/other); now a VIEW over
 *     `payment-methods/built-in.ts`'s own typed registry. A NEW "record-payment" call with
 *     `method: 'bank_transfer'` (the value an UPGRADING install's existing bookkeeping habit already
 *     produces) must still validate cleanly against the REAL descriptor, through the REAL
 *     FieldKindRegistry — never a re-implemented, possibly-drifting copy of that check.
 *  2. `rendering/render-html.ts`'s NEW "Payment methods" section
 *     (`descriptor.usesPaymentMethods`) — an upgrading install has, by construction, never touched the
 *     new payment-methods screen at all (nothing there to enable yet), so its EXISTING invoices must
 *     keep rendering BYTE-FOR-BYTE the same PDF this feature did not exist to change — this is
 *     `render-html.spec.ts`'s own "renders NOTHING when `paymentMethods` is absent/empty" case, proven
 *     here again through the REAL invoice descriptor rather than a synthetic one, so a regression in
 *     either file is caught by whichever spec runs first.
 *
 * What does NOT need proving here: `DocumentPayment.method` is (and always was) a bare, unvalidated
 * `String?` column (schema.prisma) — an EXISTING row's stored value never gets touched, checked, or
 * migrated by anything in this feature; `settlement/payments.ts#listPayments` reads it back verbatim,
 * exactly as it always has. See that file's own header for why persistence itself needed no change at
 * all — only what a NEW write is VALIDATED against, and what a document RENDERS, are new.
 */
import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { validateAgainstDescriptor } from '../descriptors/validate';
import { renderDocumentHtml } from '../rendering/render-html';
import { defaultPaymentMethodRegistry } from './payment-method-registry';

describe('legacy `method` migration — the REAL invoice descriptor, the REAL validator', () => {
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const descriptor = buildInvoiceDescriptor();
  const recordPaymentAction = descriptor.actions.find((action) => action.id === 'record-payment');
  if (!recordPaymentAction?.params) {
    throw new Error('Test fixture assumption broken: "record-payment" must declare params.');
  }
  const recordPaymentParams = recordPaymentAction.params;

  it('the registry still resolves "bank_transfer" and "cash" — the two ids reused, unchanged, from the old hardcoded list', () => {
    expect(defaultPaymentMethodRegistry.resolve('bank_transfer')?.label).toBe('Bank transfer');
    expect(defaultPaymentMethodRegistry.resolve('cash')?.label).toBe('Cash');
  });

  it('a NEW "record-payment" submission with method: "bank_transfer" still validates with ZERO errors', () => {
    const errors = validateAgainstDescriptor(
      recordPaymentParams,
      { amount: 60, currency: 'EUR', paidAt: '2026-08-30', method: 'bank_transfer' },
      fieldKindRegistry,
    );
    expect(errors).toEqual([]);
  });

  it('a NEW "record-payment" submission with method: "cash" also still validates with ZERO errors', () => {
    const errors = validateAgainstDescriptor(
      recordPaymentParams,
      { amount: 60, currency: 'EUR', paidAt: '2026-08-30', method: 'cash' },
      fieldKindRegistry,
    );
    expect(errors).toEqual([]);
  });

  it('the OLD "card"/"other" values are no longer offered as NEW choices — a real product decision, not an oversight (see built-in.ts)', () => {
    const errorsForCard = validateAgainstDescriptor(
      recordPaymentParams,
      { amount: 60, currency: 'EUR', paidAt: '2026-08-30', method: 'card' },
      fieldKindRegistry,
    );
    expect(errorsForCard).toHaveLength(1);
    expect(errorsForCard[0].key).toBe('method');
  });

  it('`method` stays OPTIONAL, exactly as before — a payment can still be recorded with none at all', () => {
    const errors = validateAgainstDescriptor(
      recordPaymentParams,
      { amount: 60, currency: 'EUR', paidAt: '2026-08-30' },
      fieldKindRegistry,
    );
    expect(errors).toEqual([]);
  });

  it('the REAL invoice descriptor renders BYTE-FOR-BYTE the same PDF an upgrading install already had — no "Payment methods" section for a company that has enabled none', () => {
    const html = renderDocumentHtml({
      descriptor,
      instance: {
        id: 'doc-1',
        status: 'sent',
        data: {
          currency: 'EUR',
          client: 'client-1',
          issueDate: '2026-08-30',
          dueDate: '2026-09-30',
          lines: [],
        },
        createdAt: new Date('2026-08-30'),
      },
      company: { name: 'Acme Corp' },
      referenceLabels: {},
      // The upgrading-install case: nothing resolved for `paymentMethods` at all — exactly what
      // `renderDocumentInstance` produces for a company that has never opened the new screen
      // (`resolveEnabledPaymentMethodPresentations` returns `[]`, see persistence.spec.ts).
      paymentMethods: [],
    });

    expect(html).not.toContain('class="payment-methods-section"');
    expect(html).not.toContain('Payment methods');
  });
});
