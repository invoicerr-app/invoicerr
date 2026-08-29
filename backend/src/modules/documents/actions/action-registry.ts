/** What an action implementation receives and must return. */
export interface ActionContext {
  companyId: string;
  typeId: string;
  /** Absent for an action that creates a new record (e.g. the first "save draft"). */
  documentId?: string;
  data: Record<string, unknown>;
}

export interface DocumentInstanceResult {
  id: string;
  typeId: string;
  status: string;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export type ActionHandler = (ctx: ActionContext) => Promise<DocumentInstanceResult>;

/**
 * Registry mapping (typeId, actionId) -> implementation. This is deliberately separate from
 * DocumentTypeRegistry: a descriptor DECLARES an action (id, label, when it is offered); this
 * registry is where CODE gets attached to that id. An action can be declared with no implementation
 * registered at all — DocumentsService.runAction treats that as "blocked, and says so" (501), never
 * as a silent no-op. That is the intended state for "send" until an email/PDF pipeline exists to
 * back it (see documents.module.ts).
 */
export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();

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
}
