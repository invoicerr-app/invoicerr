/**
 * The AADE myDATA REST API wire-level client — HTTP + XML shape ONLY (`DeclaredInvoice` mapping
 * lives in `mydata-declaration-provider.ts`).
 *
 * ## Sources actually read for this file (2026-09-02) — and the wall this task hit
 *
 * aade.gr itself (the myDATA home page, its own "τεχνικές προδιαγραφές" documentation page, and
 * every direct file path tried under `/sites/default/files/...` for a vendored XSD/PDF) returned
 * HTTP 403 for EVERY request attempted from this environment, with or without a browser User-Agent
 * — a whole-domain wall, the same kind this repository already documents for other government sites
 * (`documents/b2g-routing/data/fr.json`'s own note on légifrance/chorus-pro.gouv.fr). An EUR-Lex
 * lookup for the EU Council Implementing Decision authorizing Greece's myDATA-based e-invoicing
 * mandate (CELEX 32023D1553) also did not render usable text from this environment.
 *
 * What COULD be read: the myDATA `InvoicesDoc`/`response` XSD schemas, and the REST base URLs +
 * authentication header names, both independently corroborated by MULTIPLE, separately-maintained
 * open-source myDATA client implementations (never a single unverified source):
 *  - `attheodo/mydatanaut` (Python) vendors the OFFICIAL, AADE-named schema files verbatim —
 *    `xsd/InvoicesDoc-v1.0.9.xsd` and `xsd/response-v1.0.9.xsd` — read directly from that repo's own
 *    `xsd/` directory (https://github.com/attheodo/mydatanaut).
 *  - `firebed/aade-mydata` (PHP, one of the most widely used myDATA client libraries) — its own HTTP
 *    client source (`src/Http/MyDataRequest.php`) names the exact base URLs and header keys read
 *    below, matching the `Ocp-Apim-Subscription-Key`/`aade-user-id` pair this task's own brief names.
 *
 * This is a WEAKER provenance than NAV's (an official government GitHub repo + an official PDF spec
 * with a reproducible test vector) — every fact below is corroborated by INDEPENDENT third-party
 * implementations rather than read directly from aade.gr, and is marked as such rather than
 * overstated. `MYDATA_LIVE=1` against the real `mydataapidev.aade.gr` sandbox is what would actually
 * confirm it (see `CREDENTIALS_GUIDE.md` for the registration process — also NOT self-service without
 * a Greek AADE/TaxisNet identity, for the same reason NAV's own registration is not).
 *
 * ## VERIFIED (via the above) — base URLs, headers, resources
 *
 *  - Sandbox: `https://mydataapidev.aade.gr/` ; Production: `https://mydatapi.aade.gr/myDATA/`
 *  - `SendInvoices` — the ONLY operation this file calls, appended directly to the base URL.
 *  - Headers: `aade-user-id`, `ocp-apim-subscription-key`, `Content-Type: text/xml`.
 *
 * ## VERIFIED (via the vendored XSD) — response shape
 *
 * `ResponseDoc > response[]`: `index` (int), then EITHER a success branch (`invoiceUid`,
 * `invoiceMark` — xs:long, "Μοναδικός Αριθμός Καταχώρησης παραστατικού" = "Unique Registration
 * Number" — this IS the "MARK" this task's own brief names) or an error branch (`errors/error[]`:
 * `code`, `message`), and always `statusCode`.
 *
 * ## EXTRAPOLATED — NOT verified against the primary source in hand
 *
 *  - The exact enumeration mapping VAT rate percentages to myDATA's own `vatCategory` codes (1-10)
 *    and `invoiceType` codes (dozens of values, e.g. "1.1" for an ordinary goods-sale invoice) — the
 *    XSD extraction confirms the FIELDS exist and are required, not each enum VALUE's own meaning.
 *    `mydata-declaration-provider.ts#mapVatRateToMyDataCategory` implements only the two widely-cited
 *    values (standard rate → category 1, zero/no-VAT → category 7) and marks anything else
 *    explicitly as a best-effort fallback — see that file's own header.
 *  - The exact success/failure meaning of every `statusCode` STRING value `ResponseType` can carry
 *    (the vendored XSD types it as a bare `xs:string`, with no enumeration list captured in this
 *    extraction) — this client treats "an `errors` block is present" as the ONLY authoritative
 *    failure signal (see `parseMyDataResponse` below), never a guess at `statusCode`'s own vocabulary.
 */
import { create } from 'xmlbuilder2';

