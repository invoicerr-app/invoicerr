/**
 * TODO_PRODUIT.md T5(c) — the OCR extension point. MANDANT DECISION (already made, recorded in the
 * task's own board section): OCR is a cloud service reached THROUGH THE PLUGIN SYSTEM — this core
 * (`received-invoices/`) never imports Mistral, never imports `fetch`-based HTTP client code for a
 * provider, and never even imports the plugin/Prisma machinery that decides which provider is
 * active. It only declares WHAT a provider must look like and holds a plain in-memory registry of
 * whichever providers a composition root (`plugins/index.ts`) chose to register — the exact same
 * "core depends on a narrow interface, a plugin depends on the core" shape
 * `transports/transport-registry.ts` and `formats/format-registry.ts` already establish for
 * transports/formats, reused here rather than reinvented.
 *
 * ## Why `resolveFor` returns `undefined` instead of throwing (the ONE deliberate divergence from
 * `FormatProviderRegistry`/`TransportRegistry`)
 *
 * Both of those registries throw a NAMED error (`UnknownFormatError`/`UnknownTransportError`) for an
 * id nobody registered — because their callers always resolve an id a HUMAN just chose from that
 * SAME registry's own `list()` (a transport a company picked in settings, a format `syntax` param a
 * request explicitly named), so an unknown id can only reach `resolve()` via a bug or a scripted
 * client bypassing validation. This registry's caller (`apply-ocr-fallback.ts`) never asks "give me
 * THIS id" — it asks "does ANYTHING here support this mime type", for every single PDF a user drops,
 * whether or not an OCR plugin was ever installed. "Nobody registered anything that can read this
 * mime" is therefore not a caller bug, it is the EXPECTED, EVERYDAY answer for any deployment that
 * never toggled Mistral on (or any deployment before this task existed at all) — see
 * `received-invoice.descriptor.ts`'s own header, "a plain scanned PDF is the base case". Throwing
 * here would turn "OCR is not enabled" into an exception the upload flow would have to catch on
 * every single upload; returning `undefined` lets the caller treat "no extractor" as data, the same
 * honest-absence discipline `extraction.ts`'s own `EMPTY_RESULT` already holds for "nothing
 * structured found".
 *
 * ## Why readiness (is the provider actually configured/activated) is NOT part of this registry
 *
 * `supports(mime)` is a pure, synchronous, stateless capability check — "can THIS CODE ever handle
 * this mime type" — never "is it currently switched on". Whether a registered extractor is actually
 * READY to be called (a plugin toggled on, an API key configured) is a fact only the extractor
 * itself can know, since only it talks to the plugin/credentials system this core stays deliberately
 * blind to. Mirrors `transports/transport-registry.ts`'s own `DocumentTransport.preflight?` — an
 * OPTIONAL extra gate the CALLER runs, never baked into the registry's own resolution — except here
 * the gate is folded into `extract()` itself (throwing `ExtractorNotReadyError`, below) rather than a
 * separate method, because unlike a transport (chosen once per company, ahead of time, with its own
 * settings screen), an extractor is tried opportunistically on every unstructured PDF — a single
 * "try it and name why it declined" call site is simpler than a resolve-then-preflight-then-call
 * dance for a extension point this narrow.
 */
import { ExtractedInvoiceFields } from '../extraction';

/** What an extractor hands back — see this file's own header: EXACTLY the shape TODO_PRODUIT.md
 *  T5(a)/T5(b) already gave `extraction.ts`'s own structural reader, never a second, OCR-specific
 *  shape. This is what lets `apply-ocr-fallback.ts` merge an OCR proposal into the SAME `fields`
 *  object a CII/UBL/Factur-X read already produces — the line-totals check (T5a) and the supplier
 *  reconciliation (T5b) never need to know which source populated `fields.lines`/`fields.supplierVatId`. */
export interface ExtractedInvoiceProposal {
  fields: ExtractedInvoiceFields;
}

