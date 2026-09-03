export interface EntityReferenceOption {
  id: string;
  label: string;
}

/** How a 'reference' field's `entity` name is turned into search results / a resolved label. Each
 *  provider wraps an existing domain service (see client-reference.provider.ts) — this registry
 *  never touches Prisma itself. */
export interface EntityReferenceProvider {
  search(companyId: string, query: string): Promise<EntityReferenceOption[]>;
  resolve(companyId: string, id: string): Promise<EntityReferenceOption | null>;
  /**
   * OPTIONAL: the entity's own raw field values, for a 'reference'-adjacent field declaring
   * `prefillFrom` (descriptors/types.ts) — e.g. an article's `name`/`unitPrice`/`vatRate`, keyed by
   * exactly the field names `prefillFrom.map`'s values name. Distinct from `resolve()` on purpose:
   * `resolve` returns the small, universal `{id, label}` shape every 'reference' field needs to
   * DISPLAY an already-set value; this returns whatever a specific entity actually stores, which a
   * generic field can never assume the shape of. A provider that backs no prefillable/lockable field
   * (e.g. "client" — nothing prefills a line FROM a client, nor locks a field to one) simply never
   * implements this; DocumentsService.getReferenceFields treats an absent implementation as "nothing
   * to read from", never an error. "quote"/"invoice" (document-reference.provider.ts) DO implement
   * it as of TODO_PRODUIT.md T4-d — the credit note's own `currency` field locks to its `invoice`
   * field's resolved `currency` (see descriptors/types.ts's own `lockedFromReference`).
   */
  getFields?(companyId: string, id: string): Promise<Record<string, unknown> | null>;
}

export class UnknownEntityReferenceError extends Error {
  constructor(public readonly entity: string) {
    super(`Unknown reference entity "${entity}".`);
    this.name = 'UnknownEntityReferenceError';
  }
}

/**
 * Registry of entity reference providers, keyed by entity name (e.g. "client"). This is what keeps
 * the 'reference' field kind generic on the frontend: a reference field's search/resolve UI calls
 * one generic endpoint (`/documents/references/:entity/...`) regardless of which entity it targets.
 */
export class EntityReferenceRegistry {
  private readonly providers = new Map<string, EntityReferenceProvider>();

  register(entity: string, provider: EntityReferenceProvider): void {
    if (this.providers.has(entity)) {
      throw new Error(`Reference entity "${entity}" is already registered.`);
    }
    this.providers.set(entity, provider);
  }

  /** Throws UnknownEntityReferenceError for an entity nobody registered. */
  resolve(entity: string): EntityReferenceProvider {
    const provider = this.providers.get(entity);
    if (!provider) {
      throw new UnknownEntityReferenceError(entity);
    }
    return provider;
  }
}
