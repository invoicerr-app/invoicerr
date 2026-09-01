/**
 * Pure parsing for the SIX one-way `TrasmissioneFatture` notifiche SdI PUSHES to a trasmittente's own
 * endpoint after a `RiceviFile` submission — the read-side twin of `sdicoop-client.ts`'s own
 * `RiceviFile`. Sources READ (fetched 2026-09-01, `curl` against fatturapa.gov.it — see
 * `sdicoop-client.ts`'s own header for the identical citation discipline):
 *
 *  - `TrasmissioneFatture_v1.1.wsdl` —
 *    https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/TrasmissioneFatture_v1.1.wsdl
 *  - `TrasmissioneTypes_v1.1.xsd` (same URL as `sdicoop-client.ts` cites, v1.1 revision)
 *  - "Istruzioni per il servizio SDICoop - Trasmissione" v3.3, §1.4–1.4.6 (same PDF `sdicoop-client.ts`
 *    cites) — "TRASMISSIONEFATTURE deve essere esposto dal trasmittente [...] Tale servizio viene
 *    esposto sulla base di endpoint che vengono comunicati in fase di accreditamento" (§1.4), and,
 *    for EVERY ONE of the six operations below, the identical closing sentence: "L'operazione X non
 *    prevede Response SOAP."
 *
 * From those: `TrasmissioneFatture`'s `portType` declares six ONE-WAY operations (input only, no
 * `wsdl:output` in the WSDL — confirmed by the PDF's own "non prevede Response SOAP" for every one),
 * each carrying a `fileSdI_Type` (`IdentificativoSdI`, `NomeFile`, `File` — the SAME three fields
 * `RiceviFile`'s own response type carries, per `TrasmissioneTypes_v1.1.xsd`), under a DIFFERENT root
 * element per operation:
 *
 *   RicevutaConsegna            → `ricevutaConsegna`               → RC (delivery receipt)
 *   NotificaMancataConsegna     → `notificaMancataConsegna`        → MC (delivery failed, temporary)
 *   NotificaScarto              → `notificaScarto`                 → NS (rejected — schema/checks)
 *   NotificaEsito               → `notificaEsito`                  → NE (buyer's own esito, relayed)
 *   NotificaDecorrenzaTermini   → `notificaDecorrenzaTermini`      → DT (15-day term elapsed)
 *   AttestazioneTrasmissioneFattura → `attestazioneTrasmissioneFattura` → AT (definitive non-delivery)
 *
 * (Meanings above match `sdi-client.ts`'s own pre-existing header — that file's RC/NS/MC/NE/DT/AT
 * vocabulary, reprised from the repère, is confirmed by what this file actually reads from the WSDL —
 * not contradicted, not re-derived.)
 *
 * ## What was NOT read, and is therefore NOT parsed here
 *
 * The `File` payload's own INTERNAL structure (the notifica's business content — e.g. NE's own
 * `EsitoCommittente` EC01/EC02, NS's own `ListaErrori`) is documented in "l'allegato B-1 delle
 * specifiche attuative delle regole tecniche" — a document this task never fetched (only referenced
 * by footnote in the read PDF). This module therefore does NOT decode that inner XML: it journals the
 * OUTER envelope's own facts (`identificativoSdI`, `nomeFile`, which of the six operations fired, and
 * the base64 `File` itself, kept verbatim for a human/future-parser to inspect) — never a business
 * verdict (accepted/refused, error detail) this codebase has not actually verified how to read.
 */
import { firstByLocalName, parseXml, textOf } from './xml-helpers';

export type SdiNotificaType = 'RC' | 'MC' | 'NS' | 'NE' | 'DT' | 'AT';

/** Root element (local name) → notifica type — read verbatim from `TrasmissioneTypes_v1.1.xsd`'s own
 *  `<xsd:element>` declarations, paired with the operation names from `TrasmissioneFatture_v1.1.wsdl`
 *  (see this file's own header). */
export const NOTIFICA_ELEMENT_TO_TYPE: Record<string, SdiNotificaType> = {
  ricevutaConsegna: 'RC',
  notificaMancataConsegna: 'MC',
  notificaScarto: 'NS',
  notificaEsito: 'NE',
  notificaDecorrenzaTermini: 'DT',
  attestazioneTrasmissioneFattura: 'AT',
};

/** Human labels — VERBATIM from `sdi-client.ts`'s own pre-existing header (never reworded here, so
 *  the two files never drift into describing the same six codes two different ways). */
export const NOTIFICA_TYPE_LABELS: Record<SdiNotificaType, string> = {
  RC: 'Ricevuta di Consegna (delivery receipt): buyer received the invoice',
  NS: 'Notifica di Scarto (rejection): SdI rejected the file',
  MC: 'Mancata Consegna (failed delivery): SdI could not deliver, retries for 15 days',
  NE: "Notifica Esito (buyer outcome): buyer's own esito, relayed by SdI",
  DT: 'Decorrenza Termini (15-day term expired): SdI deems it delivered',
  AT: 'Attestazione di Avvenuta Trasmissione: SdI could not deliver within the maximum term',
};

export interface ParsedSdiNotifica {
  notificaType: SdiNotificaType;
  identificativoSdI: string;
  nomeFile: string;
  /** The inner message file, base64, kept verbatim — see this file's own header on why its content
   *  is not decoded further. */
  fileBase64: string;
}

/**
 * Parses ONE incoming `TrasmissioneFatture` push. Returns `null` — never throws — when the body is
 * malformed XML or matches none of the six known root elements: the caller
 * (`sdi-notifiche.service.ts`) treats that identically to an unknown reference (log loudly, 200
 * regardless — see that file's own header on why SdI must never be made to retry forever).
 */
export function parseSdiNotifica(xml: string): ParsedSdiNotifica | null {
  const { doc, errors } = parseXml(xml);
  if (errors.length > 0) return null;

  for (const [elementName, notificaType] of Object.entries(NOTIFICA_ELEMENT_TO_TYPE)) {
    const root = firstByLocalName(doc, elementName);
    if (!root) continue;

    const identificativoSdI = textOf(firstByLocalName(root, 'IdentificativoSdI'));
    const nomeFile = textOf(firstByLocalName(root, 'NomeFile'));
    const fileBase64 = textOf(firstByLocalName(root, 'File'));
    if (!identificativoSdI || !nomeFile || !fileBase64) return null;

    return { notificaType, identificativoSdI, nomeFile, fileBase64 };
  }
  return null;
}