/**
 * What a THIRD PARTY implements to make a new way of reading an unstructured received-invoice
 * upload. Registered into `receivedDocumentExtractorRegistry` below (never resolved by id — see
 * this file's own header) by a composition root, e.g. `plugins/index.ts`.
 */
export interface ReceivedDocumentExtractor {
  /** This extractor's own registered id (e.g. "mistral-ocr") — surfaced on the outcome
   *  (`apply-ocr-fallback.ts`'s `OcrOutcome`) so a "failed"/"extracted" result names WHICH provider
   *  acted, never a bare "OCR" that could mean any one of several installed extractors. */
  id: string;
  /** Pure, synchronous, stateless — see this file's own header on why readiness is deliberately NOT
   *  checked here. */
  supports(mime: string): boolean;
  /**
   * Attempts extraction. MUST throw `ExtractorNotReadyError` (never a bare generic error) when this
   * extractor is registered but not currently usable (a plugin toggled off, no credentials
   * configured) — `apply-ocr-fallback.ts` treats that specific type as the SAME honest "no extractor
   * available" outcome as nothing being registered at all, rather than a provider failure. Any OTHER
   * thrown error (a real HTTP failure, an invalid response) is surfaced as a NAMED provider error —
   * see this task's own root instruction: "les erreurs du provider... sont NOMMÉES, jamais avalées".
   */
  extract(bytes: Uint8Array, mime: string): Promise<ExtractedInvoiceProposal>;
}

/** Thrown by `ReceivedDocumentExtractor.extract()` for "I am registered but not ready right now" —
 *  see this file's own header. Never thrown for a genuine provider-side failure (quota, invalid key,
 *  timeout, a malformed response) — those are real errors this type deliberately does NOT catch. */
export class ExtractorNotReadyError extends Error {
  constructor(
    public readonly extractorId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractorNotReadyError';
  }
}

/**
 * Registry of received-document extractors — the SAME register/list/has shape
 * `FormatProviderRegistry`/`TransportRegistry` already use (see those files' own headers), with
 * `resolveFor` in place of `resolve`: capability-based ("who can read this mime"), never id-based,
 * and returning `undefined` rather than throwing — see this file's own header for why both
 * differences are deliberate, not oversights.
 */
export class ReceivedDocumentExtractorRegistry {
  private readonly extractors: ReceivedDocumentExtractor[] = [];

  register(extractor: ReceivedDocumentExtractor): void {
    if (this.extractors.some((existing) => existing.id === extractor.id)) {
      throw new Error(`Received-document extractor "${extractor.id}" is already registered.`);
    }
    this.extractors.push(extractor);
  }

  /** Every registered extractor, id only — mirrors `TransportRegistry.list()`'s own "what a settings
   *  screen could offer to choose from" shape, even though nothing in this wave's own screen reads
   *  it yet (there is only ever meant to be one OCR provider active at a time — see
   *  `plugins/index.ts`'s own "only one active plugin per type" rule). */
  list(): { id: string }[] {
    return this.extractors.map(({ id }) => ({ id }));
  }

  has(id: string): boolean {
    return this.extractors.some((extractor) => extractor.id === id);
  }

  /** The FIRST registered extractor whose `supports(mime)` answers true, or `undefined` when none
   *  does (including when nothing at all is registered) — see this file's own header for why this
   *  is an honest, expected outcome here, never an exception. */
  resolveFor(mime: string): ReceivedDocumentExtractor | undefined {
    return this.extractors.find((extractor) => extractor.supports(mime));
  }
}

/**
 * The one instance `received-invoices.service.ts` (via `apply-ocr-fallback.ts`) and `plugins/
 * index.ts` (the composition root that registers providers into it) both reach — a plain module-level
 * singleton, the same non-DI shape this whole module already uses everywhere else (see
 * `received-invoices.module.ts`'s own header: this module's service reaches Prisma through free
 * functions, never an injected repository, specifically to avoid dragging in modules — `PluginRegistry`
 * (`plugins/index.ts`) is ALSO a plain singleton for the identical reason).
 */
export const receivedDocumentExtractorRegistry = new ReceivedDocumentExtractorRegistry();
