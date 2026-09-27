import { vi, type Mock } from 'vitest';

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
vi.mock('./persistence');
vi.mock('./country-policy/country-policy');
vi.mock('./numbering/take-number');

const SAVE_DRAFT_TRANSITIONS: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];
const SEND_TRANSITIONS: DocumentActionTransition[] = [{ from: ['draft'], to: 'sent' }];

/** A "widget" numbered on entering "sent" — mirrors `quote.descriptor.ts`'s/`invoice.descriptor.ts`'s own
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

// Issue #471 - the "credit-note" shape: same lifecycle skeleton as the widget above, but with a
// THIRD status ("other") the widget itself never declares, reachable through its own "send"-like
// action ("recover"), so a test can put a fresh record at a status OTHER than "draft" or "sent"
// without touching a real credit-note descriptor at all - synthetic, on the same "widget" model
// documents.service.numbering.spec.ts already holds for everything else in this file.
const RECOVER_TRANSITIONS: DocumentActionTransition[] = [{ from: ['other'], to: 'sent' }];

/** Mirrors `credit-note.descriptor.ts`'s own `numbering: { onEnterStatus: 'sending', onlyFrom:
 *  ['draft'] }` - same restricted mechanism, on a synthetic type with an extra "other" status
 *  standing in for "send_failed" (any status this type's own lifecycle can reach "sent" FROM other
 *  than "draft"). */
function onlyFromWidgetDescriptor(): DocumentTypeDescriptor {
  const base = numberedWidgetDescriptor();
  return {
    ...base,
    statuses: [...base.statuses!, { id: 'other', label: 'Other' }],
    numbering: { onEnterStatus: 'sent', onlyFrom: ['draft'] },
    actions: [
      ...base.actions,
      {
        id: 'recover',
        label: 'Recover',
        transitions: RECOVER_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(RECOVER_TRANSITIONS),
      },
    ],
  };
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
  (persistence.upsertDocument as Mock).mockResolvedValue({
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
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.resetAllMocks());

  it('takes a number the first time a record enters `numbering.onEnterStatus` — null before, a real number after', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null); // handler's own write carries no number yet

    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue({
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
    (persistence.upsertDocument as Mock).mockResolvedValue({
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

    (persistence.findOwnedDocument as Mock).mockResolvedValue({
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

    (persistence.findOwnedDocument as Mock).mockResolvedValue({
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

    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue(undefined);

    const service = buildService(numberedWidgetDescriptor(), actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(result.changed).toBe(true);
    expect(result.document?.number ?? null).toBeNull();
  });
});

// Issue #471 - `numbering.onlyFrom` (descriptors/types.ts), the mechanism `credit-note.descriptor.ts`
// declares to make sure a LEGACY credit note (issued before it declared `numbering` at all) is never
// numbered retroactively. Uses `onlyFromWidgetDescriptor` above rather than the real
// `buildCreditNoteDescriptor()`: this file's whole point is proving `runAction`'s WIRING in isolation
// from any one real type's own action handlers (see the file's own header) - the credit note's own
// end-to-end behaviour (including its real "send" handler) is documents.service.credit-note.spec.ts's
// job, not this one's.
describe('DocumentsService.runAction - numbering.onlyFrom wiring (issue #471)', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.resetAllMocks());

  it('numbers a record entering `onEnterStatus` FROM a status in `onlyFrom` (a genuine "draft -> sent")', async () => {
    const actionRegistry = new ActionRegistry();
    registerSendHandler(actionRegistry, 'sent', null);

    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue({
      number: 1,
      displayNumber: 'WIDGET-2026-0001',
    });

    const service = buildService(onlyFromWidgetDescriptor(), actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'send', { documentId: 'doc-1', data: {} });

    expect(takeNumber.takeDocumentNumberForTransition).toHaveBeenCalledWith('company-1', 'widget', 'doc-1');
    expect(result.document).toMatchObject({ number: 1, displayNumber: 'WIDGET-2026-0001' });
  });

  it('NEVER numbers a record entering `onEnterStatus` FROM a status NOT in `onlyFrom` - a legacy, pre-feature record', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'recover', async ({ companyId, typeId, documentId, data }) => ({
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'sent', data),
      changed: true,
    }));
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // "other" stands in for "send_failed" - a status the record held BEFORE this action ran that is
    // genuinely reachable, in a real credit note, only for a record issued before `numbering` existed
    // (see credit-note.descriptor.ts's own "Numbering" header). Still unnumbered, because the type
    // simply had no `numbering` at all back when it was actually sent.
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'other',
      number: null,
      displayNumber: null,
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(onlyFromWidgetDescriptor(), actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'recover', {
      documentId: 'doc-1',
      data: {},
    });

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(result.document?.number ?? null).toBeNull();
  });

  it('a record already numbered (numbered before "onlyFrom" ever mattered) keeps its number on a later replay, whatever it re-enters FROM', async () => {
    const actionRegistry = new ActionRegistry();
    actionRegistry.register('widget', 'recover', async ({ companyId, typeId, documentId, data }) => ({
      document: await persistence.upsertDocument(companyId, typeId, documentId, 'sent', data),
      changed: true,
    }));
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      number: 1,
      displayNumber: 'WIDGET-2026-0001',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Re-entering "sent" from "other" here too - but this record is ALREADY numbered, so `onlyFrom`
    // never even gets consulted: `number == null` is false first, the same short-circuit
    // "never twice" coverage above already proves for the unrestricted case.
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'other',
      number: 1,
      displayNumber: 'WIDGET-2026-0001',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService(onlyFromWidgetDescriptor(), actionRegistry);
    const result = await service.runAction('company-1', 'widget', 'recover', {
      documentId: 'doc-1',
      data: {},
    });

    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    expect(result.document).toMatchObject({ number: 1, displayNumber: 'WIDGET-2026-0001' });
  });
});
