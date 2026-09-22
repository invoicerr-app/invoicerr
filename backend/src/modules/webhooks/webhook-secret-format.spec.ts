import { encryptJson } from '@/utils/secret-crypto';

import { isEncryptedWebhookSecret } from './webhook-secret-format';

describe('isEncryptedWebhookSecret', () => {
  it('recognizes a real encryptJson blob', () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(isEncryptedWebhookSecret(encryptJson('whatever-secret'))).toBe(true);
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });

  it('recognizes the literal shape without needing a key at all', () => {
    expect(isEncryptedWebhookSecret(JSON.stringify({ v: 1, iv: 'aa', tag: 'bb', ct: 'cc' }))).toBe(true);
  });

  it('rejects a legacy plaintext secret', () => {
    expect(isEncryptedWebhookSecret('my-plain-hmac-secret')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isEncryptedWebhookSecret('')).toBe(false);
  });

  it('rejects arbitrary JSON that happens to parse but is not the blob shape', () => {
    expect(isEncryptedWebhookSecret(JSON.stringify({ hello: 'world' }))).toBe(false);
    expect(isEncryptedWebhookSecret(JSON.stringify(['v', 1]))).toBe(false);
    expect(isEncryptedWebhookSecret('42')).toBe(false);
    expect(isEncryptedWebhookSecret('null')).toBe(false);
  });

  it('rejects a blob with the wrong format version', () => {
    expect(isEncryptedWebhookSecret(JSON.stringify({ v: 2, iv: 'aa', tag: 'bb', ct: 'cc' }))).toBe(false);
  });

  it('rejects a blob missing a required field', () => {
    expect(isEncryptedWebhookSecret(JSON.stringify({ v: 1, iv: 'aa', tag: 'bb' }))).toBe(false);
  });
});
