import { createHash, randomBytes } from 'crypto';

const API_KEY_PREFIX = 'sk_live_';

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

// Not a password hash: `key` is a 256-bit value from `generateApiKey()` (crypto.randomBytes),
// not a low-entropy user secret, so a slow/salted hash (bcrypt etc.) buys no protection here —
// it would only break the O(1) `keyHash` lookup this is used for (same approach as GitHub/Stripe
// API keys).
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex'); // lgtm[js/insufficient-password-hash]
}

export function extractApiKey(headers: Record<string, unknown>): string | undefined {
  const apiKeyHeader = headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
    return apiKeyHeader;
  }

  const authHeader = headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  return undefined;
}
