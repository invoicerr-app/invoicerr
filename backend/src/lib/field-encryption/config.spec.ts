import { describe, expect, it } from 'vitest';

import { DEFAULT_OKMS_TIMEOUT_MS, FieldEncryptionConfigError, parseFieldEncryptionConfig } from './config';

const exists = () => true;

const complete = {
  FIELD_ENCRYPTION_ENABLED: 'true',
  OKMS_ENDPOINT: 'https://eu-west-rbx.okms.ovh.net/api/okms-id/',
  OKMS_SERVICE_KEY_ID: 'service-key',
  OKMS_CERT_PATH: '/run/secrets/okms.crt',
  OKMS_KEY_PATH: '/run/secrets/okms.key',
  FIELD_KEYS: 'k2:wrapped-two, k1:wrapped-one',
  FIELD_KEY_CURRENT: 'k2',
  BLIND_INDEX_KEY: 'wrapped-index',
};

function problemsOf(env: Record<string, string | undefined>, fileExists = exists): string[] {
  try {
    parseFieldEncryptionConfig(env, fileExists);
  } catch (err) {
    expect(err).toBeInstanceOf(FieldEncryptionConfigError);
    return (err as FieldEncryptionConfigError).problems;
  }
  throw new Error('expected a FieldEncryptionConfigError');
}

describe('parseFieldEncryptionConfig', () => {
  it('is off with nothing set, without reading any other variable', () => {
    expect(parseFieldEncryptionConfig({}, () => false)).toEqual({ enabled: false, forcePlaintext: false });
  });

  it('stays off when only KMS variables are set: the flag is the only switch', () => {
    const { FIELD_ENCRYPTION_ENABLED: _, ...rest } = complete;
    expect(parseFieldEncryptionConfig(rest, exists)).toEqual({ enabled: false, forcePlaintext: false });
  });

  it('rejects a flag that is neither true nor false instead of guessing', () => {
    expect(problemsOf({ FIELD_ENCRYPTION_ENABLED: 'yes' })).toEqual([
      'FIELD_ENCRYPTION_ENABLED must be "true" or "false", got "yes"',
    ]);
  });

  it('reads the force-plaintext switch when off', () => {
    expect(parseFieldEncryptionConfig({ FIELD_ENCRYPTION_FORCE_PLAINTEXT: 'TRUE' }, exists)).toEqual({
      enabled: false,
      forcePlaintext: true,
    });
  });

  it('parses a complete configuration', () => {
    const config = parseFieldEncryptionConfig(complete, exists);
    expect(config).toEqual({
      enabled: true,
      okms: {
        endpoint: 'https://eu-west-rbx.okms.ovh.net/api/okms-id',
        serviceKeyId: 'service-key',
        certPath: '/run/secrets/okms.crt',
        keyPath: '/run/secrets/okms.key',
        timeoutMs: DEFAULT_OKMS_TIMEOUT_MS,
      },
      wrappedFieldKeys: new Map([
        ['k2', 'wrapped-two'],
        ['k1', 'wrapped-one'],
      ]),
      currentKeyId: 'k2',
      wrappedBlindIndexKey: 'wrapped-index',
      allowPlaintextRead: false,
    });
  });

  it('lists every missing variable at once when enabled', () => {
    expect(problemsOf({ FIELD_ENCRYPTION_ENABLED: 'true' })).toEqual([
      'OKMS_ENDPOINT is required',
      'OKMS_SERVICE_KEY_ID is required',
      'OKMS_CERT_PATH is required',
      'OKMS_KEY_PATH is required',
      'FIELD_KEYS is required',
      'FIELD_KEY_CURRENT is required',
      'BLIND_INDEX_KEY is required',
    ]);
  });

  it('refuses a current key that is not in FIELD_KEYS', () => {
    expect(problemsOf({ ...complete, FIELD_KEY_CURRENT: 'k3' })).toEqual([
      'FIELD_KEY_CURRENT "k3" is not one of the key ids listed in FIELD_KEYS',
    ]);
  });

  it('refuses malformed, duplicated or unsafe key ids', () => {
    expect(
      problemsOf({ ...complete, FIELD_KEYS: 'k2:a,k2:b,bad.id:c,nocolon', FIELD_KEY_CURRENT: 'k2' }),
    ).toEqual([
      'FIELD_KEYS lists key id "k2" more than once',
      'FIELD_KEYS key id "bad.id" must be 1 to 32 characters among A-Z, a-z, 0-9, _ and -',
      'FIELD_KEYS entry "nocolon..." is not of the form keyId:wrappedKey',
    ]);
  });

  it('refuses missing certificate files, a plain HTTP endpoint and a bad timeout', () => {
    expect(
      problemsOf({ ...complete, OKMS_ENDPOINT: 'http://kms.local', OKMS_TIMEOUT_MS: '0' }, (p) =>
        p.endsWith('.crt'),
      ),
    ).toEqual([
      'OKMS_ENDPOINT must start with https://',
      'OKMS_KEY_PATH points to a missing file: /run/secrets/okms.key',
      'OKMS_TIMEOUT_MS must be a positive integer in milliseconds, got "0"',
    ]);
  });

  it('reads the timeout and the plaintext read window', () => {
    const config = parseFieldEncryptionConfig(
      { ...complete, OKMS_TIMEOUT_MS: '1500', ALLOW_PLAINTEXT_READ: 'true' },
      exists,
    );
    expect(config.enabled && config.okms.timeoutMs).toBe(1500);
    expect(config.enabled && config.allowPlaintextRead).toBe(true);
  });

  it('never echoes a wrapped key in its error message', () => {
    const message = (() => {
      try {
        parseFieldEncryptionConfig({ ...complete, FIELD_KEYS: 'secretwrappedvaluewithoutcolon' }, exists);
      } catch (err) {
        return (err as Error).message;
      }
      return '';
    })();
    expect(message).not.toContain('secretwrappedvaluewithoutcolon');
  });
});
