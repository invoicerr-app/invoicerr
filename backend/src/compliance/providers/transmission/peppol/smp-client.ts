/**
 * Peppol SMP/SML lookup client.
 *
 * The 4-corner model routes documents from Sender's AP (corner 2) to Receiver's AP (corner 3),
 * discovered via the SML/SMP infrastructure:
 *
 *   1. SML DNS lookup:
 *      DNS NAPTR record for `b-{MD5(lowercase(identifier))}.iso6523-actorid-upis.{sml-zone}`
 *      → redirects to the SMP server hosting the participant's metadata.
 *      (Peppol uses `B-{md5}.iso6523-actorid-upis.edelivery.tech` for production,
 *       `B-{md5}.iso6523-actorid-upis.acc.edelivery.tech` for test/OpenPeppol AccAP)
 *
 *   2. SMP HTTP lookup:
 *      GET `https://{smp-host}/{icd}:{identifier}/services/{encoded-document-type}`
 *      → Returns ServiceMetadata XML: Endpoint URL + supported document types.
 *
 * LIVE PROOF: DEFERRED — requires a Peppol-connected Access Point with PROD or
 * OpenPeppol AccAP (test environment) credentials. All tests use a mocked SmpLookupPort.
 */

import * as dns from 'dns';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeppolParticipantId {
  /** ICD scheme code, e.g. '0009' (GLN), '9908' (NO:ORG), '0208' (BE:EN). */
  icd: string;
  /** Participant identifier (e.g. company registration number). */
  identifier: string;
}

export interface PeppolEndpoint {
  /** AS4 endpoint URL at the receiver's Access Point. */
  url: string;
  /** Certificate (PEM) of the receiver's AP for AS4 transport-level validation. */
  transportProfile: string;
  /** ISO 8601 activation date. */
  serviceActivationDate?: string;
  /** ISO 8601 expiration date. */
  serviceExpirationDate?: string;
}

export interface SmpLookupResult {
  /** Resolved AP endpoint for the requested document type. */
  endpoint: PeppolEndpoint;
  /** Supported document type identifiers. */
  documentTypeIds: string[];
}

// ---------------------------------------------------------------------------
// Port — swappable SMP transport (real DNS+HTTP or mock in tests)
// ---------------------------------------------------------------------------

/**
 * Port for SMP lookup — can be mocked in tests without real DNS/network access.
 */
export interface SmpLookupPort {
  /**
   * Look up the SMP endpoint for a given participant + document type.
   * Returns null when the participant is not registered or does not support the document type.
   */
  lookup(
    participant: PeppolParticipantId,
    documentTypeId: string,
    environment: 'TEST' | 'PROD',
  ): Promise<SmpLookupResult | null>;
}

// ---------------------------------------------------------------------------
// Real DNS-based SMP lookup implementation
// ---------------------------------------------------------------------------

/** Peppol SML DNS zones. */
const SML_ZONES: Record<string, string> = {
  PROD: 'edelivery.tech',
  TEST: 'acc.edelivery.tech',
};

/**
 * RFC-3986 encode a document type ID for SMP URL path (replaces :: with %3A%3A etc.)
 */
function encodeSmpDocumentTypeId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * Compute the SML DNS hostname for a Peppol participant.
 * Formula: B-{lowercase-MD5(icd::identifier)}.iso6523-actorid-upis.{zone}
 */
function smlDnsHostname(participant: PeppolParticipantId, zone: string): string {
  const raw = `${participant.icd}:${participant.identifier}`.toLowerCase();
  const hash = crypto.createHash('md5').update(raw).digest('hex').toLowerCase();
  return `b-${hash}.iso6523-actorid-upis.${zone}`;
}

/**
 * Minimal XML parser to extract the Endpoint URL from SMP ServiceMetadata XML.
 * A full XML parse library is overkill for a single field; SMP responses are small.
 */
function extractEndpointFromXml(xml: string): PeppolEndpoint | null {
  const urlMatch = xml.match(/<EndpointURI[^>]*>([^<]+)<\/EndpointURI>/);
  if (!urlMatch) return null;
  const profileMatch = xml.match(/<TransportProfile[^>]*>([^<]+)<\/TransportProfile>/);
  const activationMatch = xml.match(/<ServiceActivationDate[^>]*>([^<]+)<\/ServiceActivationDate>/);
  const expirationMatch = xml.match(/<ServiceExpirationDate[^>]*>([^<]+)<\/ServiceExpirationDate>/);

  return {
    url: urlMatch[1].trim(),
    transportProfile: profileMatch?.[1]?.trim() ?? 'peppol-transport-as4-v2_0',
    serviceActivationDate: activationMatch?.[1]?.trim(),
    serviceExpirationDate: expirationMatch?.[1]?.trim(),
  };
}

/**
 * Real DNS + HTTP SMP lookup.
 * Requires network access to the Peppol SML DNS zone and the participant's SMP server.
 */
export class DnsSmpLookup implements SmpLookupPort {
  async lookup(
    participant: PeppolParticipantId,
    documentTypeId: string,
    environment: 'TEST' | 'PROD',
  ): Promise<SmpLookupResult | null> {
    const zone = SML_ZONES[environment] ?? SML_ZONES['PROD'];
    const hostname = smlDnsHostname(participant, zone);

    // Step 1: DNS NAPTR lookup to find the SMP host
    const smpHost = await this.resolveSmpHost(hostname);
    if (!smpHost) return null;

    // Step 2: HTTP GET the SMP ServiceMetadata
    const encodedDocType = encodeSmpDocumentTypeId(documentTypeId);
    const smpUrl = `https://${smpHost}/${participant.icd}%3A${encodeURIComponent(participant.identifier)}/services/${encodedDocType}`;

    try {
      const response = await fetch(smpUrl, {
        headers: { Accept: 'application/xml' },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`SMP HTTP ${response.status} for ${smpUrl}`);

      const xml = await response.text();
      const endpoint = extractEndpointFromXml(xml);
      if (!endpoint) return null;

      return {
        endpoint,
        documentTypeIds: [documentTypeId],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`SMP lookup failed for ${participant.icd}:${participant.identifier}: ${msg}`);
    }
  }

  private resolveSmpHost(hostname: string): Promise<string | null> {
    return new Promise((resolve) => {
      dns.resolveCname(hostname, (err, addresses) => {
        if (err || !addresses?.length) {
          // CNAME lookup failed — participant may not be registered
          resolve(null);
          return;
        }
        // CNAME points to the SMP host (strip trailing dot if present)
        resolve(addresses[0].replace(/\.$/, ''));
      });
    });
  }
}
