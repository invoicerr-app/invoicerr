import { ContributionRegistry } from './contribution-registry';

describe('ContributionRegistry', () => {
  it('resolves a handler that was registered for this (type, location) pair', async () => {
    const registry = new ContributionRegistry();
    registry.register('invoice', 'dashboard', async () => [
      { id: 'w1', kind: 'metric', label: 'Total', value: 3 },
    ]);

    const handler = registry.resolve('invoice', 'dashboard');
    expect(handler).toBeDefined();

    const widgets = await handler!({ companyId: 'c1' });
    expect(widgets).toEqual([{ id: 'w1', kind: 'metric', label: 'Total', value: 3 }]);
  });

  // The mechanism collect-widgets.ts relies on: a location declared but never registered resolves to
  // undefined, never a thrown error and never an invented empty-widgets handler — collect-widgets.ts
  // is what turns this into a visible "unimplemented" widget rather than silence.
  it('resolves to undefined for a (type, location) nobody registered an implementation for', () => {
    const registry = new ContributionRegistry();
    registry.register('invoice', 'dashboard', async () => []);

    expect(registry.resolve('invoice', 'statistics')).toBeUndefined();
    expect(registry.resolve('expense', 'dashboard')).toBeUndefined();
  });

  it('refuses registering the same (type, location) pair twice', () => {
    const registry = new ContributionRegistry();
    registry.register('invoice', 'dashboard', async () => []);

    expect(() => registry.register('invoice', 'dashboard', async () => [])).toThrow(/already registered/);
  });

  it('keeps "dashboard" and "statistics" independent for the same type', () => {
    const registry = new ContributionRegistry();
    registry.register('invoice', 'dashboard', async () => [
      { id: 'a', kind: 'metric', label: 'A', value: 1 },
    ]);
    registry.register('invoice', 'statistics', async () => [
      { id: 'b', kind: 'metric', label: 'B', value: 2 },
    ]);

    expect(registry.resolve('invoice', 'dashboard')).not.toBe(registry.resolve('invoice', 'statistics'));
  });
});
