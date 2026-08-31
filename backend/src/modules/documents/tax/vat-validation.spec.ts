/**
 * Reprise, adaptée, des vérités "C4" du repère (`compliance/canonical/vat-validation.spec.ts`) — les
 * trois verdicts et leur non-collapse, avec un DOUBLE de `ViesProvider` plutôt que le vrai réseau
 * (le VRAI service est prouvé par `vat-validation.live.spec.ts`, live-gaté).
 */
import {
  FakeSyntaxOnlyVatValidationClient,
  NullVatValidationClient,
  ViesLikeProvider,
  ViesVatValidationClient,
} from './vat-validation';

function providerThat(behaviour: 'valid' | 'invalid' | 'throws' | 'unsupported'): ViesLikeProvider {
  return {
    supports: () => behaviour !== 'unsupported',
    lookup: async () => {
      if (behaviour === 'throws') throw new Error('MS_MAX_CONCURRENT_REQ');
      return behaviour === 'valid' ? { VAT: 'IT12345678901' } : null;
    },
  };
}

describe('C4 — the three verdicts, and none of them may be collapsed', () => {
  it('VALID — the member state confirmed the number', async () => {
    const client = new ViesVatValidationClient(providerThat('valid'));
    const r = await client.validate('IT', 'IT12345678901');
    expect(r.status).toBe('VALID');
    expect(r.source).toBe('eu-vies');
    expect(r.checkedAt).toBeInstanceOf(Date);
  });

  it('INVALID — the member state answered, and denied it', async () => {
    const client = new ViesVatValidationClient(providerThat('invalid'));
    expect((await client.validate('IT', 'IT00000000000')).status).toBe('INVALID');
  });

  it('UNAVAILABLE — the service could not be asked, and it does not throw', async () => {
    const client = new ViesVatValidationClient(providerThat('throws'));
    await expect(client.validate('IT', 'IT12345678901')).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });

  it("UNAVAILABLE — a country VIES does not cover is not the number's fault", async () => {
    const client = new ViesVatValidationClient(providerThat('unsupported'));
    expect((await client.validate('US', '123456789')).status).toBe('UNAVAILABLE');
  });

  it('the null client never claims validity — the conservative default, with an honest reason', async () => {
    const r = await new NullVatValidationClient().validate('FR', 'FR12345678901');
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.source).toBe('none');
  });
});

describe('FakeSyntaxOnlyVatValidationClient — e2e-only, offline, never a real VIES call', () => {
  it('answers VALID for a syntactically-valid number, network-free', async () => {
    const r = await new FakeSyntaxOnlyVatValidationClient().validate('DE', 'DE136695976');
    expect(r.status).toBe('VALID');
    expect(r.source).toMatch(/fake-syntax-only/);
  });
  it('answers INVALID for a syntactically-broken number — never VALID by accident', async () => {
    const r = await new FakeSyntaxOnlyVatValidationClient().validate('DE', 'DE000000000');
    expect(r.status).toBe('INVALID');
  });
});
