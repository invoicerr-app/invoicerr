/** What an action implementation receives and must return. */
export interface ActionContext {
  companyId: string;
  typeId: string;
  /** Absent for an action that creates a new record (e.g. the first "save draft"). */
  documentId?: string;
  data: Record<string, unknown>;
  /**
   * The action's OWN inputs, already validated against its descriptor's `params` (see
   * DocumentActionDescriptor.params) — always an object, empty when the action declares no params
   * or the caller sent none. A distinct namespace from `data`: `data` is the document's own field
   * values, `params` is this one operation's arguments (e.g. "send"'s `recipient`).
   */
  params: Record<string, unknown>;
}

export interface DocumentInstanceResult {
  id: string;
  typeId: string;
  status: string;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What running an action hands back to the frontend — deliberately generic so a handler never has
 * to lie about a document it didn't touch, and the frontend never has to guess what happened:
 *  - `document`: the instance in its state after the action ran. Undefined for an action that has
 *    no document effect at all (every core action today sets one, but the shape doesn't assume it).
 *  - `changed`: whether the frontend's cached view (the list, the currently-open record) is now
 *    stale and should be refetched/reloaded.
 *  - `message`: an optional human-facing outcome string — plain data, the same convention as
 *    DocumentTypeDescriptor.label (not an i18n key); the frontend shows it as-is, falling back to a
 *    generic translated message when absent.
 */
export interface ActionResult {
  document?: DocumentInstanceResult;
  changed: boolean;
  message?: string;
}

export type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

/**
 * Computes DEFAULT VALUES for an action's own `params`, given the current document context — e.g.
 * "send" pre-filling `recipient` from the quote's `client` field. Optional and separate from
 * `ActionHandler`: an action can be fully usable with no defaults resolver at all (the user just
 * types the parameter in), the same way `params` itself is optional.
 */
export type ActionParamsDefaultsResolver = (ctx: ActionContext) => Promise<Record<string, unknown>>;

/**
 * Registry mapping (typeId, actionId) -> implementation. This is deliberately separate from
 * DocumentTypeRegistry: a descriptor DECLARES an action (id, label, when it is offered, its params);
 * this registry is where CODE gets attached to that id — both the handler that actually runs it, and
 * optionally a resolver that pre-fills its params. An action can be declared with no implementation
 * registered at all — DocumentsService.runAction treats that as "blocked, and says so" (501), never
 * as a silent no-op. That is the intended state for "convert-to-invoice" until an invoicing pipeline
 * exists to back it (see quote.descriptor.ts).
 */
export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();
  private readonly paramsDefaultsResolvers = new Map<string, ActionParamsDefaultsResolver>();

  private key(typeId: string, actionId: string): string {
    return `${typeId}::${actionId}`;
  }

  register(typeId: string, actionId: string, handler: ActionHandler): void {
    const key = this.key(typeId, actionId);
    if (this.handlers.has(key)) {
      throw new Error(`Action "${actionId}" is already registered for document type "${typeId}".`);
    }
    this.handlers.set(key, handler);
  }

  /** Undefined means "declared but not implemented" — never thrown, the caller decides what that means. */
  resolve(typeId: string, actionId: string): ActionHandler | undefined {
    return this.handlers.get(this.key(typeId, actionId));
  }

  registerParamsDefaults(typeId: string, actionId: string, resolver: ActionParamsDefaultsResolver): void {
    const key = this.key(typeId, actionId);
    if (this.paramsDefaultsResolvers.has(key)) {
      throw new Error(
        `Params-defaults resolver for "${actionId}" is already registered for type "${typeId}".`,
      );
    }
    this.paramsDefaultsResolvers.set(key, resolver);
  }

  /** Undefined means "no defaults resolver registered" — a perfectly normal state, not an error: the
   *  action's params form just opens empty. */
  resolveParamsDefaults(typeId: string, actionId: string): ActionParamsDefaultsResolver | undefined {
    return this.paramsDefaultsResolvers.get(this.key(typeId, actionId));
  }
}
