import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FieldEncryptionBootError,
  ciphertextCountSql,
  getFieldCipher,
  initFieldEncryption,
  isPlaintextReadAllowed,
  resetFieldEncryptionForTests,
} from './boot';
import { FieldEncryptionConfigError } from './config';

const enabledEnv = {
  FIELD_ENCRYPTION_ENABLED: 'true',
  OKMS_ENDPOINT: 'https://kms.example.test/api/okms-id',
  OKMS_SERVICE_KEY_ID: 'svc',
  OKMS_CERT_PATH: '/certs/okms.crt',
  OKMS_KEY_PATH: '/certs/okms.key',
  FIELD_KEYS: 'k2:wrapped-k2,k1:wrapped-k1',
  FIELD_KEY_CURRENT: 'k2',
  BLIND_INDEX_KEY: 'wrapped-index',
};

const quiet = { log: vi.fn(), warn: vi.fn() };
const columns = [{ table: 'ClientContact', column: 'email' }];

function fakeKms(failOn?: string) {
  const unwrapDataKey = vi.fn(async (wrapped: string) => {
    if (wrapped === failOn) throw new Error('connect ECONNREFUSED');
    return randomBytes(32);
  });
  return { unwrapDataKey, createKms: vi.fn(() => ({ unwrapDataKey })) };
}

afterEach(() => {
  resetFieldEncryptionForTests();
  vi.clearAllMocks();
});

describe('initFieldEncryption, off', () => {
  it('makes no KMS call and no database call with nothing set', async () => {
    const kms = fakeKms();
    const countCiphertext = vi.fn(async () => 0);
    const state = await initFieldEncryption({
      env: {},
      createKms: kms.createKms,
      countCiphertext,
      log: quiet,
    });
    expect(state.cipher).toBeNull();
    expect(getFieldCipher()).toBeNull();
    expect(isPlaintextReadAllowed()).toBe(true);
    expect(kms.createKms).not.toHaveBeenCalled();
    expect(countCiphertext).not.toHaveBeenCalled();
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it('refuses to start while ciphertext is stored', async () => {
    const countCiphertext = vi.fn(async () => 3);
    await expect(
      initFieldEncryption({ env: {}, countCiphertext, encryptedColumns: columns, log: quiet }),
    ).rejects.toThrow(/disabled but 3 encrypted value\(s\) are stored/);
    expect(countCiphertext).toHaveBeenCalledWith(columns);
  });

  it('starts when no ciphertext is stored', async () => {
    const countCiphertext = vi.fn(async () => 0);
    await expect(
      initFieldEncryption({ env: {}, countCiphertext, encryptedColumns: columns, log: quiet }),
    ).resolves.toEqual({ cipher: null, allowPlaintextRead: false });
  });

  it('starts despite stored ciphertext only with FIELD_ENCRYPTION_FORCE_PLAINTEXT, and says so', async () => {
    const countCiphertext = vi.fn(async () => 3);
    await initFieldEncryption({
      env: { FIELD_ENCRYPTION_FORCE_PLAINTEXT: 'true' },
      countCiphertext,
      encryptedColumns: columns,
      log: quiet,
    });
    expect(countCiphertext).not.toHaveBeenCalled();
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringContaining('FIELD_ENCRYPTION_FORCE_PLAINTEXT=true'));
  });
});

describe('initFieldEncryption, on', () => {
  it('unwraps every key once at boot and serves a working cipher', async () => {
    const kms = fakeKms();
    const state = await initFieldEncryption({
      env: enabledEnv,
      fileExists: () => true,
      createKms: kms.createKms,
      log: quiet,
    });
    expect(kms.createKms).toHaveBeenCalledWith(
      expect.objectContaining({ serviceKeyId: 'svc', timeoutMs: 5000 }),
    );
    expect(kms.unwrapDataKey.mock.calls.map(([w]) => w).sort()).toEqual([
      'wrapped-index',
      'wrapped-k1',
      'wrapped-k2',
    ]);
    const cipher = getFieldCipher();
    expect(cipher).toBe(state.cipher);
    expect(cipher?.currentKeyId).toBe('k2');
    expect(cipher?.keyIds.sort()).toEqual(['k1', 'k2']);
    const cell = { model: 'Client', column: 'name', id: 'c1' };
    expect(cipher?.decrypt(cipher.encrypt('Acme', cell), cell)).toBe('Acme');
    expect(isPlaintextReadAllowed()).toBe(false);
  });

  it('refuses to start with an incomplete configuration, before any KMS call', async () => {
    const kms = fakeKms();
    await expect(
      initFieldEncryption({
        env: { FIELD_ENCRYPTION_ENABLED: 'true' },
        createKms: kms.createKms,
        log: quiet,
      }),
    ).rejects.toBeInstanceOf(FieldEncryptionConfigError);
    expect(kms.createKms).not.toHaveBeenCalled();
    expect(getFieldCipher()).toBeNull();
  });

  it('refuses to start when the KMS cannot unwrap a key', async () => {
    const kms = fakeKms('wrapped-k1');
    const error = await initFieldEncryption({
      env: enabledEnv,
      fileExists: () => true,
      createKms: kms.createKms,
      log: quiet,
    }).catch((err) => err);
    expect(error).toBeInstanceOf(FieldEncryptionBootError);
    expect(error.message).toContain('field key "k1" could not be unwrapped');
    expect(error.message).not.toContain('wrapped-k1');
    expect(getFieldCipher()).toBeNull();
  });

  it('refuses to start when the KMS returns a key of the wrong size', async () => {
    const createKms = () => ({ unwrapDataKey: async () => randomBytes(16) });
    await expect(
      initFieldEncryption({ env: enabledEnv, fileExists: () => true, createKms, log: quiet }),
    ).rejects.toThrow(/unusable/);
  });

  it('opens the plaintext read window only when asked, with a warning', async () => {
    const kms = fakeKms();
    await initFieldEncryption({
      env: { ...enabledEnv, ALLOW_PLAINTEXT_READ: 'true' },
      fileExists: () => true,
      createKms: kms.createKms,
      log: quiet,
    });
    expect(isPlaintextReadAllowed()).toBe(true);
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringContaining('ALLOW_PLAINTEXT_READ=true'));
  });
});

describe('ciphertextCountSql', () => {
  it('builds one probe per column and refuses unsafe identifiers', () => {
    expect(ciphertextCountSql([...columns, { table: 'User', column: 'email' }])).toBe(
      `SELECT count(*)::int AS count FROM "ClientContact" WHERE "email" LIKE 'v1.%' UNION ALL SELECT count(*)::int AS count FROM "User" WHERE "email" LIKE 'v1.%'`,
    );
    expect(() => ciphertextCountSql([{ table: 'User"; drop', column: 'email' }])).toThrow(/Invalid/);
  });
});
