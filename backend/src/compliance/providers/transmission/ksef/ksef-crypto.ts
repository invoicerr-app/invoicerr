/**
 * KSeF crypto helpers — pure functions for RSA-OAEP-SHA256 and AES-256-CBC operations
 * used in the KSeF 2.0 authentication and invoice encryption flows.
 *
 * All functions are side-effect-free and independently testable.
 */
import { createCipheriv, createDecipheriv, createHash, publicEncrypt, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// RSA token encryption (KSeF auth flow)
// ---------------------------------------------------------------------------

/**
 * Encrypt the KSeF token for authentication.
 *
 * Per the KSeF 2.0 spec:
 *   plaintext = "{tokenKSeF}|{timestampMs}"
 *   encrypted = RSA-OAEP-SHA256(plaintext, KsefTokenEncryption public key)
 *   output    = Base64(encrypted)
 */
export function encryptKsefToken(token: string, timestampMs: number, publicKeyPem: string): string {
  const plaintext = Buffer.from(`${token}|${timestampMs}`, 'utf8');
  const encrypted = publicEncrypt(
    {
      key: publicKeyPem,
      padding: 4, // RSA_PKCS1_OAEP
      oaepHash: 'sha256',
    },
    plaintext,
  );
  return encrypted.toString('base64');
}

// ---------------------------------------------------------------------------
// AES-256 session key management
// ---------------------------------------------------------------------------

export interface SessionKey {
  aesKey: Buffer; // 32 bytes (256 bits)
  iv: Buffer;     // 16 bytes (128 bits)
}

/** Generate a fresh AES-256 key and IV for encrypting invoice content. */
export function generateSessionKey(): SessionKey {
  return {
    aesKey: randomBytes(32),
    iv: randomBytes(16),
  };
}

/**
 * Encrypt the AES symmetric key with RSA-OAEP-SHA256 using the
 * SymmetricKeyEncryption public key from KSeF.
 */
export function encryptSymmetricKey(aesKey: Buffer, publicKeyPem: string): string {
  const encrypted = publicEncrypt(
    {
      key: publicKeyPem,
      padding: 4, // RSA_PKCS1_OAEP
      oaepHash: 'sha256',
    },
    aesKey,
  );
  return encrypted.toString('base64');
}

// ---------------------------------------------------------------------------
// Invoice XML encryption (AES-256-CBC + PKCS#7)
// ---------------------------------------------------------------------------

/**
 * Encrypt invoice XML content using AES-256-CBC with PKCS#7 padding.
 * Returns the ciphertext as a Base64 string.
 */
export function encryptXmlContent(xml: string, aesKey: Buffer, iv: Buffer): string {
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  const plaintext = Buffer.from(xml, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encrypted.toString('base64');
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 hash of a buffer or string, returned as Base64. */
export function sha256base64(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(buf).digest('base64');
}
