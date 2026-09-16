import { acceptLegalFromEndpointContext, legalAcceptanceRequiredAtSignup } from './legal-signup-policy';

describe('legalAcceptanceRequiredAtSignup', () => {
  it('never blocks outside SaaS mode, regardless of acceptLegal', () => {
    expect(legalAcceptanceRequiredAtSignup(false, true)).toBe(false);
    expect(legalAcceptanceRequiredAtSignup(false, false)).toBe(false);
    expect(legalAcceptanceRequiredAtSignup(false, undefined)).toBe(false);
  });

  it('blocks in SaaS mode unless acceptLegal is literally true', () => {
    expect(legalAcceptanceRequiredAtSignup(true, true)).toBe(false);
    expect(legalAcceptanceRequiredAtSignup(true, false)).toBe(true);
    expect(legalAcceptanceRequiredAtSignup(true, undefined)).toBe(true);
    expect(legalAcceptanceRequiredAtSignup(true, 'true')).toBe(true);
    expect(legalAcceptanceRequiredAtSignup(true, 1)).toBe(true);
  });
});

describe('acceptLegalFromEndpointContext', () => {
  it('reads a literal true off context.body.acceptLegal', () => {
    expect(acceptLegalFromEndpointContext({ body: { acceptLegal: true } })).toBe(true);
  });

  it('is false for anything else, including malformed context', () => {
    expect(acceptLegalFromEndpointContext({ body: { acceptLegal: false } })).toBe(false);
    expect(acceptLegalFromEndpointContext({ body: {} })).toBe(false);
    expect(acceptLegalFromEndpointContext({ body: { acceptLegal: 'true' } })).toBe(false);
    expect(acceptLegalFromEndpointContext({})).toBe(false);
    expect(acceptLegalFromEndpointContext(null)).toBe(false);
    expect(acceptLegalFromEndpointContext(undefined)).toBe(false);
    expect(acceptLegalFromEndpointContext('nonsense')).toBe(false);
  });
});
