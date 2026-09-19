import {
  checkTransitionResult,
  findUndeclaredStatusInstances,
  resolveTransitionTarget,
  transitionsAvailableWhen,
  validateLifecycle,
} from './lifecycle';
import { DocumentTypeRegistry } from './type-registry';
import { DocumentActionDescriptor, DocumentActionTransition, DocumentTypeDescriptor } from './types';

/**
 * A synthetic type — never named "quote"/"invoice"/anything real — proving the LIFECYCLE mechanism
 * itself, independently of any one shipped document type. `descriptors/quote.descriptor.ts` and its
 * siblings prove the REAL descriptors declare a lifecycle faithful to their own handlers; this file
 * proves the generic machine they are all built on.
 */
const DRAFT_TO_SENT: DocumentActionTransition[] = [{ from: ['draft'], to: 'sent' }];
const ALWAYS_TO_DRAFT: DocumentActionTransition[] = [{ from: 'always', to: 'draft' }];

function widgetDescriptor(overrides: Partial<DocumentTypeDescriptor> = {}): DocumentTypeDescriptor {
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
        transitions: ALWAYS_TO_DRAFT,
        availableWhen: transitionsAvailableWhen(ALWAYS_TO_DRAFT),
      },
      {
        id: 'send',
        label: 'Send',
        transitions: DRAFT_TO_SENT,
        availableWhen: transitionsAvailableWhen(DRAFT_TO_SENT),
      },
      // No `transitions` at all — its own effect, if any, lands elsewhere (the "convert-to-invoice"/
      // "duplicate" shape) — the record it acts on keeps its own status untouched.
      { id: 'annotate', label: 'Annotate', availableWhen: ['draft', 'sent'] },
    ],
    ...overrides,
  };
}

function findAction(descriptor: DocumentTypeDescriptor, id: string): DocumentActionDescriptor {
  const action = descriptor.actions.find((a) => a.id === id);
  if (!action) throw new Error(`test fixture bug: no action "${id}"`);
  return action;
}

describe('transitionsAvailableWhen', () => {
  it('derives the union of every from-list across transitions', () => {
    expect(
      transitionsAvailableWhen([
        { from: ['draft'], to: 'sent' },
        { from: ['sent'], to: 'archived' },
      ]),
    ).toEqual(expect.arrayContaining(['draft', 'sent']));
  });

  it('deduplicates a status named by more than one transition', () => {
    expect(
      transitionsAvailableWhen([
        { from: ['draft'], to: 'sent' },
        { from: ['draft'], to: 'void' },
      ]),
    ).toEqual(['draft']);
  });

  it('"always" wins over any other entry', () => {
    expect(
      transitionsAvailableWhen([
        { from: ['draft'], to: 'sent' },
        { from: 'always', to: 'draft' },
      ]),
    ).toBe('always');
  });
});

describe('resolveTransitionTarget', () => {
  const descriptor = widgetDescriptor();

  it('resolves the declared target for a matching starting status', () => {
    expect(resolveTransitionTarget(findAction(descriptor, 'send'), 'draft')).toBe('sent');
  });

  it('returns undefined when no transition matches the given starting status', () => {
    expect(resolveTransitionTarget(findAction(descriptor, 'send'), 'sent')).toBeUndefined();
  });

  it('"always" matches even a brand-new, never-saved record (fromStatus undefined)', () => {
    expect(resolveTransitionTarget(findAction(descriptor, 'save-draft'), undefined)).toBe('draft');
  });

  it('returns undefined for an action that declares no transitions at all', () => {
    expect(resolveTransitionTarget(findAction(descriptor, 'annotate'), 'draft')).toBeUndefined();
  });

  // The shape an asynchronous "send" needs (TODO item 22, documents/queue/): the SAME transition,
  // from the SAME starting status, may honestly land on more than one outcome (delivery succeeds or,
  // once every retry is exhausted, fails) — `to` is then an array, and this resolves to it VERBATIM
  // (never collapsed to a single guess), so a caller can decide "is the actual status one of these".
  it('resolves to an ARRAY of every allowed outcome when the transition declares more than one', () => {
    const multiOutcome: DocumentActionTransition[] = [{ from: ['sending'], to: ['sent', 'send_failed'] }];
    const action: DocumentActionDescriptor = {
      id: 'send',
      label: 'Send',
      transitions: multiOutcome,
      availableWhen: transitionsAvailableWhen(multiOutcome),
    };

    expect(resolveTransitionTarget(action, 'sending')).toEqual(['sent', 'send_failed']);
  });
});

