/**
 * Namespace-agnostic XML lookup shared by `sdicoop-client.ts` (outbound: `RiceviFile`'s own response)
 * and `sdi-notifiche.ts` (inbound: the six `TrasmissioneFatture` push notifiche) — both read elements
 * by LOCAL NAME only, since the read spec fixes the element names, never which prefix a given SdI
 * deployment happens to bind them to (the same defensive stance `formats/structural-check.ts`'s own
 * root-element check takes for the identical reason). `@xmldom/xmldom` is an already-whitelisted
 * dependency (used there too) — no new one added for this.
 */
import { DOMParser, Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

export function firstByLocalName(scope: XmlDocument | XmlElement, localName: string): XmlElement | null {
  return scope.getElementsByTagNameNS('*', localName).item(0);
}

export function textOf(el: XmlElement | null): string | undefined {
  const text = el?.textContent?.trim();
  return text ? text : undefined;
}

export interface ParsedXml {
  doc: XmlDocument;
  errors: string[];
}

/** Parses `xml`, collecting BOTH a thrown fatal `ParseError` and a non-fatal `onError` callback into
 *  one `errors[]` list — `@xmldom/xmldom`'s two distinct ways of reporting a malformed document (see
 *  `structural-check.ts`'s own comment on this, verified against the installed version there). Never
 *  throws itself — the caller decides what "malformed" means for its own message. */
export function parseXml(xml: string): ParsedXml {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === 'error' || level === 'fatalError') errors.push(message);
    },
  });
  let doc: XmlDocument | undefined;
  try {
    doc = parser.parseFromString(xml, 'text/xml');
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  if (errors.length > 0 || !doc?.documentElement) {
    return { doc: doc as XmlDocument, errors: errors.length > 0 ? errors : ['no root element'] };
  }
  return { doc, errors: [] };
}

export type { XmlDocument, XmlElement };
