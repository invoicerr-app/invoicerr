import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { WidgetLocation } from '../descriptors/types';
import { ContributionRegistry } from './contribution-registry';
import { unimplementedContributionWidget, Widget } from './widgets';

export interface CollectWidgetsParams {
  companyId: string;
  location: WidgetLocation;
  typeRegistry: DocumentTypeRegistry;
  contributionRegistry: ContributionRegistry;
}

/**
 * Assembles every widget a `location` (dashboard/statistics) shows for one company — the pure,
 * framework-agnostic function DocumentsService.collectWidgets delegates to, on the same model as
 * row-selection/resolve-row-selection.ts's `listSourceRows`: easy to unit test with hand-built
 * registries, no Nest, no HTTP.
 *
 * Walks EVERY registered document type (never a hard-coded list — this is what keeps a plugin's own
 * type able to contribute without this file changing) and, for each one that DECLARES `location` in
 * its own `contributions`:
 *  - a registered handler runs and its widgets are appended, in type-registration order;
 *  - no handler registered -> ONE explicit "unimplemented" widget is appended instead. This is the
 *    whole point of the exercise: a document type that promises a contribution and doesn't deliver
 *    one must be as visible as a document ACTION that is declared but never implemented (the 501
 *    path in documents.service.ts) — never a location that quietly renders one widget short of what
 *    it claimed.
 *
 * A type that does not declare `location` at all contributes nothing and is not mentioned — that is
 * the ordinary, unremarkable case (most types, most locations), not a gap to flag.
 */
export async function collectWidgets(params: CollectWidgetsParams): Promise<Widget[]> {
  const { companyId, location, typeRegistry, contributionRegistry } = params;
  const widgets: Widget[] = [];

  for (const descriptor of typeRegistry.list()) {
    if (!descriptor.contributions?.includes(location)) continue;

    const handler = contributionRegistry.resolve(descriptor.id, location);
    if (!handler) {
      widgets.push(unimplementedContributionWidget(descriptor.id, location, descriptor.label));
      continue;
    }

    const contributed = await handler({ companyId });
    widgets.push(...contributed);
  }

  return widgets;
}
