import { DocumentFormatProvider } from './format-provider';

export class UnknownFormatError extends Error {
  constructor(public readonly formatId: string) {
    super(`Unknown document format "${formatId}".`);
    this.name = 'UnknownFormatError';
  }
}

/**
 * Registry of normalized document format providers, keyed by id — the exact same shape as
 * `transports/transport-registry.ts`'s `TransportRegistry` (register/list/has/resolve), for the same
 * reason: a NEW jurisdiction's syntax (Peppol BIS — `peppol-bis-provider.ts`, XRechnung —
 * `xrechnung-provider.ts`, both branched by root TODO item 26) is a plugin registration here, never a
 * change to `documents.service.ts#downloadDocumentFormat`, which only ever asks this registry
 * "do you have `id`?" and never enumerates known ids by name.
 *
 * `resolve` throwing `UnknownFormatError` for an unregistered id — rather than returning `undefined`
 * — is what `documents.service.ts` turns into the 501 "declared but not implemented" gate: the SAME
 * shape `ActionRegistry.resolve` returning `undefined` (not throwing) turns into a 501 for an action,
 * just inverted here because a registry that is ALWAYS expected to have an entry for a value the
 * caller itself validated (`documents.service.ts` resolves the `syntax` action param through this
 * registry, so an unknown id can only reach here via a scripted client bypassing the declared
 * `options`) reads more honestly as an exception than as a silent `undefined`.
 */
export class FormatProviderRegistry {
  private readonly providers = new Map<string, DocumentFormatProvider>();

  register(provider: DocumentFormatProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Document format provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
  }

  /** Every registered provider, id/syntax/mime only — what the invoice's `download-xml` action
   *  param (`syntax`) offers to choose from, the same shape `TransportRegistry.list()` offers for
   *  `Company.invoiceTransportId`. */
  list(): { id: string; syntax: string; mime: string }[] {
    return [...this.providers.values()].map(({ id, syntax, mime }) => ({ id, syntax, mime }));
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  resolve(id: string): DocumentFormatProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new UnknownFormatError(id);
    }
    return provider;
  }
}