describe('validateLifecycle — boot-time coherence', () => {
  it('is a no-op for a descriptor that never declares `statuses` at all', () => {
    expect(() =>
      validateLifecycle({ id: 'x', label: 'X', fields: [], actions: [] } as DocumentTypeDescriptor),
    ).not.toThrow();
  });

  it('accepts a faithfully-declared lifecycle', () => {
    expect(() => validateLifecycle(widgetDescriptor())).not.toThrow();
  });

  it('THE mutation target: a transition referencing an undeclared status fails loudly, at load time', () => {
    const broken = widgetDescriptor({
      actions: [
        {
          id: 'archive',
          label: 'Archive',
          transitions: [{ from: ['sent'], to: 'archived' }], // "archived" is not in `statuses` below
          availableWhen: ['sent'],
        },
      ],
    });

    expect(() => validateLifecycle(broken)).toThrow(/not declared in "statuses"/);
  });

  it('also fails when the `from` side of a transition names an undeclared status', () => {
    const broken = widgetDescriptor({
      actions: [
        {
          id: 'restore',
          label: 'Restore',
          transitions: [{ from: ['archived'], to: 'draft' }],
          availableWhen: ['archived'],
        },
      ],
    });

    expect(() => validateLifecycle(broken)).toThrow(/not declared in "statuses"/);
  });

  it('fails when `initialStatus` is not one of the declared `statuses`', () => {
    const broken = widgetDescriptor({ initialStatus: 'archived' });
    expect(() => validateLifecycle(broken)).toThrow(/initialStatus/);
  });

  it('fails when a hand-typed `availableWhen` drifts from what its own `transitions` imply', () => {
    const broken = widgetDescriptor({
      actions: [
        {
          id: 'send',
          label: 'Send',
          transitions: DRAFT_TO_SENT, // implies availableWhen: ['draft']
          availableWhen: ['draft', 'sent'], // hand-typed, and wrong
        },
      ],
    });

    expect(() => validateLifecycle(broken)).toThrow(/must be DERIVED from transitions/);
  });

  it('fails when a transitions-less action names an undeclared status in `availableWhen`', () => {
    const broken = widgetDescriptor({
      actions: [{ id: 'annotate', label: 'Annotate', availableWhen: ['archived'] }],
    });

    expect(() => validateLifecycle(broken)).toThrow(/not declared in "statuses"/);
  });

  describe('a transition with more than one honest outcome (`to` as an array)', () => {
    it('accepts it once every one of its outcomes is a declared status', () => {
      const multiOutcome: DocumentActionTransition[] = [
        { from: ['draft'], to: 'sending' },
        { from: ['sending'], to: ['sent', 'send_failed'] },
      ];
      const withSending = widgetDescriptor({
        statuses: [
          { id: 'draft', label: 'Draft' },
          { id: 'sending', label: 'Sending' },
          { id: 'sent', label: 'Sent' },
          { id: 'send_failed', label: 'Send failed' },
        ],
        actions: [
          {
            id: 'send',
            label: 'Send',
            transitions: multiOutcome,
            availableWhen: transitionsAvailableWhen(multiOutcome),
          },
        ],
      });

      expect(() => validateLifecycle(withSending)).not.toThrow();
    });

    it('fails as soon as ONE of the array outcomes is not a declared status', () => {
      const multiOutcome: DocumentActionTransition[] = [
        { from: ['sending'], to: ['sent', 'send_failed'] }, // "send_failed" never declared below
      ];
      const broken = widgetDescriptor({
        statuses: [
          { id: 'draft', label: 'Draft' },
          { id: 'sending', label: 'Sending' },
          { id: 'sent', label: 'Sent' },
        ],
        actions: [
          {
            id: 'send',
            label: 'Send',
            transitions: multiOutcome,
            availableWhen: transitionsAvailableWhen(multiOutcome),
          },
        ],
      });

      expect(() => validateLifecycle(broken)).toThrow(/not declared in "statuses"/);
    });
  });

  // Not just the pure function — the REAL wiring a descriptor actually goes through in production
  // (documents.module.ts's buildDocumentTypeRegistry) and in every other spec in this directory
  // (`typeRegistry.register(...)`). Exercising `validateLifecycle` in isolation would prove nothing
  // about whether it is actually CALLED from there.
  it('DocumentTypeRegistry.register() calls validateLifecycle for real — a broken descriptor never gets registered', () => {
    const registry = new DocumentTypeRegistry();
    const broken = widgetDescriptor({
      actions: [
        {
          id: 'archive',
          label: 'Archive',
          transitions: [{ from: ['sent'], to: 'archived' }],
          availableWhen: ['sent'],
        },
      ],
    });

    expect(() => registry.register(broken)).toThrow(/not declared in "statuses"/);
    expect(registry.has('widget')).toBe(false);
  });

  describe('numbering — `onEnterStatus` must name a declared status', () => {
    it('accepts `numbering.onEnterStatus` naming a real, declared status', () => {
      expect(() =>
        validateLifecycle(widgetDescriptor({ numbering: { onEnterStatus: 'sent' } })),
      ).not.toThrow();
    });

    // THE mutation target: a typo'd (or simply never-declared) onEnterStatus fails loudly, at load
    // time — the exact same discipline `initialStatus` and a transition's own `to`/`from` already get.
    it('fails when `numbering.onEnterStatus` names a status this type never declared', () => {
      const broken = widgetDescriptor({ numbering: { onEnterStatus: 'archived' } });
      expect(() => validateLifecycle(broken)).toThrow(
        /numbering\.onEnterStatus.*not one of its own declared statuses/,
      );
    });

    it('fails when `numbering` is declared but the type has no `statuses` at all', () => {
      const broken: DocumentTypeDescriptor = {
        id: 'no-lifecycle',
        label: 'No lifecycle',
        fields: [],
        actions: [],
        numbering: { onEnterStatus: 'sent' },
      };
      expect(() => validateLifecycle(broken)).toThrow(/declares "numbering" but no "statuses" at all/);
    });

    it('a descriptor with no `numbering` at all is untouched by this check (e.g. "expense")', () => {
      expect(() => validateLifecycle(widgetDescriptor())).not.toThrow();
    });
  });
});

