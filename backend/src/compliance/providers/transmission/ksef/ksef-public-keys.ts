/**
 * KSeF public key management — vendorized PEM keys by environment.
 *
 * Keys are loaded from src/compliance/certs/ksef/{environment}/*.pem (copied to dist via nest-cli assets) (obtained from the
 * official MF endpoint GET /api/v2/security/public-key-certificates). No .env,
 * no company input — these are MF's public keys, not ours.
 *
 * Optional: a runtime cache can refresh keys from the live endpoint (e.g. for
 * key rotation after 2027-09-29 expiry). Falls back to vendorized on fetch failure.
 */
import { createPublicKey } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { KsefEnvironment } from './ksef-client';
import type { KsefHttpClient } from './ksef-client';

export interface KsefPublicKeys {
  /** RSA public key (PEM) for encrypting the KSeF auth token. */
  tokenEncryptionKeyPem: string;
  /** RSA public key (PEM) for encrypting the AES symmetric session key. */
  symmetricKeyPem: string;
}

const VENDOR_DIR = join(__dirname, '..', '..', '..', 'certs', 'ksef');

// In-memory cache keyed by environment
const cache = new Map<KsefEnvironment, KsefPublicKeys>();

/**
 * Load vendorized public keys for the given environment.
 * Reads from backend/certs/ksef/{env}/token-encryption.pem and symmetric-key-encryption.pem.
 * Throws if files are missing (fail-fast — without keys, transmission is impossible).
 */
export function loadVendorizedKeys(environment: KsefEnvironment): KsefPublicKeys {
  const cached = cache.get(environment);
  if (cached) return cached;

  const dir = join(VENDOR_DIR, environment);
  const tokenKeyPath = join(dir, 'token-encryption.pem');
  const symKeyPath = join(dir, 'symmetric-key-encryption.pem');

  const tokenCertPem = readFileSync(tokenKeyPath, 'utf8');
  const symCertPem = readFileSync(symKeyPath, 'utf8');

  const tokenEncryptionKeyPem = extractPublicKeyFromCert(tokenCertPem);
  const symmetricKeyPem = extractPublicKeyFromCert(symCertPem);

  const keys: KsefPublicKeys = { tokenEncryptionKeyPem, symmetricKeyPem };
  cache.set(environment, keys);
  return keys;
}

/** Extract SPKI public key from an X.509 certificate PEM. */
function extractPublicKeyFromCert(certPem: string): string {
  const keyObj = createPublicKey({ key: certPem, format: 'pem', type: 'spki' });
  return keyObj.export({ type: 'spki', format: 'pem' }) as string;
}

/**
 * Optionally refresh keys from the live KSeF endpoint.
 * Caches the result in memory for the lifetime of the process.
 * Falls back to vendorized on any error (network, parse, etc.).
 */
export async function refreshKeysFromApi(
  environment: KsefEnvironment,
  http: KsefHttpClient,
): Promise<KsefPublicKeys> {
  try {
    const baseUrls: Record<KsefEnvironment, string> = {
      test: 'https://api-test.ksef.mf.gov.pl/v2',
      prod: 'https://api.ksef.mf.gov.pl/v2',
    };
    const res = await http.request({
      method: 'GET',
      path: `${baseUrls[environment]}/security/public-key-certificates`,
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const certs = res.body as Array<{
      certificate: string; // Base64 DER
      usage: string[];
    }>;

    let tokenKeyPem: string | undefined;
    let symKeyPem: string | undefined;

    for (const cert of certs) {
      const pem = derToPem(cert.certificate);
      if (cert.usage.includes('KsefTokenEncryption')) tokenKeyPem = pem;
      if (cert.usage.includes('SymmetricKeyEncryption')) symKeyPem = pem;
    }

    if (tokenKeyPem && symKeyPem) {
      const keys: KsefPublicKeys = {
        tokenEncryptionKeyPem: tokenKeyPem,
        symmetricKeyPem: symKeyPem,
      };
      cache.set(environment, keys);
      return keys;
    }
  } catch {
    // Fall through to vendorized
  }

  return loadVendorizedKeys(environment);
}

/** Convert a Base64 DER certificate to PEM public key. */
function derToPem(base64Der: string): string {
  // Reconstruct the full certificate PEM, then extract the public key
  const lines = base64Der.match(/.{1,64}/g) ?? [base64Der];
  const certPem =
    '-----BEGIN CERTIFICATE-----\n' +
    lines.join('\n') +
    '\n-----END CERTIFICATE-----';

  const keyObj = createPublicKey({ key: Buffer.from(certPem, 'utf8'), format: 'pem', type: 'spki' });
  return keyObj.export({ type: 'spki', format: 'pem' }) as string;
}
