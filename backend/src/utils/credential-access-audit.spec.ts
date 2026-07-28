/**
 * §188 — CredentialAccessAudit unit tests.
 *
 * Verifies:
 *   - Emitted events carry correct companyId, credentialRef, action, outcome, timestamp.
 *   - Decrypted secret values (passwords, private keys, PFX bytes) are NEVER included.
 *   - Capture mode works (test helper).
 *   - ISO 8601 timestamp format.
 */

import { CredentialAccessAudit, credentialAudit } from './credential-access-audit';

describe('CredentialAccessAudit', () => {
  let audit: CredentialAccessAudit;

  beforeEach(() => {
    audit = new CredentialAccessAudit();
  });

  it('emits events captured by capture()', () => {
    const captured = audit.capture();

    audit.emit({
      companyId: 'company-abc',
      credentialRef: 'pdp:TEST',
      action: 'RESOLVE',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].companyId).toBe('company-abc');
    expect(captured[0].credentialRef).toBe('pdp:TEST');
    expect(captured[0].action).toBe('RESOLVE');
    expect(captured[0].outcome).toBe('HIT');
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const captured = audit.capture();
    const ts = new Date().toISOString();

    audit.emit({
      companyId: 'c',
      credentialRef: 'ref',
      action: 'RESOLVE',
      outcome: 'MISS',
      timestamp: ts,
    });

    const parsed = Date.parse(captured[0].timestamp);
    expect(isNaN(parsed)).toBe(false);
  });

  it('stopCapture() clears the buffer so further emits go to logger (no error)', () => {
    audit.capture();
    audit.stopCapture();

    // Should not throw even though nothing is capturing.
    expect(() =>
      audit.emit({
        companyId: 'c',
        credentialRef: 'r',
        action: 'RESOLVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('SECURITY — event object must not contain secret fields', () => {
    const captured = audit.capture();

    // Simulate what the service emits.
    audit.emit({
      companyId: 'co-1',
      credentialRef: 'pdp:PROD',
      action: 'RESOLVE',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
      // The context is allowed to have non-secret metadata.
      context: { label: 'PDP prod 2025', environment: 'PROD' },
    });

    const event = captured[0];
    const eventJson = JSON.stringify(event);

    // These strings must never appear in a serialised audit event.
    const forbidden = [
      'password',
      'secret',
      'privateKey',
      'pfxBase64',
      'encryptedPfx',
      'encryptedPass',
      'clientSecret',
      'apiKey',
      'p12Password',
    ];

    for (const key of forbidden) {
      expect(eventJson.toLowerCase()).not.toContain(key.toLowerCase());
    }
  });

  it('context may carry non-secret metadata (label, environment)', () => {
    const captured = audit.capture();

    audit.emit({
      companyId: 'co-2',
      credentialRef: 'cert-id-123',
      action: 'ROTATE',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
      context: { label: 'FR prod 2025', environment: 'PROD', applicability: '*' },
    });

    expect(captured[0].context?.label).toBe('FR prod 2025');
    expect(captured[0].context?.environment).toBe('PROD');
  });

  it('process singleton credentialAudit is an instance of CredentialAccessAudit', () => {
    expect(credentialAudit).toBeInstanceOf(CredentialAccessAudit);
  });

  it('emits all outcome types without error', () => {
    const captured = audit.capture();
    const base = { companyId: 'c', credentialRef: 'r', timestamp: new Date().toISOString() };

    audit.emit({ ...base, action: 'RESOLVE', outcome: 'HIT' });
    audit.emit({ ...base, action: 'RESOLVE', outcome: 'MISS' });
    audit.emit({ ...base, action: 'RESOLVE', outcome: 'ERROR' });
    audit.emit({ ...base, action: 'UPLOAD', outcome: 'HIT' });
    audit.emit({ ...base, action: 'DEACTIVATE', outcome: 'HIT' });
    audit.emit({ ...base, action: 'ROTATE', outcome: 'HIT' });

    expect(captured).toHaveLength(6);
  });
});
