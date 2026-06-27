import { RecordingComplianceLogger } from '../execution/logger';
import { RegimeModel } from '../types';
import { defaultRegimeRegistry } from './registry';

const log = new RecordingComplianceLogger();
const run = (m: RegimeModel) => defaultRegimeRegistry.get(m).handle({} as never, {} as never, [], log);

describe('RegimeHandlerRegistry', () => {
  it('returns a handler per regime model', () => {
    for (const m of ['POST_AUDIT', 'PERIODIC_REPORTING', 'REAL_TIME_REPORTING', 'CLEARANCE', 'DECENTRALIZED_CTC'] as RegimeModel[]) {
      expect(defaultRegimeRegistry.get(m).model).toBe(m);
    }
  });

  it('defaults an unknown model to POST_AUDIT', () => {
    expect(defaultRegimeRegistry.get('XXX' as RegimeModel).model).toBe('POST_AUDIT');
  });

  it('CLEARANCE is blocking: clearanceRequired and NOT yet cleared (async)', () => {
    const r = run('CLEARANCE');
    expect(r.clearanceRequired).toBe(true);
    expect(r.cleared).toBe(false);
  });

  it('every non-clearance regime is valid immediately (cleared, non-blocking)', () => {
    for (const m of ['POST_AUDIT', 'PERIODIC_REPORTING', 'REAL_TIME_REPORTING', 'DECENTRALIZED_CTC'] as RegimeModel[]) {
      const r = run(m);
      expect(r.clearanceRequired).toBe(false);
      expect(r.cleared).toBe(true);
    }
  });
});
