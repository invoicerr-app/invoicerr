/**
 * A thin client for a Photon (komoot) geocoder instance - the low-level HTTP/JSON transport, split
 * from `address-autocomplete.service.ts` the same way `ocr-service/local-client.ts` splits the OCR
 * engine's own transport from the mapping on top of it: this file is what a real `node:http` stub
 * exercises in `photon-client.spec.ts`, never a mocked `fetch`.
 *
 * Photon's own API (https://photon.komoot.io/api/?q=...) is a single `GET /api/` endpoint returning
 * a GeoJSON `FeatureCollection`. Every candidate's `properties` carries whichever of these an OSM
 * entry actually has - none are guaranteed present:
 *   { name, housenumber, street, postcode, city, town, village, county, state, country, countrycode,
 *     osm_key, osm_value, ... }
 * `city` is filled from the first of city/town/village/county that Photon returned - OSM tags a
 * settlement differently depending on its size, and this app's forms have exactly one "city" field.
 */
export class PhotonClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotonClientError';
  }
}

export const DEFAULT_TIMEOUT_MS = 5000;

/** Identifies this instance to the geocoder - matters most for the shared photon.komoot.io demo
 *  server, whose fair-use policy is the whole reason this feature defaults to off (see
 *  `address-autocomplete.service.ts`'s own header). */
export const USER_AGENT = 'invoicerr/1.0 (+https://github.com/Impre-visible/invoicerr)';

interface PhotonProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
}

interface PhotonFeature {
  properties?: PhotonProperties;
}

interface PhotonFeatureCollection {
  features?: PhotonFeature[];
}

export interface AddressSuggestion {
  label: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  countryCode?: string;
}

function mapFeature(feature: PhotonFeature): AddressSuggestion | null {
  const p = feature.properties ?? {};
  const city = p.city ?? p.town ?? p.village ?? p.county;
  const houseNumber = p.housenumber;
  const street = p.street;

  const lines = [
    [houseNumber, street].filter(Boolean).join(' '),
    [p.postcode, city].filter(Boolean).join(' '),
    p.country,
  ].filter((line) => line && line.trim().length > 0);

  const label = lines.length > 0 ? lines.join(', ') : p.name;
  if (!label) return null; // Nothing usable in this candidate - dropped rather than shown blank.

  return {
    label,
    street,
    houseNumber,
    postalCode: p.postcode,
    city,
    country: p.country,
    countryCode: p.countrycode ? p.countrycode.toUpperCase() : undefined,
  };
}

/**
 * Queries `{baseUrl}/api/?q=...` and returns up to `limit` suggestions.
 *
 * Every failure mode (network error, non-2xx, malformed JSON, a hung server) is a NAMED
 * `PhotonClientError` - never a silent empty array here. `address-autocomplete.service.ts` is the
 * layer that decides an outage degrades to "no suggestions" rather than a 5xx to the browser; this
 * client only reports the truth of the round trip, exactly like `company-lookup/http.ts`'s own
 * `fetchJson` does for the registry providers.
 */
export async function fetchPhotonSuggestions(
  baseUrl: string,
  query: string,
  limit: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AddressSuggestion[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/?q=${encodeURIComponent(query)}&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PhotonClientError(
      msg.toLowerCase().includes('abort') ? `Photon request timed out after ${timeoutMs}ms` : msg,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new PhotonClientError(`Photon responded ${res.status} ${res.statusText}`);
  }

  let body: PhotonFeatureCollection;
  try {
    body = (await res.json()) as PhotonFeatureCollection;
  } catch {
    throw new PhotonClientError('Photon returned a malformed JSON body');
  }

  return (body.features ?? [])
    .map(mapFeature)
    .filter((suggestion): suggestion is AddressSuggestion => suggestion !== null)
    .slice(0, limit);
}
