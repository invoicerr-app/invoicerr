/**
 * `maskSecretConfig`/`mergeConfigPreservingMaskedSecrets` (`plugins.service.ts`) in isolation — no
 * controller, no Prisma. `plugins.controller.spec.ts`'s own S3 scenarios cover the two functions
 * wired together through the real routes; this file is the pure-function-level proof each one holds
 * on its own, field-name pattern included.
 */
import { MASKED_SECRET, maskSecretConfig, mergeConfigPreservingMaskedSecrets } from './plugins.service';

describe('maskSecretConfig', () => {
  it('redacts fields whose NAME looks like a credential, whatever the provider', () => {
    expect(
      maskSecretConfig({
        accessKey: 'AKIAREALVALUE',
        secretKey: 'sh1sh1sh1',
        apiKey: 'abc',
        clientSecret: 'def',
        password: 'ghi',
        webhookToken: 'jkl',
      }),
    ).toEqual({
      accessKey: MASKED_SECRET,
      secretKey: MASKED_SECRET,
      apiKey: MASKED_SECRET,
      clientSecret: MASKED_SECRET,
      password: MASKED_SECRET,
      webhookToken: MASKED_SECRET,
    });
  });

  it('leaves ordinary, non-credential fields untouched — a settings form still needs to show them', () => {
    expect(maskSecretConfig({ region: 'eu-west-3', bucket: 'my-bucket', storagePath: '/data' })).toEqual({
      region: 'eu-west-3',
      bucket: 'my-bucket',
      storagePath: '/data',
    });
  });

  it('never masks an empty/absent value into a fake-looking secret', () => {
    expect(maskSecretConfig({ accessKey: '', secretKey: undefined })).toEqual({
      accessKey: '',
      secretKey: undefined,
    });
  });

  it('returns {} for null/undefined — a plugin never configured has nothing to redact', () => {
    expect(maskSecretConfig(null)).toEqual({});
    expect(maskSecretConfig(undefined)).toEqual({});
  });
});

describe('mergeConfigPreservingMaskedSecrets', () => {
  it('keeps the STORED secret when the incoming value is exactly the mask placeholder', () => {
    const existing = { accessKey: 'AKIAREALVALUE', secretKey: 'sh1sh1sh1', bucket: 'old' };
    const incoming = { accessKey: MASKED_SECRET, secretKey: MASKED_SECRET, bucket: 'new' };

    expect(mergeConfigPreservingMaskedSecrets(existing, incoming)).toEqual({
      accessKey: 'AKIAREALVALUE',
      secretKey: 'sh1sh1sh1',
      bucket: 'new',
    });
  });

  it('stores a genuinely NEW secret value as submitted, never the stale one', () => {
    const existing = { accessKey: 'AKIAOLDVALUE' };
    const incoming = { accessKey: 'AKIANEWVALUE' };

    expect(mergeConfigPreservingMaskedSecrets(existing, incoming)).toEqual({ accessKey: 'AKIANEWVALUE' });
  });

  it('handles a first-time configuration with no existing config at all', () => {
    expect(mergeConfigPreservingMaskedSecrets(null, { bucket: 'new' })).toEqual({ bucket: 'new' });
  });
});
