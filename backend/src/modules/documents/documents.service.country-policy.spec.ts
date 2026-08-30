import { ConflictException, ForbiddenException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerInvoiceActions } from './actions/invoice-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./country-policy/country-policy');

/**
 * Proves the COMPOSITION documents.service.ts's `runAction` now does: country policy × current
 * status (`availableWhen`) × implementation existing. Every other spec in this directory mocks
 * `evaluateCountryPolicy` to a blanket `{ allowed: true }` so it can keep testing what it always
 * tested; THIS file is the one that actually exercises the decisions `runAction` makes about the
 * policy result it's handed. The DECISION LOGIC itself (what a real company/country/rule set
 * resolves to) is proven separately, against the real code, in
 * country-policy/country-policy.spec.ts — mocking it here is deliberate: this file's only job is
 * "does DocumentsService respect whatever the policy says", not "is the policy itself correct".
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const transportRegistry = new TransportRegistry();
  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, { transportRegistry });

  const actionExtensionRegistry = new ActionExtensionRegistry();
  const referenceRegistry = new EntityReferenceRegistry();

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    actionExtensionRegistry,
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
}

const validInvoiceData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  dueDate: '2026-01-31',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unit: 'unit', unitPrice: 9.9, vatRate: '20' }],
};

describe('DocumentsService.runAction — composed with the country policy', () => {
  afterEach(() => jest.resetAllMocks());

  it('refuses an action the country policy forbids with 403 — even one that is "always" available and implemented', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'No document action policy is declared for "ZZ".',
    });

    const service = buildService();
    const action = service.runAction('company-1', 'invoice', 'save-draft', { data: validInvoiceData });

    await expect(action).rejects.toBeInstanceOf(ForbiddenException);
    await expect(action).rejects.toThrow(/No document action policy is declared for "ZZ"/);
    // Blocked before ever touching persistence — a 403 must never be a "mostly ran" state.
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('checks the country policy BEFORE the status check — a forbidden action is refused even on a status that would satisfy availableWhen', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'forbidden for "ZZ"',
    });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft', // "send"'s own availableWhen — would otherwise pass.
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService();
    const action = service.runAction('company-1', 'invoice', 'send', {
      documentId: 'doc-1',
      data: validInvoiceData,
    });

    await expect(action).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("an action the country policy ALLOWS but that is unavailable for the record's current status is still refused — 409, not a policy bypass", async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft', // "record-payment" is only available for "sent".
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService();
    await expect(
      service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('an action the country policy allows, available for the status, still 501s with no implementation registered', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService();
    await expect(
      service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
      }),
    ).rejects.toThrow(/no registered implementation/);
  });

  it('an action the country policy allows, available, and implemented actually runs', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService();
    const result = await service.runAction('company-1', 'invoice', 'save-draft', {
      data: validInvoiceData,
    });

    expect(result.changed).toBe(true);
    expect(countryPolicy.evaluateCountryPolicy).toHaveBeenCalledWith('company-1', 'invoice', 'save-draft');
  });

  describe('describeTypeForCompany — the frontend-facing view', () => {
    it('leaves an allowed action untouched, and annotates a forbidden one with policyBlockedReason', async () => {
      (countryPolicy.evaluateCountryPolicy as jest.Mock).mockImplementation(
        async (_companyId: string, _typeId: string, actionId: string) =>
          actionId === 'send' ? { allowed: false, reason: 'forbidden for "ZZ"' } : { allowed: true },
      );

      const service = buildService();
      const descriptor = await service.describeTypeForCompany('company-1', 'invoice');

      const saveDraft = descriptor.actions.find((a) => a.id === 'save-draft');
      const send = descriptor.actions.find((a) => a.id === 'send');

      expect(saveDraft?.policyBlockedReason).toBeUndefined();
      expect(send?.policyBlockedReason).toBe('forbidden for "ZZ"');
      // The underlying declared shape (label, availableWhen, …) is untouched — this is an ADDITIVE
      // annotation, never a rewrite of the descriptor's own data.
      expect(send).toMatchObject({ id: 'send', label: 'Send', availableWhen: ['draft'] });
    });
  });
});
