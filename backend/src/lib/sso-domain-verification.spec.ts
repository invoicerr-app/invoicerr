/**
 * Pure unit tests for the DNS TXT domain-ownership challenge — no Prisma, no `node:dns`. See
 * `sso-domain-verification.ts`'s own header for why every rule here can (and must) be exercised
 * without a database or a network round-trip.
 */
import {
  buildVerificationRecordName,
  buildVerificationRecordValue,
  generateVerificationToken,
  matchesVerificationToken,
} from './sso-domain-verification';

describe('generateVerificationToken', () => {
  it('is URL-safe — no "+", "/" or "=" a browser or shell could mangle', () => {
    // Run several times: a single lucky draw could pass this even from a bad encoding.
    for (let i = 0; i < 50; i += 1) {
      expect(generateVerificationToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries at least 128 bits of entropy', () => {
    // Base64url packs 6 bits per character; a token below ~22 characters could not reach 128 bits.
    expect(generateVerificationToken().length).toBeGreaterThanOrEqual(22);
  });

  it('is drawn from a CSPRNG, never `Math.random` — every call must differ', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateVerificationToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('buildVerificationRecordName', () => {
  it('uses a dedicated "_invoicerr-sso" label, never the bare apex', () => {
    expect(buildVerificationRecordName('acme.com')).toBe('_invoicerr-sso.acme.com');
  });

  it('is a pure function of the domain — no trailing dot, no case change of its own', () => {
    expect(buildVerificationRecordName('Acme.com')).toBe('_invoicerr-sso.Acme.com');
  });
});

describe('buildVerificationRecordValue', () => {
  it('embeds the token behind a stable, greppable prefix', () => {
    expect(buildVerificationRecordValue('abc123')).toBe('invoicerr-sso-verification=abc123');
  });
});

describe('matchesVerificationToken', () => {
  const token = 'a-real-token-value';
  const expected = buildVerificationRecordValue(token);

  it('matches a single-chunk record equal to the expected value', () => {
    expect(matchesVerificationToken([[expected]], token)).toBe(true);
  });

  it('joins a record split across several chunks before comparing — the documented dns.resolveTxt shape', () => {
    // A TXT value over 255 bytes is chunked by DNS itself; Node's `dns.resolveTxt` surfaces that as
    // several array entries for the SAME record. Comparing chunk-by-chunk (or only the first chunk)
    // would reject a perfectly valid, merely-long record — only the JOINED value is meaningful.
    const chunked = [expected.slice(0, 5), expected.slice(5, 12), expected.slice(12)];
    expect(matchesVerificationToken([chunked], token)).toBe(true);
  });

  it('matches when the right record is ANY of several unrelated ones in the zone', () => {
    expect(
      matchesVerificationToken(
        [['v=spf1 include:_spf.example.com ~all'], [expected], ['some-other-vendor-code=xyz']],
        token,
      ),
    ).toBe(true);
  });

  it('tolerates a literal pair of surrounding double quotes', () => {
    expect(matchesVerificationToken([[`"${expected}"`]], token)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(matchesVerificationToken([[`  ${expected}  `]], token)).toBe(true);
  });

  it('is false when no record matches', () => {
    expect(matchesVerificationToken([['unrelated'], ['also unrelated']], token)).toBe(false);
  });

  it('is false for an empty record set — DNS not yet published, not an error', () => {
    expect(matchesVerificationToken([], token)).toBe(false);
  });

  it('does not match a DIFFERENT token — a stale or unrelated claim must not pass', () => {
    expect(matchesVerificationToken([[expected]], 'a-different-token')).toBe(false);
  });
});
