import { classifyLiveVerdict, reportInconclusiveVerdict } from './live-verdict-outcome';

describe('classifyLiveVerdict', () => {
  it('is decided as soon as fr:202 is journaled', () => {
    expect(classifyLiveVerdict(['api:uploaded', 'fr:200', 'fr:201', 'fr:202'])).toBe('decided');
  });

  it('is decided on a rejection (fr:213), so the caller can fail on it', () => {
    expect(classifyLiveVerdict(['fr:200', 'fr:213'])).toBe('decided');
  });

  it('is inconclusive when fr:200 and fr:201 arrived but no terminal status', () => {
    expect(classifyLiveVerdict(['fr:201', 'fr:200', 'api:uploaded'])).toBe('inconclusive');
  });

  it('fails when fr:201 is missing', () => {
    expect(classifyLiveVerdict(['fr:200', 'api:uploaded'])).toBe('failed');
  });

  it('fails when fr:200 is missing', () => {
    expect(classifyLiveVerdict(['fr:201'])).toBe('failed');
  });

  it('fails on an empty journal', () => {
    expect(classifyLiveVerdict([])).toBe('failed');
  });
});

describe('reportInconclusiveVerdict', () => {
  const codes = ['fr:201', 'fr:200', 'api:uploaded'];

  it('emits a GitHub warning annotation naming the deposit and the journal', () => {
    const log = vi.fn();
    reportInconclusiveVerdict('2157268', codes, 90_000, { summaryPath: undefined, log });
    expect(log).toHaveBeenCalledTimes(1);
    const line: string = log.mock.calls[0][0];
    expect(line.startsWith('::warning title=SuperPDP verdict inconclusive::')).toBe(true);
    expect(line).toContain('deposit 2157268');
    expect(line).toContain('within 90s');
    expect(line).toContain(JSON.stringify(codes));
  });

  it('appends a section to the job summary when one is available', () => {
    const appendFile = vi.fn();
    reportInconclusiveVerdict('2157268', codes, 90_000, {
      summaryPath: '/tmp/summary.md',
      appendFile,
      log: () => undefined,
    });
    expect(appendFile).toHaveBeenCalledTimes(1);
    const [path, body] = appendFile.mock.calls[0];
    expect(path).toBe('/tmp/summary.md');
    expect(body).toContain('`2157268`');
    expect(body).toContain(JSON.stringify(codes));
  });

  it('writes no summary outside GitHub Actions', () => {
    const appendFile = vi.fn();
    reportInconclusiveVerdict('1', codes, 90_000, {
      summaryPath: undefined,
      appendFile,
      log: () => undefined,
    });
    expect(appendFile).not.toHaveBeenCalled();
  });
});
