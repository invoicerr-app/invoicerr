import { ConflictException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { transitionsAvailableWhen } from './descriptors/lifecycle';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { DocumentActionTransition, DocumentTypeDescriptor } from './descriptors/types';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// See documents.service.spec.ts's own comment on this mock — the real decision code is proven
// separately (country-policy/country-policy.spec.ts). Reinstalled to "allowed" in beforeEach since
// `afterEach(() => jest.resetAllMocks())` wipes it after the first test.
jest.mock('./country-policy/country-policy');

/**
 * Proves documents.service.ts's runAction ENFORCES the lifecycle a descriptor declares — the request-
 * time half of the mechanism `descriptors/lifecycle.spec.ts` proves in isolation. THIS file exercises
 * the REAL `DocumentsService.runAction`, with a hand-rolled ActionRegistry handler standing in for a
 * buggy one: mocking `checkTransitionResult` itself here would prove nothing about whether runAction
 * actually calls it — the exact false-green shape this repository has already found once (see the
 * project MEMORY on it, and documents.service.country-policy.spec.ts's own header for the same split).
 */
const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [{ from: ['draft'], to: 'sent' }];

function buildWidgetDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'widget',
    label: 'Widget',
    fields: [],
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sent', label: 'Sent' },
    ],
    initialStatus: 'draft',
    actions: [
      {
        id: 'save-draft',
        label: 'Save draft',
        transitions: SAVE_DRAFT_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SAVE_DRAFT_TRANSITIONS),
      },
      {
        id: 'send',
        label: 'Send',
        transitions: SEND_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SEND_TRANSITIONS),
      },
      // No transitions — mirrors "convert-to-invoice"/"record-payment": gated by status, but never
      // declares a status effect of its own.
      { id: 'annotate', label: 'Annotate', availableWhen: ['draft', 'sent'] },
    ],
  };
}

function buildService(actionRegistry: ActionRegistry) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildWidgetDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

