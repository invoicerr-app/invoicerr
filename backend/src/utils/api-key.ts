import { createHash, randomBytes } from 'crypto';

const API_KEY_PREFIX = 'sk_live_';

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
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