describe('checkTransitionResult — request-time enforcement', () => {
  const descriptor = widgetDescriptor();

  it('a handler landing on the declared transition target is not a violation', () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'send'),
      'doc-1',
      'draft',
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toBeUndefined();
  });

  // THE mutation target #1: a handler persists a status the declared transition never named.
  it('a handler writing a status OTHER than the declared transition target is a violation', () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'send'),
      'doc-1',
      'draft',
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status: 'archived', // "send" declares draft -> sent, never -> archived
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toEqual({ expectedStatuses: ['sent'], actualStatus: 'archived' });
  });

  it('an action with NO declared transition does not change status — passes when the handler leaves it alone', () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'annotate'),
      'doc-1',
      'sent',
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toBeUndefined();
  });

  it('an action with NO declared transition is STILL caught if a handler changes the status anyway', () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'annotate'),
      'doc-1',
      'sent',
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status: 'draft',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toEqual({ expectedStatuses: ['sent'], actualStatus: 'draft' });
  });

  it("a brand-new record (no documentId before) must start at the type's own initialStatus", () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'save-draft'),
      undefined,
      undefined,
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status: 'draft',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toBeUndefined();
  });

  it('a brand-new record starting anywhere OTHER than initialStatus is a violation', () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'save-draft'),
      undefined,
      undefined,
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status: 'sent',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toEqual({ expectedStatuses: ['draft'], actualStatus: 'sent' });
  });

  it('a DIFFERENT document (another id, same type) created as a side effect is checked against initialStatus too', () => {
    // The "duplicate" shape: acts on doc-1, but the RESULT is a brand-new doc-2.
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'annotate'),
      'doc-1',
      'sent',
      {
        changed: true,
        document: {
          id: 'doc-2',
          typeId: 'widget',
          status: 'draft',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toBeUndefined();
  });

  it('a result naming a DIFFERENT document TYPE is out of scope entirely — never inspected', () => {
    // The "convert-to-invoice" shape: a "widget" action whose result is some OTHER type's document.
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'annotate'),
      'doc-1',
      'draft',
      {
        changed: true,
        document: {
          id: 'other-1',
          typeId: 'gadget',
          status: 'anything-goes',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toBeUndefined();
  });

  it('a result with no document at all is out of scope (e.g. "delete")', () => {
    const violation = checkTransitionResult(
      descriptor,
      'widget',
      findAction(descriptor, 'annotate'),
      'doc-1',
      'draft',
      {
        changed: true,
      },
    );

    expect(violation).toBeUndefined();
  });

  describe('a transition with more than one honest outcome (`to` as an array) — the async "send" shape', () => {
    const multiOutcome: DocumentActionTransition[] = [
      { from: ['draft'], to: 'sending' },
      { from: ['sending'], to: ['sent', 'send_failed'] },
    ];
    const asyncSendDescriptor = widgetDescriptor({
      statuses: [
        { id: 'draft', label: 'Draft' },
        { id: 'sending', label: 'Sending' },
        { id: 'sent', label: 'Sent' },
        { id: 'send_failed', label: 'Send failed' },
      ],
      actions: [
        {
          id: 'send',
          label: 'Send',
          transitions: multiOutcome,
          availableWhen: transitionsAvailableWhen(multiOutcome),
        },
      ],
    });
    const sendAction = findAction(asyncSendDescriptor, 'send');

    function resultAt(status: string) {
      return {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'widget',
          status,
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
    }

    it('landing on EITHER declared outcome from the shared starting status is accepted — success', () => {
      const violation = checkTransitionResult(
        asyncSendDescriptor,
        'widget',
        sendAction,
        'doc-1',
        'sending',
        resultAt('sent'),
      );
      expect(violation).toBeUndefined();
    });

    // THE mutation target #2 lives one layer up (queue/mark-send-failed.ts actually persisting
    // "send_failed"), but the LIFECYCLE half of that guarantee is proven right here: this file's own
    // job is only to confirm the declared transition genuinely ALLOWS this second outcome too.
    it('landing on EITHER declared outcome from the shared starting status is accepted — the failure branch', () => {
      const violation = checkTransitionResult(
        asyncSendDescriptor,
        'widget',
        sendAction,
        'doc-1',
        'sending',
        resultAt('send_failed'),
      );
      expect(violation).toBeUndefined();
    });

    it('a status OUTSIDE both declared outcomes is still caught, naming every status that WOULD have been accepted', () => {
      const violation = checkTransitionResult(
        asyncSendDescriptor,
        'widget',
        sendAction,
        'doc-1',
        'sending',
        resultAt('draft'), // neither "sent" nor "send_failed"
      );
      expect(violation).toEqual({ expectedStatuses: ['sent', 'send_failed'], actualStatus: 'draft' });
    });
  });

  it('is a no-op for a descriptor that never declares a lifecycle at all', () => {
    const noLifecycle: DocumentTypeDescriptor = { id: 'x', label: 'X', fields: [], actions: [] };
    const violation = checkTransitionResult(
      noLifecycle,
      'x',
      { id: 'whatever', label: 'Whatever', availableWhen: 'always' },
      undefined,
      undefined,
      {
        changed: true,
        document: {
          id: 'doc-1',
          typeId: 'x',
          status: 'anything',
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    expect(violation).toBeUndefined();
  });
});

describe('findUndeclaredStatusInstances — the "no silent migration gap" check', () => {
  const descriptor = widgetDescriptor(); // statuses: draft, sent

  it('flags a persisted status no declaration covers', () => {
    const violations = findUndeclaredStatusInstances(
      (typeId) => (typeId === 'widget' ? descriptor : undefined),
      [
        { typeId: 'widget', status: 'draft' },
        { typeId: 'widget', status: 'archived' }, // never declared
      ],
    );

    expect(violations).toEqual([{ typeId: 'widget', status: 'archived' }]);
  });

  it('every declared status — the faithful case — flags nothing', () => {
    const violations = findUndeclaredStatusInstances(
      (typeId) => (typeId === 'widget' ? descriptor : undefined),
      [
        { typeId: 'widget', status: 'draft' },
        { typeId: 'widget', status: 'sent' },
      ],
    );

    expect(violations).toEqual([]);
  });

  it('skips a type the registry cannot resolve at all — a stray row for a type this build no longer registers', () => {
    const violations = findUndeclaredStatusInstances(
      () => undefined,
      [{ typeId: 'ghost-type', status: 'whatever' }],
    );

    expect(violations).toEqual([]);
  });

  it('skips a type that never declared a lifecycle at all (opted out, same as validateLifecycle grants)', () => {
    const noLifecycle: DocumentTypeDescriptor = { id: 'x', label: 'X', fields: [], actions: [] };
    const violations = findUndeclaredStatusInstances(
      (typeId) => (typeId === 'x' ? noLifecycle : undefined),
      [{ typeId: 'x', status: 'anything-at-all' }],
    );

    expect(violations).toEqual([]);
  });
});
