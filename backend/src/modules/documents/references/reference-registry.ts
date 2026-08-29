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
