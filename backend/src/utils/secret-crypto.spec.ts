import { encryptJson, decryptJson, isEncryptionAvailable } from './secret-crypto';

const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

describe('secret-crypto', () => {
  const origEnv = process.env.CREDENTIALS_ENCRYPTION_KEY;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIALS_ENCRYPTION_KEY = origEnv;
    }
  });

  it('isEncryptionAvailable returns true with a valid key', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    expect(isEncryptionAvailable()).toBe(true);
  });

  it('isEncryptionAvailable returns false when key is missing', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(isEncryptionAvailable()).toBe(false);
  });

  it('isEncryptionAvailable returns false when key is wrong size', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'ff'; // 1 byte
    expect(isEncryptionAvailable()).toBe(false);
  });

  it('encryptJson throws when key is missing', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptJson({ foo: 'bar' })).toThrow('CREDENTIALS_ENCRYPTION_KEY');
  });

  it('decryptJson throws when key is missing', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => decryptJson('{"v":1}')).toThrow('CREDENTIALS_ENCRYPTION_KEY');
  });

  it('round-trips a complex object', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    const obj = {
      authToken: 'tok_abc123',
      nip: 'PL1234567890',
      nested: { deep: true, count: 42 },
      arr: [1, 'two', null],
    };
    const encrypted = encryptJson(obj);
    expect(typeof encrypted).toBe('string');
    const decrypted = decryptJson(encrypted);
    expect(decrypted).toEqual(obj);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    const a = encryptJson({ x: 1 });
    const b = encryptJson({ x: 1 });
    expect(a).not.toBe(b); // different IVs → different ciphertext
  });

  it('decryptJson throws on tampered ciphertext', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    const encrypted = encryptJson({ secret: true });
    const blob = JSON.parse(encrypted);
    // tamper with ciphertext
    blob.ct = Buffer.from('garbage').toString('base64');
    expect(() => decryptJson(JSON.stringify(blob))).toThrow();
  });

  it('decryptJson throws on wrong key', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    const encrypted = encryptJson({ secret: true });
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decryptJson(encrypted)).toThrow();
  });

  it('decryptJson throws on invalid format version', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
    const encrypted = encryptJson({ secret: true });
    const blob = JSON.parse(encrypted);
    blob.v = 99;
    expect(() => decryptJson(JSON.stringify(blob))).toThrow('unsupported format version');
  });

  it('accepts base64-encoded keys', () => {
    // 32 bytes = 44 base64 chars
    process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');
    expect(isEncryptionAvailable()).toBe(true);
    const obj = { test: 'base64-key' };
    const encrypted = encryptJson(obj);
    expect(decryptJson(encrypted)).toEqual(obj);
  });
});
