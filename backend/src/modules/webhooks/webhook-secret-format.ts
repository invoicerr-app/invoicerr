/**
 * Distinguishes an encrypted `Webhook.secret` (the `{ v: 1, iv, tag, ct }` blob `encryptJson`
 * produces) from a legacy plaintext value. A shape check rather than a decrypt attempt, so it works
 * with no `CREDENTIALS_ENCRYPTION_KEY` and never conflates "wrong format" with "wrong key".
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
