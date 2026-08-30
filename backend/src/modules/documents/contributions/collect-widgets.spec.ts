import { collectWidgets } from './collect-widgets';
import { ContributionRegistry } from './contribution-registry';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';

function descriptor(overrides: Partial<DocumentTypeDescriptor> = {}): DocumentTypeDescriptor {
  return { id: 'quote', label: 'Quote', fields: [], actions: [], ...overrides };
}

describe('collectWidgets', () => {
  it('a type that does not declare the location contributes NOTHING — not even an empty entry', async () => {
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(descriptor({ id: 'quote' })); // no `contributions` at all
    const contributionRegistry = new ContributionRegistry();
    // Registering a handler anyway must not matter: the descriptor never asked for it to run.
    contributionRegistry.register('quote', 'dashboard', async () => [
      { id: 'x', kind: 'metric', label: 'Should never appear', value: 1 },
    ]);

    const widgets = await collectWidgets({
      companyId: 'c1',
      location: 'dashboard',
      typeRegistry,
      contributionRegistry,
    });

    expect(widgets).toEqual([]);
  });

  it('runs the registered handler for a type that declares the location, and returns exactly its widgets', async () => {
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(descriptor({ id: 'invoice', label: 'Invoice', contributions: ['dashboard'] }));
    const contributionRegistry = new ContributionRegistry();
    contributionRegistry.register('invoice', 'dashboard', async ({ companyId }) => [
      { id: `${companyId}:pending`, kind: 'metric', label: 'Pending', value: 4 },
    ]);

    const widgets = await collectWidgets({
      companyId: 'acme',
      location: 'dashboard',
      typeRegistry,
      contributionRegistry,
    });

    expect(widgets).toEqual([{ id: 'acme:pending', kind: 'metric', label: 'Pending', value: 4 }]);
  });

  // THE mutation target: a document type promises a contribution (`contributions: ['dashboard']`)
  // but nothing was ever registered for it. This must be VISIBLE — an explicit "unimplemented"
  // widget — never silently absent from the response, which would look exactly like "this type has
  // nothing to show" to anyone reading the dashboard.
  it('a declared contribution with NO registered handler produces an explicit "unimplemented" widget, never silence', async () => {
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(descriptor({ id: 'expense', label: 'Expense', contributions: ['dashboard'] }));
    const contributionRegistry = new ContributionRegistry(); // nothing registered at all

    const widgets = await collectWidgets({
      companyId: 'c1',
      location: 'dashboard',
      typeRegistry,
      contributionRegistry,
    });

    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ kind: 'unimplemented', typeId: 'expense', location: 'dashboard' });
  });

  it('combines every contributing type, in registration order, and skips every non-contributing one', async () => {
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(descriptor({ id: 'quote', label: 'Quote' })); // does not contribute at all
    typeRegistry.register(
      descriptor({ id: 'invoice', label: 'Invoice', contributions: ['dashboard', 'statistics'] }),
    );
    typeRegistry.register(
      descriptor({ id: 'credit-note', label: 'Credit note', contributions: ['statistics'] }),
    );

    const contributionRegistry = new ContributionRegistry();
    contributionRegistry.register('invoice', 'dashboard', async () => [
      { id: 'invoice-widget', kind: 'metric', label: 'Invoices', value: 1 },
    ]);
    // "credit-note" declares "statistics" but nothing is registered for it — should surface as
    // "unimplemented" alongside the invoice's real widget when collecting "dashboard"? No: it only
    // declared "statistics", not "dashboard", so it must be entirely absent from a "dashboard" pull.

    const dashboardWidgets = await collectWidgets({
      companyId: 'c1',
      location: 'dashboard',
      typeRegistry,
      contributionRegistry,
    });
    expect(dashboardWidgets).toEqual([{ id: 'invoice-widget', kind: 'metric', label: 'Invoices', value: 1 }]);

    const statisticsWidgets = await collectWidgets({
      companyId: 'c1',
      location: 'statistics',
      typeRegistry,
      contributionRegistry,
    });
    expect(statisticsWidgets).toHaveLength(2);
    expect(statisticsWidgets[0]).toMatchObject({ kind: 'unimplemented', typeId: 'invoice' });
    expect(statisticsWidgets[1]).toMatchObject({ kind: 'unimplemented', typeId: 'credit-note' });
  });
});
