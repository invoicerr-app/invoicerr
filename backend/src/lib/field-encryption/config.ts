import { existsSync } from 'node:fs';

export const DEFAULT_OKMS_TIMEOUT_MS = 5000;

const KEY_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface OkmsSettings {
  endpoint: string;
  serviceKeyId: string;
  certPath: string;
  keyPath: string;
  timeoutMs: number;
}

export type FieldEncryptionConfig =
  | { enabled: false; forcePlaintext: boolean }
  | {
      enabled: true;
      okms: OkmsSettings;
      wrappedFieldKeys: Map<string, string>;
      currentKeyId: string;
      wrappedBlindIndexKey: string;
      allowPlaintextRead: boolean;
    };

export class FieldEncryptionConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Field encryption configuration is invalid:\n- ${problems.join('\n- ')}\nFix these variables, or unset FIELD_ENCRYPTION_ENABLED to run without field encryption. The application refuses to start rather than write plaintext while encryption is requested.`,
    );
    this.name = 'FieldEncryptionConfigError';
  }
}

type Env = Record<string, string | undefined>;

/** Strict boolean: only `true`/`false` (any case, trimmed) or empty are accepted. */
export function parseBooleanFlag(name: string, raw: string | undefined, problems: string[]): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  problems.push(`${name} must be "true" or "false", got "${raw}"`);
  return false;
}

/** Parses `FIELD_KEYS`, a comma-separated list of `keyId:wrappedKey` entries. */
export function parseFieldKeys(raw: string, problems: string[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    const id = separator === -1 ? '' : trimmed.slice(0, separator).trim();
    const wrapped = separator === -1 ? '' : trimmed.slice(separator + 1).trim();
    if (!id || !wrapped) {
      problems.push(`FIELD_KEYS entry "${trimmed.slice(0, 16)}..." is not of the form keyId:wrappedKey`);
      continue;
    }
    if (!KEY_ID_RE.test(id)) {
      problems.push(`FIELD_KEYS key id "${id}" must be 1 to 32 characters among A-Z, a-z, 0-9, _ and -`);
      continue;
    }
    if (keys.has(id)) {
      problems.push(`FIELD_KEYS lists key id "${id}" more than once`);
      continue;
    }
    keys.set(id, wrapped);
  }
  return keys;
}

/**
 * Reads the field encryption contract from the environment. Pure: never touches the KMS, only checks
 * that the certificate files exist. Throws `FieldEncryptionConfigError` listing every problem at once.
 */
export function parseFieldEncryptionConfig(
  env: Env,
  fileExists: (path: string) => boolean = existsSync,
): FieldEncryptionConfig {
  const problems: string[] = [];
  const enabled = parseBooleanFlag('FIELD_ENCRYPTION_ENABLED', env.FIELD_ENCRYPTION_ENABLED, problems);
  const forcePlaintext = parseBooleanFlag(
    'FIELD_ENCRYPTION_FORCE_PLAINTEXT',
    env.FIELD_ENCRYPTION_FORCE_PLAINTEXT,
    problems,
  );

  if (!enabled) {
    if (problems.length > 0) throw new FieldEncryptionConfigError(problems);
    return { enabled: false, forcePlaintext };
  }

  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) problems.push(`${name} is required`);
    return value ?? '';
  };

  const endpoint = required('OKMS_ENDPOINT').replace(/\/+$/, '');
  if (endpoint && !/^https:\/\//i.test(endpoint)) problems.push('OKMS_ENDPOINT must start with https://');
  const serviceKeyId = required('OKMS_SERVICE_KEY_ID');
  const certPath = required('OKMS_CERT_PATH');
  if (certPath && !fileExists(certPath))
    problems.push(`OKMS_CERT_PATH points to a missing file: ${certPath}`);
  const keyPath = required('OKMS_KEY_PATH');
  if (keyPath && !fileExists(keyPath)) problems.push(`OKMS_KEY_PATH points to a missing file: ${keyPath}`);

  let timeoutMs = DEFAULT_OKMS_TIMEOUT_MS;
  const rawTimeout = env.OKMS_TIMEOUT_MS?.trim();
  if (rawTimeout) {
    timeoutMs = Number(rawTimeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      problems.push(`OKMS_TIMEOUT_MS must be a positive integer in milliseconds, got "${rawTimeout}"`);
    }
  }

  const rawKeys = required('FIELD_KEYS');
  const wrappedFieldKeys = rawKeys ? parseFieldKeys(rawKeys, problems) : new Map<string, string>();
  if (rawKeys && wrappedFieldKeys.size === 0 && problems.length === 0) {
    problems.push('FIELD_KEYS lists no key');
  }
  const currentKeyId = required('FIELD_KEY_CURRENT');
  if (currentKeyId && wrappedFieldKeys.size > 0 && !wrappedFieldKeys.has(currentKeyId)) {
    problems.push(`FIELD_KEY_CURRENT "${currentKeyId}" is not one of the key ids listed in FIELD_KEYS`);
  }
  const wrappedBlindIndexKey = required('BLIND_INDEX_KEY');
  const allowPlaintextRead = parseBooleanFlag('ALLOW_PLAINTEXT_READ', env.ALLOW_PLAINTEXT_READ, problems);

  if (problems.length > 0) throw new FieldEncryptionConfigError(problems);

  return {
    enabled: true,
    okms: { endpoint, serviceKeyId, certPath, keyPath, timeoutMs },
    wrappedFieldKeys,
    currentKeyId,
    wrappedBlindIndexKey,
    allowPlaintextRead,
  };
}
