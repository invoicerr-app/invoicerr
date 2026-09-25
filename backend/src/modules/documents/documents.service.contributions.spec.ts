import { vi, type Mock } from 'vitest';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { DocumentTypeDescriptor } from './descriptors/types';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as schedulePersistence from './schedules/schedule.persistence';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./country-policy/country-policy');
vi.mock('./schedules/schedule.persistence');

/**
 * Proves DocumentsService's two NEW read surfaces (collectWidgets, listAvailableTypes) delegate
 * correctly — the same "this file proves the CALLER's wiring, not the underlying decision" split
 * documents.service.country-policy.spec.ts already documents: collect-widgets.spec.ts proves the
 * assembly logic itself, country-policy.spec.ts proves resolveAvailableDocumentTypes' own decision.
 */
function descriptor(overrides: Partial<DocumentTypeDescriptor> = {}): DocumentTypeDescriptor {
  return { id: 'invoice', label: 'Invoice', fields: [], actions: [], ...overrides };
}

function buildService(types: DocumentTypeDescriptor[], contributionRegistry = new ContributionRegistry()) {
  const typeRegistry = new DocumentTypeRegistry();
  for (const type of types) typeRegistry.register(type);

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    contributionRegistry,
  );
}

describe('DocumentsService.collectWidgets', () => {
  afterEach(() => vi.resetAllMocks());

  it('delegates to the wired type/contribution registries and returns their widgets', async () => {
    (schedulePersistence.listSchedules as Mock).mockResolvedValue([]);
    const contributionRegistry = new ContributionRegistry();
    contributionRegistry.register('invoice', 'dashboard', async () => [
      { id: 'w1', kind: 'metric', label: 'Pending', value: 2 },
    ]);
    const service = buildService([descriptor({ contributions: ['dashboard'] })], contributionRegistry);

    const widgets = await service.collectWidgets('company-1', 'dashboard');
    // PLUS the "upcoming recurrences" widget — ADDED alongside every
    // type's own contribution, never in place of it (documents.service.ts's own collectWidgets).
    expect(widgets).toEqual([
      { id: 'w1', kind: 'metric', label: 'Pending', value: 2 },
      { id: 'document-schedule:upcoming', kind: 'shortList', label: 'Upcoming recurrences', items: [] },
    ]);
  });

  it('the "upcoming recurrences" widget is NEVER added for the "statistics" location', async () => {
    const service = buildService([descriptor({ id: 'expense', contributions: ['statistics'] })]);

    const widgets = await service.collectWidgets('company-1', 'statistics');
    expect(widgets.some((w) => w.id === 'document-schedule:upcoming')).toBe(false);
    expect(schedulePersistence.listSchedules).not.toHaveBeenCalled();
  });

  it('a type declaring a contribution with no handler surfaces the explicit "unimplemented" marker', async () => {
    const service = buildService([descriptor({ id: 'expense', contributions: ['statistics'] })]);

    const widgets = await service.collectWidgets('company-1', 'statistics');
    expect(widgets).toEqual([
      expect.objectContaining({ kind: 'unimplemented', typeId: 'expense', location: 'statistics' }),
    ]);
  });

  // Issue #418: the dashboard's own period, when given, reaches both a type's own contribution
  // handler AND the "upcoming recurrences" widget (as its own `warnings`, never a restriction -
  // schedules/schedule-widgets.ts's own header).
  it('threads the period through to the contribution handler and the schedule widget', async () => {
    (schedulePersistence.listSchedules as Mock).mockResolvedValue([]);
    const contributionRegistry = new ContributionRegistry();
    let receivedPeriod: unknown;
    contributionRegistry.register('invoice', 'dashboard', async (ctx) => {
      receivedPeriod = ctx.period;
      return [];
    });
    const service = buildService([descriptor({ contributions: ['dashboard'] })], contributionRegistry);

    const period = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
    const widgets = await service.collectWidgets('company-1', 'dashboard', period);

    expect(receivedPeriod).toEqual(period);
    expect(widgets).toEqual([
      {
        id: 'document-schedule:upcoming',
        kind: 'shortList',
        label: 'Upcoming recurrences',
        warnings: [expect.stringContaining('does not apply')],
        items: [],
      },
    ]);
  });

  it('no period given -> undefined reaches the handler, exactly the pre-#418 shape', async () => {
    (schedulePersistence.listSchedules as Mock).mockResolvedValue([]);
    const contributionRegistry = new ContributionRegistry();
    let receivedPeriod: unknown = 'not-yet-called';
    contributionRegistry.register('invoice', 'dashboard', async (ctx) => {
      receivedPeriod = ctx.period;
      return [];
    });
    const service = buildService([descriptor({ contributions: ['dashboard'] })], contributionRegistry);

    await service.collectWidgets('company-1', 'dashboard');

    expect(receivedPeriod).toBeUndefined();
  });
});

describe('DocumentsService.listAvailableTypes', () => {
  afterEach(() => vi.resetAllMocks());

  it("returns the registered descriptors' id/label for every typeId the country policy allows", async () => {
    (countryPolicy.resolveAvailableDocumentTypes as Mock).mockResolvedValue({
      typeIds: ['invoice'],
    });
    const service = buildService([descriptor({ id: 'invoice', label: 'Invoice' })]);

    const result = await service.listAvailableTypes('company-1');
    expect(result).toEqual({ types: [{ id: 'invoice', label: 'Invoice' }] });
  });

  it('passes the reason through untouched, and an empty types list, when the country has none declared', async () => {
    (countryPolicy.resolveAvailableDocumentTypes as Mock).mockResolvedValue({
      typeIds: [],
      reason: 'No document types are declared for "DE"',
    });
    const service = buildService([descriptor({ id: 'invoice', label: 'Invoice' })]);

    const result = await service.listAvailableTypes('company-1');
    expect(result).toEqual({ types: [], reason: 'No document types are declared for "DE"' });
  });

  it('silently drops a typeId the country file names but this build never registered — defensive, not a crash', async () => {
    (countryPolicy.resolveAvailableDocumentTypes as Mock).mockResolvedValue({
      typeIds: ['invoice', 'does-not-exist'],
    });
    const service = buildService([descriptor({ id: 'invoice', label: 'Invoice' })]);

    const result = await service.listAvailableTypes('company-1');
    expect(result.types).toEqual([{ id: 'invoice', label: 'Invoice' }]);
  });
});
