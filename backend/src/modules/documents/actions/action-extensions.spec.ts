import { ActionExtensionRegistry } from './action-extensions';

describe('ActionExtensionRegistry', () => {
  it('lists nothing for a type nobody has extended', () => {
    expect(new ActionExtensionRegistry().listFor('quote')).toEqual([]);
  });

  it('lists an action a third party attached to an existing type', () => {
    const registry = new ActionExtensionRegistry();
    registry.register('quote', { id: 'duplicate', label: 'Duplicate', availableWhen: ['draft', 'sent'] });

    expect(registry.listFor('quote')).toEqual([
      { id: 'duplicate', label: 'Duplicate', availableWhen: ['draft', 'sent'] },
    ]);
  });

  it('keeps extensions scoped to the type they were declared for', () => {
    const registry = new ActionExtensionRegistry();
    registry.register('quote', { id: 'duplicate', label: 'Duplicate', availableWhen: 'always' });

    expect(registry.listFor('invoice')).toEqual([]);
  });

  it('preserves registration order across multiple extensions of the same type', () => {
    const registry = new ActionExtensionRegistry();
    registry.register('quote', { id: 'duplicate', label: 'Duplicate', availableWhen: 'always' });
    registry.register('quote', { id: 'archive', label: 'Archive', availableWhen: ['sent'] });

    expect(registry.listFor('quote').map((a) => a.id)).toEqual(['duplicate', 'archive']);
  });

  it('refuses declaring the same action id twice for the same type', () => {
    const registry = new ActionExtensionRegistry();
    registry.register('quote', { id: 'duplicate', label: 'Duplicate', availableWhen: 'always' });

    expect(() =>
      registry.register('quote', { id: 'duplicate', label: 'Duplicate again', availableWhen: 'always' }),
    ).toThrow(/already declared/);
  });

  it("carries an action's own params vocabulary through untouched", () => {
    const registry = new ActionExtensionRegistry();
    registry.register('quote', {
      id: 'send-copy',
      label: 'Send a copy',
      availableWhen: ['draft'],
      params: [{ key: 'recipient', kind: 'text', label: 'Recipient', required: true }],
    });

    expect(registry.listFor('quote')[0].params).toEqual([
      { key: 'recipient', kind: 'text', label: 'Recipient', required: true },
    ]);
  });
});