describe('DocumentsService.runAction — lifecycle enforcement', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => jest.resetAllMocks());

  it('accepts a handler that persists exactly the declared transition target', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'send', async ({ companyId, typeId, documentId, data }) => ({
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'sent', data),
      changed: true,
    }));

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'send', {
      documentId: 'doc-1',
      data: {},
    });

    expect(result.document).toMatchObject({ status: 'sent' });
  });

  // THE mutation target: a handler that persists a status its own action's `transitions` never
  // declared. Faithful to a REAL bug shape — someone hand-edits the handler's hardcoded status string
  // without updating the descriptor (or vice versa).
  it('refuses a handler that persists a status OUTSIDE its declared transition, and says so', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'send', async ({ companyId, typeId, documentId, data }) => ({
      // BUG: "send" declares draft -> sent, this handler writes "archived" instead.
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'archived', data),
      changed: true,
    }));

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'archived',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(actionRegistry);
    const action = service.runAction('company-1', 'widget', 'send', {
      documentId: 'doc-1',
      data: {},
    });

    await expect(action).rejects.toThrow(/wrote status "archived".*requires "sent"/);
  });

  it('an action with NO declared transition ("annotate") does not change status — a faithful handler passes', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'annotate', async ({ companyId, typeId, documentId, data }) => ({
      // Leaves the status exactly as it was — "annotate" declares no transition at all.
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'sent', data),
      changed: true,
    }));

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'annotate', {
      documentId: 'doc-1',
      data: {},
    });

    expect(result.changed).toBe(true);
  });

  it('an action with NO declared transition is STILL refused if a handler changes the status anyway', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'annotate', async ({ companyId, typeId, documentId, data }) => ({
      // BUG: "annotate" declares no transition — it must never change the record's own status.
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'draft', data),
      changed: true,
    }));

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(actionRegistry);
    const action = service.runAction('company-1', 'widget', 'annotate', {
      documentId: 'doc-1',
      data: {},
    });

    await expect(action).rejects.toThrow(/wrote status "draft".*requires "sent"/);
  });

  it('a brand-new record must start at the initial status — a handler creating one elsewhere is untouched', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'save-draft', async ({ companyId, typeId, documentId, data }) => ({
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'draft', data),
      changed: true,
    }));

    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'save-draft', { data: {} });

    expect(result.document).toMatchObject({ status: 'draft' });
  });

  it('a country-policy per-status restriction blocks the action at a status it does not cover — 409, not 403', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: true,
      restrictedToStatuses: ['draft'],
    });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent', // outside the country's own restriction
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(new ActionRegistry());
    const action = service.runAction('company-1', 'widget', 'annotate', {
      documentId: 'doc-1',
      data: {},
    });

    await expect(action).rejects.toBeInstanceOf(ConflictException);
    await expect(action).rejects.toThrow(/restricted by this company's country policy to status\(es\) draft/);
  });

  it('the SAME country-policy restriction allows the action at a status it DOES cover', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: true,
      restrictedToStatuses: ['draft'],
    });
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'annotate', async ({ companyId, typeId, documentId, data }) => ({
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'draft', data),
      changed: true,
    }));

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft', // covered by the restriction this time
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'annotate', {
      documentId: 'doc-1',
      data: {},
    });

    expect(result.changed).toBe(true);
  });

  describe('describeTypeForCompany — the country restriction is its OWN field, never folded into availableWhen', () => {
    it("carries the country's restrictedToStatuses as policyRestrictedToStatuses, leaving availableWhen untouched", async () => {
      (countryPolicy.evaluateCountryPolicy as jest.Mock).mockImplementation(
        async (_companyId: string, _typeId: string, actionId: string) =>
          actionId === 'annotate' ? { allowed: true, restrictedToStatuses: ['draft'] } : { allowed: true },
      );

      const service = buildService(new ActionRegistry());
      const descriptor = await service.describeTypeForCompany('company-1', 'widget');

      const annotate = descriptor.actions.find((a) => a.id === 'annotate');
      const send = descriptor.actions.find((a) => a.id === 'send');

      // THE regression this shape fixes: `availableWhen` is the descriptor's OWN, unmodified fact —
      // an earlier version of this method intersected the restriction straight into it, which for an
      // "always"-available action (see save-draft below) silently ALSO revoked a brand-new record's
      // own allowance (a plain array can never match an undefined status). Caught live by
      // 17-document-descriptor.cy.ts's "at least one action is offered" check on a fresh record.
      expect(annotate?.availableWhen).toEqual(['draft', 'sent']);
      expect(annotate?.policyRestrictedToStatuses).toEqual(['draft']);
      // Untouched: "send" was not restricted by this mock — no field at all, not an empty array.
      expect(send?.availableWhen).toEqual(['draft']);
      expect(send?.policyRestrictedToStatuses).toBeUndefined();
    });

    it('an "always"-available action restricted by the country STAYS offered for a brand-new, never-saved record', async () => {
      (countryPolicy.evaluateCountryPolicy as jest.Mock).mockImplementation(
        async (_companyId: string, _typeId: string, actionId: string) =>
          actionId === 'save-draft' ? { allowed: true, restrictedToStatuses: ['draft'] } : { allowed: true },
      );

      const service = buildService(new ActionRegistry());
      const descriptor = await service.describeTypeForCompany('company-1', 'widget');
      const saveDraft = descriptor.actions.find((a) => a.id === 'save-draft');

      // `availableWhen` stays 'always' — a brand-new record (frontend's `isActionAvailable(action,
      // undefined)`) is still offered the action; only an EXISTING record's status is narrowed by
      // `policyRestrictedToStatuses`, composed at the one place that reads both (types.ts, frontend).
      expect(saveDraft?.availableWhen).toBe('always');
      expect(saveDraft?.policyRestrictedToStatuses).toEqual(['draft']);
    });
  });
});
