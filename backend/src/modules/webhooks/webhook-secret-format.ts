import { isEncryptedBlob } from '@/utils/secret-crypto';

/**
 * Distinguishes an encrypted `Webhook.secret` (the `{ v: 1, iv, tag, ct }` blob `encryptJson`
 * produces) from a legacy plaintext value. A shape check rather than a decrypt attempt, so it works
 * with no `CREDENTIALS_ENCRYPTION_KEY` and never conflates "wrong format" with "wrong key". The shape
 * itself is `secret-crypto.ts#isEncryptedBlob`'s, never a copy of it here.
 */
export function isEncryptedWebhookSecret(value: string): boolean {
  return isEncryptedBlob(value);
}
