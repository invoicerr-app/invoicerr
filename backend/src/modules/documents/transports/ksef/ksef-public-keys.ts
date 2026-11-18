/**
 * KSeF public key management — vendorized PEM keys by environment.
 *
 * REPRISED from git tag `avant-refonte-documents` (`compliance/providers/transmission/ksef/`).
 * Keys are loaded from THIS module's own `certs/{environment}/*.pem`
 * (colocated rather than a shared top-level `backend/certs/`, since this is the only consumer —
 * copied to `dist/src` via `nest-cli.json`'s generic `**\/*.pem` asset glob, already in place)
 * — obtained from the official MF endpoint `GET /api/v2/security/public-key-certificates`.
 * No `.env`, no company input — these are MF's public keys, not ours. Only `test/` is vendored today
 * (the PROD gap: `loadVendorizedKeys('prod')` throws — fail-fast, by
 * design, rather than silently falling back to test keys against a production KSeF endpoint).
 */
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KsefEnvironment } from './ksef-client';

export interface KsefPublicKeys {
  /** RSA public key (PEM) for encrypting the KSeF auth token. */
  tokenEncryptionKeyPem: string;
  /** RSA public key (PEM) for encrypting the AES symmetric session key. */
  symmetricKeyPem: string;
}

const VENDOR_DIR = join(__dirname, 'certs');

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
