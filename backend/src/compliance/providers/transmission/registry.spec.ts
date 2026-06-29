import { RecordingComplianceLogger } from '../../execution/logger';
import { TransmissionResult } from '../../execution/types';
import { TransmissionProvider } from './transmission-provider';
import { TransmissionProviderRegistry } from './registry';

describe('TransmissionProviderRegistry — providerId resolution', () => {
  const reg = new TransmissionProviderRegistry();

  it('resolves typed channels to their default providers', () => {
    expect(reg.resolve({ type: 'EMAIL' })?.id).toBe('email');
    expect(reg.resolve({ type: 'SDI' })?.id).toBe('sdi');
    expect(reg.resolve({ type: 'PDP' })?.id).toBe('pdp');
  });

  it('a bare GOV_PORTAL_API spec (no providerId) resolves to null — there is no generic fallback', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API' })).toBeNull();
  });

  it('an unknown providerId for GOV_PORTAL_API resolves to null (no channel fallback)', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'does-not-exist' })).toBeNull();
  });

  it('an explicit providerId wins: ksef resolves to the KSeF provider', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'ksef' })?.id).toBe('ksef');
  });

  it('named national portal providers resolve by their providerId', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'sefaz' })?.id).toBe('sefaz');
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'zatca' })?.id).toBe('zatca');
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'choruspro' })?.id).toBe('choruspro');
  });

  it('exposes lookup by id', () => {
    expect(reg.getById('ksef')?.channel).toBe('GOV_PORTAL_API');
    expect(reg.getById('pac')?.channel).toBe('PAC');
    expect(reg.getById('nope')).toBeNull();
    expect(reg.getById('gov-portal')).toBeNull(); // removed — no generic fallback
  });

  it('transmitAll emits SKIPPED with an explicit note for a bare GOV_PORTAL_API channel', async () => {
    const log = new RecordingComplianceLogger();
    const results = await reg.transmitAll(
      [],
      {} as never,
      { channels: [{ type: 'GOV_PORTAL_API' }] } as never,
      'test-key',
      log,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('SKIPPED');
    expect(results[0].notes?.[0]).toMatch(/GOV_PORTAL_API requires a providerId/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency — duplicate transmit within TTL window is suppressed
// ─────────────────────────────────────────────────────────────────────────────

describe('TransmissionProviderRegistry — send idempotency', () => {
  /**
   * Build a minimal registry with one mock provider that records every
   * transmit() invocation.  The mock has no configSchema so credentials
   * resolution is skipped and transmit() is always called (or suppressed).
   */
  function buildMockRegistry(): {
    reg: TransmissionProviderRegistry;
    calls: string[];
  } {
    const calls: string[] = [];
    const mockProvider: TransmissionProvider = {
      id: 'mock-idempotency',
      channel: 'EMAIL',
      transmit: async (_artifacts, _ctx, _plan, iKey): Promise<TransmissionResult> => {
        calls.push(iKey);
        return { channel: 'EMAIL', status: 'SENT', notes: [] };
      },
    };
    const reg = new TransmissionProviderRegistry([mockProvider]);
    return { reg, calls };
  }

  const plan = { channels: [{ type: 'EMAIL' as const }] } as never;

  it('first transmit is forwarded to the provider (returns ACCEPTED)', async () => {
    const { reg, calls } = buildMockRegistry();
    const log = new RecordingComplianceLogger();
    const results = await reg.transmitAll([], {} as never, plan, 'base-key-001', log);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('SENT');
    expect(calls).toHaveLength(1);
  });

  it('second transmit with same base key within TTL is suppressed (SKIPPED)', async () => {
    const { reg, calls } = buildMockRegistry();
    const log = new RecordingComplianceLogger();

    // First send
    await reg.transmitAll([], {} as never, plan, 'base-key-002', log);
    expect(calls).toHaveLength(1);

    // Retry with the same idempotency base key → must be deduplicated
    const results2 = await reg.transmitAll([], {} as never, plan, 'base-key-002', log);
    expect(results2).toHaveLength(1);
    expect(results2[0].status).toBe('SKIPPED');
    expect(results2[0].notes?.[0]).toMatch(/idempotency/i);
    // Provider.transmit() must NOT have been called a second time
    expect(calls).toHaveLength(1);
  });

  it('different base keys are not confused with each other', async () => {
    const { reg, calls } = buildMockRegistry();
    const log = new RecordingComplianceLogger();

    await reg.transmitAll([], {} as never, plan, 'key-A', log);
    await reg.transmitAll([], {} as never, plan, 'key-B', log);

    // Both keys are distinct → both forwarded
    expect(calls).toHaveLength(2);
  });

  it('expired TTL allows a re-send (simulated by manipulating internal clock)', async () => {
    const { reg, calls } = buildMockRegistry();
    const log = new RecordingComplianceLogger();

    // First send
    await reg.transmitAll([], {} as never, plan, 'base-key-003', log);
    expect(calls).toHaveLength(1);

    // Simulate TTL expiry: back-date the stored timestamp beyond the window.
    // Access the private map via bracket notation (test-only escape hatch).
    const seenKeys = (reg as unknown as Record<string, Map<string, number>>)['_seenKeys'];
    const iKey = [...seenKeys.keys()][0];
    seenKeys.set(iKey, Date.now() - 6 * 60 * 1000); // 6 minutes ago (> 5-min TTL)

    // Should now be forwarded again (key expired)
    const results2 = await reg.transmitAll([], {} as never, plan, 'base-key-003', log);
    expect(results2[0].status).toBe('SENT');
    expect(calls).toHaveLength(2);
  });
});
