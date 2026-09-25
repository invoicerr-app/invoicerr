import { DashboardPeriod } from '../dto/dashboard-query.dto';
import { WidgetLocation } from '../descriptors/types';
import { Widget } from './widgets';

/** What a contribution handler receives - the company id, plus (issue #418) the dashboard's own
 *  optional period filter. Widened the same way ActionContext (actions/action-registry.ts) would be,
 *  the day a real contribution needs more - no speculative fields added ahead of that need; `period`
 *  itself was added only once a real, asked-for feature (the dashboard period selector) needed it.
 *
 *  `period` is `undefined` for every caller that never asked for one (the statistics location, and a
 *  dashboard request with no `dateFrom`/`dateTo`) - every contribution's own "no period -> exactly
 *  today's behavior, byte-identical" guarantee rests on treating `undefined` here as "this field does
 *  not exist", never as "an empty range". A handler that ignores `period` entirely (several of them,
 *  still - a widget with nothing period-scoped to restrict) is unaffected by this widening: this is
 *  why it is a plain optional field, not a required one that would force every existing handler to be
 *  touched. */
export interface ContributionContext {
  companyId: string;
  period?: DashboardPeriod;
}

export type ContributionHandler = (ctx: ContributionContext) => Promise<Widget[]>;

/**
 * Registry mapping (typeId, location) -> implementation — the contribution-side twin of
 * actions/action-registry.ts's ActionRegistry, deliberately built the same way: a document type's
 * descriptor DECLARES it contributes to a location (`DocumentTypeDescriptor.contributions`), and this
 * registry is where CODE gets attached to that declaration. A location can be declared with no
 * handler registered at all — collect-widgets.ts turns that into a visible "unimplemented" widget,
 * never a silent no-op, the same way DocumentsService.runAction 501s an action with no handler
 * instead of pretending it ran.
 */
export class ContributionRegistry {
  private readonly handlers = new Map<string, ContributionHandler>();

  private key(typeId: string, location: WidgetLocation): string {
    return `${typeId}::${location}`;
  }

  register(typeId: string, location: WidgetLocation, handler: ContributionHandler): void {
    const key = this.key(typeId, location);
    if (this.handlers.has(key)) {
      throw new Error(`A "${location}" contribution is already registered for document type "${typeId}".`);
    }
    this.handlers.set(key, handler);
  }

  /** Undefined means "declared but not implemented" — never thrown, collect-widgets.ts decides what
   *  that means (an explicit "unimplemented" widget, never silence). */
  resolve(typeId: string, location: WidgetLocation): ContributionHandler | undefined {
    return this.handlers.get(this.key(typeId, location));
  }
}
