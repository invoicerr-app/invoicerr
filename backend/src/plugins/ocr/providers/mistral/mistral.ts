/**
 * The reference OCR provider AS SEEN FROM THE MAIN BACKEND: a thin HTTP client of a SEPARATE,
 * dedicated container (`ocr-server.ts`, `ROLE=ocr`) — never Mistral directly.
 *
 * ## Design: an operator-managed OCR SERVICE, not an in-app credential
 *
 * OCR is reached THROUGH THE PLUGIN SYSTEM — the core (`received-invoices/`) has zero cloud
 * dependency, exposes an extension point, and the provider IS a plugin. The provider itself is a
 * THIN HTTP CLIENT of a `docker-compose` SERVICE (a THIRD image role, `ROLE=ocr` — see
 * `ocr-server.ts`'s own header), operator-managed, holding `MISTRAL_API_KEY` ITSELF. This backend
 * (API or worker — see `docker-compose.yml`'s own `OCR_SERVICE_URL` comment for which role actually
 * reaches this code) knows exactly ONE fact: `OCR_SERVICE_URL`. Absent = no OCR service deployed for
 * this instance = the honest, full-local self-host default. Present = every company on this instance
 * gets OCR, with ZERO per-company configuration screen. The Mistral API key NEVER reaches this
 * backend or its database, at any point.
 *
 * This class is "the plugin": the ONE thing that implements `ReceivedDocumentExtractor`
 * (`received-invoices/ocr/extractor.ts`) and registers into that core's own extension-point registry
 * (`plugins/index.ts`) — the core itself never imports this file, or knows Mistral/the OCR service/
 * `OCR_SERVICE_URL` exist.
 *
 * ## Abandoned designs — kept here so the reasoning travels with the code
 *
 * Two earlier credential shapes were dropped before either was wired to a screen: (1) an IN-APP
 * PLUGIN (`PluginType.OCR`, `PluginRegistry`, the Settings > Plugins screen, a global on/off toggle +
 * config form) — real, working machinery, but `Plugin`/`PluginRegistry` enforces "one active provider
 * per type" GLOBALLY (`PluginsService.toggleInAppPlugin`), an INSTANCE-WIDE shape that cannot express
 * "each company brings its own key"; and (2) a per-company encrypted API key
 * (`CompanyChannelConfig`-shaped), superseded by the single operator-managed SERVICE above. The
 * `PluginType.OCR` Postgres enum value from attempt 1 is LEFT IN PLACE, unused — Postgres cannot
 * cheaply drop a value from a live enum without rebuilding the whole type (see
 * `20260903000000_generic_document_webhook_events`'s own migration, which had to do exactly that for
 * `WebhookEvent`) and no `Plugin` row of that type was ever created, so leaving it costs nothing
 * beyond one inert enum member — see schema.prisma's own comment on `PluginType`.
 */
import {
  ExtractedInvoiceProposal,
  ExtractorNotReadyError,
  ReceivedDocumentExtractor,
} from '@/modules/documents/received-invoices/ocr/extractor';

/** Slightly ABOVE `mistral-client.ts`'s own `DEFAULT_TIMEOUT_MS` (60s) — so a real, slow Mistral
 *  call is reported BY the OCR service itself as a named, upstream timeout (mapped to a 504 —
 *  `ocr-server.ts`'s own `statusForError`), never raced out by this shorter hop's own timeout
 *  firing first and reporting a less specific "request failed" instead. */
const OCR_SERVICE_TIMEOUT_MS = 65_000;

export class MistralOcrProvider implements ReceivedDocumentExtractor {
  id = 'mistral-ocr';

  supports(mime: string): boolean {
    return mime === 'application/pdf';
  }

  async extract(bytes: Uint8Array, mime: string): Promise<ExtractedInvoiceProposal> {
    const serviceUrl = process.env.OCR_SERVICE_URL?.trim();
    if (!serviceUrl) {
      throw new ExtractorNotReadyError(
        this.id,
        'No OCR service is configured for this instance (OCR_SERVICE_URL is not set) — the honest, ' +
          'self-host-by-default outcome (see docker-compose.yml\'s own "ocr" service comment).',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_SERVICE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime, bytesBase64: Buffer.from(bytes).toString('base64') }),
        signal: controller.signal,
      });
    } catch (err) {
      // Never `ExtractorNotReadyError` here: `OCR_SERVICE_URL` IS configured — an unreachable/
      // misbehaving service the operator pointed us at is a real, NAMED failure, not the "no OCR at
      // all" outcome the empty-URL case above already covers.
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') {
        throw new Error(`OCR service request timed out after ${OCR_SERVICE_TIMEOUT_MS}ms (${serviceUrl}).`);
      }
      throw new Error(
        `OCR service request failed (${serviceUrl}): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (res.status === 503) {
      // `ocr-server.ts`'s own "service reachable but has no MISTRAL_API_KEY" signal — a genuine
      // operator misconfiguration (the service is deployed, but never got its own key), distinct
      // from "no service deployed at all" — named here so the two are never conflated.
      throw new Error(
        `OCR service at ${serviceUrl} has no Mistral API key configured: ${text.slice(0, 200)}`,
      );
    }
    if (!res.ok) {
      throw new Error(`OCR service request failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }

    try {
      return JSON.parse(text) as ExtractedInvoiceProposal;
    } catch {
      throw new Error(`OCR service returned a non-JSON response: ${text.slice(0, 300)}`);
    }
  }
}
