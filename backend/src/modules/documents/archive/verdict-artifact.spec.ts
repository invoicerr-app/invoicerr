/**
 * `buildVerdictArtifact` — a pure function, proven the same way `hashing.spec.ts` proves
 * `computeContentHash`: stable for identical input, sensitive to every field that makes two verdicts
 * genuinely different.
 */
import { computeContentHash } from './hashing';
import { AttestedDeposit, buildVerdictArtifact, TerminalAuthorityVerdict } from './verdict-artifact';

const VERDICT: TerminalAuthorityVerdict = {
  providerId: 'pdp',
  statusCode: 'fr:202',
  statusText: 'Reçue par la plateforme',
  reason: null,
  observedAt: new Date('2026-09-06T10:00:00.000Z'),
  rawPayload: { events: [{ status_code: 'fr:202' }] },
};

const DEPOSIT: AttestedDeposit = {
  documentId: 'doc-1',
  archiveId: 'archive-1',
  contentHash: 'deadbeef',
};

const RECEIVED_AT = new Date('2026-09-06T10:00:05.000Z');

function hashOf(verdict: TerminalAuthorityVerdict, deposit: AttestedDeposit, receivedAt: Date): string {
  return computeContentHash([buildVerdictArtifact(verdict, deposit, receivedAt)]);
}

describe('buildVerdictArtifact', () => {
  it('produces a role/mime dedicated to a verdict — never mistaken for a deliverable format', () => {
    const artifact = buildVerdictArtifact(VERDICT, DEPOSIT, RECEIVED_AT);
    expect(artifact.role).toBe('authority-verdict');
    expect(artifact.mime).toBe('application/json');
  });

  it('embeds the raw payload verbatim, the deposit reference, and both timestamps', () => {
    const artifact = buildVerdictArtifact(VERDICT, DEPOSIT, RECEIVED_AT);
    const parsed = JSON.parse(new TextDecoder().decode(artifact.bytes));

    expect(parsed).toEqual({
      providerId: 'pdp',
      statusCode: 'fr:202',
      statusText: 'Reçue par la plateforme',
      reason: null,
      observedAt: VERDICT.observedAt.toISOString(),
      receivedAt: RECEIVED_AT.toISOString(),
      rawPayload: VERDICT.rawPayload,
      deposit: { documentId: 'doc-1', archiveId: 'archive-1', contentHash: 'deadbeef' },
    });
  });

  it('is deterministic — the exact same input hashes to the exact same content hash', () => {
    const first = hashOf(VERDICT, DEPOSIT, RECEIVED_AT);
    const second = hashOf(VERDICT, DEPOSIT, RECEIVED_AT);
    expect(first).toBe(second);
  });

  it('the hash changes when the raw payload is mutated, even if statusCode stays identical', () => {
    const mutated: TerminalAuthorityVerdict = {
      ...VERDICT,
      rawPayload: { events: [{ status_code: 'fr:202', extra: 'a byte that was not there before' }] },
    };
    expect(hashOf(mutated, DEPOSIT, RECEIVED_AT)).not.toBe(hashOf(VERDICT, DEPOSIT, RECEIVED_AT));
  });

  it('the hash changes when the status code differs', () => {
    const rejected: TerminalAuthorityVerdict = { ...VERDICT, statusCode: 'fr:213', reason: 'BR-01 missing' };
    expect(hashOf(rejected, DEPOSIT, RECEIVED_AT)).not.toBe(hashOf(VERDICT, DEPOSIT, RECEIVED_AT));
  });

  it('the hash changes when the reception timestamp differs, even for the same verdict', () => {
    const laterReceipt = new Date(RECEIVED_AT.getTime() + 1000);
    expect(hashOf(VERDICT, DEPOSIT, laterReceipt)).not.toBe(hashOf(VERDICT, DEPOSIT, RECEIVED_AT));
  });

  it('the hash changes when the deposit it attests to differs (a different document, or a different contentHash)', () => {
    const otherDeposit: AttestedDeposit = { ...DEPOSIT, contentHash: 'a-different-hash' };
    expect(hashOf(VERDICT, otherDeposit, RECEIVED_AT)).not.toBe(hashOf(VERDICT, DEPOSIT, RECEIVED_AT));
  });

  it('defaults statusText/reason/rawPayload to null when absent — never `undefined` leaking into the archived JSON', () => {
    const minimal: TerminalAuthorityVerdict = {
      providerId: 'ksef',
      statusCode: 'pl:200',
      observedAt: new Date('2026-09-06T10:00:00.000Z'),
    };
    const artifact = buildVerdictArtifact(minimal, DEPOSIT, RECEIVED_AT);
    const parsed = JSON.parse(new TextDecoder().decode(artifact.bytes));
    expect(parsed.statusText).toBeNull();
    expect(parsed.reason).toBeNull();
    expect(parsed.rawPayload).toBeNull();
  });
});
