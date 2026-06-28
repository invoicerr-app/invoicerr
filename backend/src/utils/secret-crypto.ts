/**
 * AES-256-GCM encryption/decryption for credential blobs.
 *
 * The encryption key MUST come from the CREDENTIALS_ENCRYPTION_KEY env var.
 * Never hardcode credentials — this module encrypts/decrypts the opaque config
 * blobs stored in CompanyChannelConfig.config.
 *
 * Generate a key:  openssl rand -hex 32
 *
 * Wire: if the key is absent or invalid at startup, isEncryptionAvailable() returns
 * false and the channel-credentials feature disables itself gracefully (no crash,
 * no save of secrets).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // 96 bits — recommended for GCM
const TAG_LEN = 16;  // 128-bit auth tag
const FORMAT_VERSION = 1;

interface EncryptedBlob {
  v: number;   // format version
  iv: string;  // base64
  tag: string; // base64
  ct: string;  // base64
}

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

function resolveKey(): Buffer | null {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) return null;

  // Accept hex (64 chars) or base64 (44 chars raw)
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.length !== 32) return null;
  return buf;
}

/**
 * Returns true when a valid 32-byte encryption key is available.
 * Use this to gate the entire channel-credentials subsystem at startup.
 */
export function isEncryptionAvailable(): boolean {
  return resolveKey() !== null;
}

// ---------------------------------------------------------------------------
// encryptJson / decryptJson
// ---------------------------------------------------------------------------

/**
 * Encrypt an arbitrary JSON-serialisable object → opaque string.
 * The output is a JSON string: { v, iv, tag, ct } all base64-encoded.
 */
export function encryptJson(obj: unknown): string {
  const key = resolveKey();
  if (!key) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is missing or invalid (must be 32 bytes hex or base64). ' +
      'Generate one with: openssl rand -hex 32',
    );
  }

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob: EncryptedBlob = {
    v: FORMAT_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
  return JSON.stringify(blob);
}

/**
 * Decrypt an opaque string (produced by encryptJson) back to the original object.
 * Throws on tampered data, wrong key, or bad format.
 */
export function decryptJson<T = unknown>(encrypted: string): T {
  const key = resolveKey();
  if (!key) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is missing or invalid — cannot decrypt.',
    );
  }

  let blob: EncryptedBlob;
  try {
    blob = JSON.parse(encrypted);
  } catch {
    throw new Error('decryptJson: input is not valid JSON');
  }

  if (blob.v !== FORMAT_VERSION) {
    throw new Error(`decryptJson: unsupported format version ${blob.v}`);
  }

  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ct = Buffer.from(blob.ct, 'base64');

  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);

  return JSON.parse(plaintext.toString('utf8')) as T;
}
