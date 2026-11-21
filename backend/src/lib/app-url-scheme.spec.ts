import { insecureAppUrlWarning, servedOverHttps } from './app-url-scheme';

describe('servedOverHttps', () => {
  it.each([
    ['https://invoicerr.example.com', true],
    ['HTTPS://invoicerr.example.com', true],
    ['http://nas.local:8181', false],
    ['http://localhost:3000', false],
    ['nas.local:8181', false],
    ['', false],
  ])('%s -> %s', (appUrl, expected) => {
    expect(servedOverHttps(appUrl)).toBe(expected);
  });
});

describe('insecureAppUrlWarning', () => {
  it('names an http APP_URL and says cookies are not secure', () => {
    const warning = insecureAppUrlWarning('http://nas.local:8181');

    expect(warning).toContain('http://nas.local:8181');
    expect(warning).toMatch(/not secure/i);
    expect(warning).toMatch(/https/i);
  });

  it('warns when APP_URL is unset, since sessions then fall back to plain http', () => {
    expect(insecureAppUrlWarning(undefined)).toMatch(/APP_URL is not set/);
    expect(insecureAppUrlWarning('  ')).toMatch(/APP_URL is not set/);
  });

  it.each([
    'https://invoicerr.example.com',
    'http://localhost:6284',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('stays quiet for %s', (appUrl) => {
    expect(insecureAppUrlWarning(appUrl)).toBeNull();
  });
});
