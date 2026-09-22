/**
 * Distinguishes an already-encrypted `Webhook.secret` value (the AES-256-GCM blob
 * `utils/secret-crypto.ts#encryptJson` produces: `JSON.stringify({ v: 1, iv, tag, ct })`) from a
 * legacy plaintext HMAC secret — every row written before this column started being encrypted
 * at rest. Deliberately key-independent (a shape check, never an attempted decrypt): both the
 * write path (skip re-encrypting an already-encrypted value on an unrelated update) and the boot
 * migration (skip a row already migrated, by a previous boot or by `WebhooksService` itself since the
 * fix landed) need to answer "is this still plaintext" WITHOUT `CREDENTIALS_ENCRYPTION_KEY` even being
 * configured — a `decryptJson` failure conflates "wrong format" with "wrong/missing key", which is
 * exactly the ambiguity this check exists to avoid.
 */
export function isEncryptedWebhookSecret(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const blob = parsed as Record<string, unknown>;
  return (
    blob.v === 1 && typeof blob.iv === 'string' && typeof blob.tag === 'string' && typeof blob.ct === 'string'
  );
}
