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
import { TransportRegistry } from './transports/transport-registry';

/**
 * Proves documents.service.ts's runAction WIRING for numbering — never `./numbering/sequence.ts`'s
 * own atomicity, which is exercised for real against a concurrent Postgres by
 * `numbering/sequence.live.spec.ts` (see that file's own header for why a mocked test cannot prove
 * that half). This file only proves: WHEN runAction calls `takeDocumentNumberForTransition`, and
 * when it deliberately does NOT — mocking `./numbering/take-number` wholesale, the same discipline
 * `documents.service.lifecycle.spec.ts` already holds for `./persistence` and
 * `./country-policy/country-policy`.
 */
jest.mock('./persistence');
jest.mock('./country-policy/country-policy');
jest.mock('./numbering/take-number');

const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [{ from: ['draft'], to: 'sent' }];

/** A "widget" numbered on entering "sent" — mirrors quote/invoice.descriptor.ts's own
 *  `numbering: { onEnterStatus: 'sent' }`, on a synthetic type never named "quote"/"invoice". */
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

/** The "expense" shape: same lifecycle skeleton, but NO `numbering` declared at all. */
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
) {
  actionRegistry.register('widget', 'send', async ({ companyId, typeId, documentId, data }) => ({
    document: await persistence.upsertDocument(companyId, typeId, documentId, resultStatus, data),
    changed: true,
  }));
  (persistence.upsertDocument as jest.Mock).mockResolvedValue({
    id: 'doc-1',
    typeId: 'widget',
    status: resultStatus,
    number: resultNumber,
    displayNumber: resultNumber ? `WIDGET-2026-000${resultNumber}` : null,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('DocumentsService.runAction — numbering wiring', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => jest.resetAllMocks());

  it('takes a number the first time a record enters `numbering.onEnterStatus` — null before, a real number after', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null); // handler's own write carries no number yet

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
    const result = await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(takeNumber.takeDocumentNumberForTransition).toHaveBeenCalledWith('company-1', 'widget', 'doc-1');
    expect(result.document).toMatchObject({ number: 1, displayNumber: 'WIDGET-2026-0001' });
  });

  it('NEVER takes a number for an action landing on a status other than `onEnterStatus` (e.g. "save-draft" -> "draft")', async () => {
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
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    await service.runAction('company-1', 'widget', 'save-draft', { data: {} });

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
  });

  // THE mutation target for "never twice": a record that already carries a number (e.g. it was
  // "send"-numbered once, then flipped back to "draft" by "save-draft" — see quote.descriptor.ts's
  // own comment on that literal, documented behavior — a number is never cleared by that) must not
  // be renumbered (or even ask for a second number) the next time it re-enters "sent". Starting
  // status is "draft" here specifically because that IS the one reachable, real path back to "send"
  // — "send" itself is never available FROM "sent" at all (SEND_TRANSITIONS only starts at "draft"),
  // so an already-"sent", never-flipped-back record cannot call "send" a second time in the first
  // place; this test is what proves the numbering guard, not the availability guard, is what matters
  // once such a record CAN reach "send" again.
  it('a record that already has a number is NEVER renumbered by a later "send" (re-send keeps its number)', async () => {
    const actionRegistry = new ActionRegistry();
    // The persisted row's own number/displayNumber survive untouched — upsertDocument's UPDATE never
    // writes those columns (see persistence.ts) — which is exactly what this mock reproduces.
    registerSendHandler(actionRegistry, 'sent', 1);

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
    const result = await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(result.document).toMatchObject({ number: 1, displayNumber: 'WIDGET-2026-0001' });
  });

  // THE mutation target for "expense-shaped" types: a type that never declares `numbering` is never
  // numbered, EVEN THOUGH its lifecycle otherwise looks identical (same statuses, same transitions).
  it('a type with NO `numbering` declared is NEVER numbered, even reaching the same "sent" status', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null);

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
    const result = await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(result.document?.number ?? null).toBeNull();
  });

  it('a concurrent race (takeDocumentNumberForTransition resolves to undefined) leaves the response untouched, no throw', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null);

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
    (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(result.changed).toBe(true);
    expect(result.document?.number ?? null).toBeNull();
  });
});