import { firstByLocalName, parseXml, textOf } from '../../transports/sdi/xml-helpers';
import type { XmlElement } from '../../transports/sdi/xml-helpers';

export const MYDATA_SANDBOX_BASE_URL = 'https://mydataapidev.aade.gr/';
export const MYDATA_PROD_BASE_URL = 'https://mydatapi.aade.gr/myDATA/';

export interface MyDataCredentials {
  userId: string;
  subscriptionKey: string;
  /** OPTIONAL override of the fixed per-environment host — same escape hatch
   *  `reporting/providers/nav-client.ts#NavCredentials.baseUrl` offers, for the identical reason
   *  (testing the real flow against a local stub, in jest and in Cypress spec 41, without ever
   *  touching the real AADE sandbox). */
  baseUrl?: string;
}

export interface MyDataInvoiceResponseItem {
  index?: number;
  invoiceUid?: string;
  invoiceMark?: string;
  statusCode?: string;
  errors: { code?: string; message?: string }[];
}

export class MyDataApiError extends Error {
  constructor(public readonly item: MyDataInvoiceResponseItem) {
    super(
      item.errors.length > 0
        ? `myDATA rejected the invoice: ${item.errors.map((e) => `${e.code ?? '?'}: ${e.message ?? ''}`).join('; ')}`
        : 'myDATA returned a response with no invoiceMark and no error — cannot tell success from failure.',
    );
    this.name = 'MyDataApiError';
  }
}

/** Reads the FIRST `response` entry of a `ResponseDoc` — this client only ever submits ONE invoice
 *  per call, so there is exactly one to read (spec-confirmed shape — see this file's own header). */
export function parseMyDataResponse(xml: string): MyDataInvoiceResponseItem {
  const { doc, errors } = parseXml(xml);
  if (errors.length > 0) {
    throw new Error(`myDATA response could not be parsed as XML: ${errors.join('; ')}`);
  }
  const response = firstByLocalName(doc, 'response');
  if (!response) {
    throw new Error('myDATA response carries no <response> element.');
  }
  const errorEls = Array.from(response.getElementsByTagNameNS('*', 'error')) as XmlElement[];
  return {
    index: (() => {
      const raw = textOf(firstByLocalName(response, 'index'));
      return raw ? parseInt(raw, 10) : undefined;
    })(),
    invoiceUid: textOf(firstByLocalName(response, 'invoiceUid')),
    invoiceMark: textOf(firstByLocalName(response, 'invoiceMark')),
    statusCode: textOf(firstByLocalName(response, 'statusCode')),
    errors: errorEls.map((el) => ({
      code: textOf(firstByLocalName(el, 'code')),
      message: textOf(firstByLocalName(el, 'message')),
    })),
  };
}

export interface MyDataClient {
  /** POST {baseUrl}SendInvoices — submits exactly ONE `invoice` inside an `InvoicesDoc` and returns
   *  the parsed response item. Throws `MyDataApiError` when myDATA itself reports an error (an
   *  `errors` block) — never returns a "failure" shape silently. */
  sendInvoices(invoiceXml: string): Promise<MyDataInvoiceResponseItem>;
}

export function buildMyDataClient(credentials: MyDataCredentials, baseUrl: string): MyDataClient {
  return {
    async sendInvoices(invoiceXml: string) {
      const url = `${baseUrl}SendInvoices`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'text/xml',
          'aade-user-id': credentials.userId,
          'ocp-apim-subscription-key': credentials.subscriptionKey,
        },
        body: invoiceXml,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`myDATA HTTP ${res.status} calling SendInvoices: ${text.slice(0, 500)}`);
      }
      const item = parseMyDataResponse(text);
      if (item.errors.length > 0) throw new MyDataApiError(item);
      return item;
    },
  };
}

export const MYDATA_NAMESPACE = 'https://www.aade.gr/myDATA/invoice/v1.0';

/** Wraps one invoice's own `xmlbuilder2` object graph (built by
 *  `mydata-declaration-provider.ts#buildMyDataInvoiceObject`) in the `InvoicesDoc` envelope
 *  `SendInvoices` expects (spec-confirmed root — see this file's own header) — kept HERE, not
 *  duplicated, so both the declaration provider and its own spec build the envelope through the
 *  exact same function. */
export function buildMyDataInvoicesDocXml(invoice: Record<string, unknown>): string {
  return create({
    InvoicesDoc: {
      '@xmlns': MYDATA_NAMESPACE,
      invoice,
    },
  }).end({ headless: true });
}
