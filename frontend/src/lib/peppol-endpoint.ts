/**
 * A party's Peppol routing endpoint is stored as one more party identifier, scheme
 * `PEPPOL_ENDPOINT`, value `schemeId:endpointId` (e.g. `0088:7300010000001`). The client and
 * company forms edit it as two separate fields, so they split it on load and fold it back on save;
 * the screens that list a party's identifiers leave it out.
 */
export const PEPPOL_ENDPOINT_SCHEME = "PEPPOL_ENDPOINT"

/** The scheme the forms start from and fall back to: 0088, GLN. */
export const DEFAULT_PEPPOL_SCHEME_ID = "0088"

interface Identifier {
  scheme: string
  value: string
}

/** The Peppol endpoint as the forms edit it: two separate fields. */
export interface PeppolEndpointFields {
  schemeId: string
  endpointId: string
}

/** The party identifier to send for the two form fields, or null when either is empty. The endpoint
 *  id is trimmed; the scheme id is sent as picked. */
export function peppolEndpointIdentifier(
  schemeId: string | undefined,
  endpointId: string | undefined,
): Identifier | null {
  return schemeId && endpointId?.trim()
    ? { scheme: PEPPOL_ENDPOINT_SCHEME, value: `${schemeId}:${endpointId.trim()}` }
    : null
}

/** The two form fields read back from a party's identifiers. Without a `schemeId:` prefix (or
 *  without any Peppol endpoint at all) the scheme falls back to the default and the endpoint id is
 *  empty. */
export function splitPeppolEndpoint(identifiers: readonly Identifier[]): PeppolEndpointFields {
  const peppolEntry = identifiers.find((pi) => pi.scheme === PEPPOL_ENDPOINT_SCHEME)
  const peppolRaw: string = peppolEntry?.value || ""
  const colonIdx = peppolRaw.indexOf(":")
  return {
    schemeId: colonIdx >= 0 ? peppolRaw.slice(0, colonIdx) : DEFAULT_PEPPOL_SCHEME_ID,
    endpointId: colonIdx >= 0 ? peppolRaw.slice(colonIdx + 1) : "",
  }
}

/** A party's identifiers without its Peppol endpoint, in their original order. */
export function withoutPeppolEndpoint<T extends { scheme: string }>(identifiers: readonly T[]): T[] {
  return identifiers.filter((pi) => pi.scheme !== PEPPOL_ENDPOINT_SCHEME)
}
