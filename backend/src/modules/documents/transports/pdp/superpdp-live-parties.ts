import { calculateFrenchVAT } from '../../../sirene/sirene.utils';
import { SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import { PdpClient } from './pdp-client';

/** Env vars every superpdp live spec needs: the OAuth client and the routing id of the sandbox
 *  company that client belongs to. */
export const SUPERPDP_LIVE_ENV = ['SUPERPDP_CLIENT_ID', 'SUPERPDP_CLIENT_SECRET', 'SUPERPDP_SELLER_ROUTING'];

/** Extra env var for the specs that send to the other sandbox company. */
export const SUPERPDP_BUYER_ENV = ['SUPERPDP_BUYER_ROUTING'];

// One host serves both sandbox and production; the credential pair decides which.
export const SUPERPDP_BASE_URL = process.env.SUPERPDP_BASE_URL || 'https://api.superpdp.tech';

const ROUTING_SCHEME = '0225';

export function superpdpLiveClient(): PdpClient {
  return new PdpClient({
    baseUrl: SUPERPDP_BASE_URL,
    clientId: process.env.SUPERPDP_CLIENT_ID ?? '',
    clientSecret: process.env.SUPERPDP_CLIENT_SECRET ?? '',
    apiStyle: 'superpdp',
  });
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

/** The authenticated company as `GET /v1.beta/companies/me` describes it, addressed at
 *  SUPERPDP_SELLER_ROUTING. The client must already be authenticated. */
export async function resolveSandboxCompany(client: PdpClient): Promise<SemanticPartyInput> {
  const me = await client.getCompany();
  const name = text(me?.formal_name, text(me?.name, ''));
  const legalId = text(me?.number, '');
  if (!name || !legalId) {
    throw new Error(`superpdp /companies/me returned no name or number: ${JSON.stringify(me)}`);
  }
  return {
    name,
    address: text(me.address, '1 rue de la Paix'),
    city: text(me.city, 'Paris'),
    postalCode: text(me.postcode, '75002'),
    country: 'France',
    email: 'seller@example.fr',
    partyIdentifiers: [
      { scheme: 'VAT', value: calculateFrenchVAT(legalId) },
      { scheme: 'LEGAL_ID', value: legalId },
      { scheme: 'PEPPOL_ENDPOINT', value: `${ROUTING_SCHEME}:${process.env.SUPERPDP_SELLER_ROUTING}` },
    ],
  };
}

/** The other sandbox company, known only by its routing id: the platform describes the
 *  authenticated company alone, so no SIREN or VAT number is sent for the buyer. */
export function sandboxBuyer(): SemanticPartyInput {
  return {
    name: 'Sandbox buyer',
    address: '1 rue de la Paix',
    city: 'Paris',
    postalCode: '75002',
    country: 'France',
    email: 'buyer@example.fr',
    partyIdentifiers: [
      { scheme: 'PEPPOL_ENDPOINT', value: `${ROUTING_SCHEME}:${process.env.SUPERPDP_BUYER_ROUTING}` },
    ],
  };
}
