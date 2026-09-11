import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { transitionsAvailableWhen } from './descriptors/lifecycle';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { DocumentActionTransition, DocumentTypeDescriptor } from './descriptors/types';
import * as takeNumber from './numbering/take-number';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as stock from './stock/apply-stock-on-issuance';
import { TransportRegistry } from './transports/transport-registry';

/**
 * Proves documents.service.ts's runAction WIRING for the stock effect (TODO_FEATURES.md rank 18) —
 * never `apply-stock-on-issuance.ts`'s own computation/persistence, which
 * `stock/apply-stock-on-issuance.spec.ts` already proves on its own. This file only proves: WHEN
 * runAction calls `applyStockOnIssuance`, and when it deliberately does NOT — mocking
 * `./stock/apply-stock-on-issuance` wholesale, the exact same discipline
 * `documents.service.numbering.spec.ts` already holds for `./numbering/take-number` (and for the same
 * reason: this file cares about the CALL, not the DB work behind it). Built on a synthetic "widget"
 * type, never "invoice", to prove the effect is type-agnostic — the same discipline the numbering
 * spec's own header already documents for numbering itself.
 */
jest.mock('./persistence');
jest.mock('./country-policy/country-policy');
jest.mock('./numbering/take-number');
jest.mock('./stock/apply-stock-on-issuance');

const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [{ from: ['draft'], to: 'sent' }];

/** A "widget" numbered on entering "sent" — mirrors quote/invoice.descriptor.ts's own
 *  `numbering: { onEnterStatus: 'sent' }`, on a synthetic type never named "quote"/"invoice"/
 *  "article" — proving the stock effect never keys off a type name, only off lines/articleId. */
function numberedWidgetDescriptor(overrides: Partial<DocumentTypeDescriptor> = {}): DocumentTypeDescriptor {
  return {
    id: 'widget',
    label: 'Widget',
    fields: [],
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sent', label: 'Sent' },
    ],
    initialStatus: 'draft',
    numbering: { onEnterStatus: 'sent' },
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
    ],
    ...overrides,
  };
}

/** The "expense" shape: same lifecycle skeleton, but NO `numbering` declared at all — proves the
 *  stock effect never fires for a type with no issuance moment to hang off, exactly like numbering
 *  itself never does. */
function unnumberedWidgetDescriptor(): DocumentTypeDescriptor {
  const { numbering: _drop, ...rest } = numberedWidgetDescriptor();
  return rest;
}

function buildService(descriptor: DocumentTypeDescriptor, actionRegistry: ActionRegistry) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(descriptor);

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

function registerSendHandler(
  actionRegistry: ActionRegistry,
  resultStatus = 'sent',
  resultNumber: number | null = null,
  data: Record<string, unknown> = {},
) {
  actionRegistry.register('widget', 'send', async ({ companyId, typeId, documentId }) => ({
    document: await persistence.upsertDocument(companyId, typeId, documentId, resultStatus, data),
    changed: true,
  }));
  (persistence.upsertDocument as jest.Mock).mockResolvedValue({
    id: 'doc-1',
    typeId: 'widget',
    status: resultStatus,
    number: resultNumber,
    displayNumber: resultNumber ? `WIDGET-2026-000${resultNumber}` : null,
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('DocumentsService.runAction — stock-effect wiring (TODO_FEATURES.md rank 18)', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => jest.resetAllMocks());

  it('calls applyStockOnIssuance when a synchronous action actually TAKES the number (tied to the `numbered` winner, not the in-memory gate alone)', async () => {
    const actionRegistry = new ActionRegistry();
    const lines = [{ articleId: 'article-1', quantity: 4 }];
    registerSendHandler(actionRegistry, 'sent', null, { lines });

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue({
      number: 1,
      displayNumber: 'WIDGET-2026-0001',
    });

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(stock.applyStockOnIssuance).toHaveBeenCalledTimes(1);
    expect(stock.applyStockOnIssuance).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ id: 'doc-1', data: { lines } }),
    );
  });

  it('NEVER calls applyStockOnIssuance for an action landing on a status other than `onEnterStatus` (e.g. "save-draft" -> "draft")', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'save-draft', async ({ companyId, typeId, documentId, data }) => ({
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'draft', data),
      changed: true,
    }));
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: { lines: [{ articleId: 'article-1', quantity: 4 }] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    await service.runAction('company-1', 'widget', 'save-draft', { data: {} });

    expect(stock.applyStockOnIssuance).not.toHaveBeenCalled();
  });

  // THE mutation target for "never twice": a re-send of an ALREADY-numbered record (see
  // documents.service.numbering.spec.ts's identical test for the full "why draft is the reachable
  // path back to send" reasoning) must not decrement stock a second time either — proving the stock
  // effect rides the SAME once-only gate as the number, not a copy of it re-evaluated after the
  // numbering block above already mutated `result.document.number`.
  it('a record that already has a number is NEVER decremented again by a later "send" (re-send stays a no-op for stock)', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', 1, { lines: [{ articleId: 'article-1', quantity: 4 }] });

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: 1,
      displayNumber: 'WIDGET-2026-0001',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(stock.applyStockOnIssuance).not.toHaveBeenCalled();
  });

  it('a type with NO `numbering` declared NEVER gets the stock effect either, even reaching the same "sent" status', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null, { lines: [{ articleId: 'article-1', quantity: 4 }] });

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(unnumberedWidgetDescriptor(), actionRegistry);
    await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(stock.applyStockOnIssuance).not.toHaveBeenCalled();
  });

  it('a concurrent race (takeDocumentNumberForTransition resolves to undefined) does NOT fire the stock effect — only the caller that atomically WON the number decrements, never the loser', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null, { lines: [{ articleId: 'article-1', quantity: 4 }] });

    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // The race LOSER: the other request already took the number between the in-memory gate and the
    // atomic write, so `takeDocumentNumberForTransition` returns undefined here. The stock effect is
    // tied to `numbered` being truthy (the winner), so this caller must NOT decrement — the winning
    // caller (or the send worker in `send-document-email.ts`) already did. This is what prevents a
    // double-decrement; the earlier implementation fired here too, which was the bug.
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(stock.applyStockOnIssuance).not.toHaveBeenCalled();
  });
});
