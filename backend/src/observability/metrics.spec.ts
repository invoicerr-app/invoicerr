import { bearerToken, recordHttpRequest, renderMetrics, routeLabel } from './metrics';

describe('routeLabel', () => {
  it('uses the route template, never the raw path', () => {
    expect(routeLabel({ baseUrl: '', route: { path: '/api/public/documents/:token' } } as never)).toBe(
      '/api/public/documents/:token',
    );
  });

  it('labels requests no route matched as unmatched', () => {
    expect(routeLabel({ baseUrl: '', route: undefined } as never)).toBe('unmatched');
  });
});

describe('renderMetrics', () => {
  it('answers 404 when metrics are disabled', async () => {
    const result = await renderMetrics(undefined, { enabled: false, token: undefined });
    expect(result.status).toBe(404);
  });

  it('serves the registry without a token when none is configured', async () => {
    recordHttpRequest('GET', '/api/clients', 503, 0.12);
    const result = await renderMetrics(undefined, { enabled: true, token: undefined });
    expect(result.status).toBe(200);
    expect(result.body).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/clients",status_code="503"} 1',
    );
    expect(result.body).toContain('invoicerr_http_server_errors_total{method="GET",route="/api/clients"} 1');
  });

  it('does not count a 4xx as a server error', async () => {
    recordHttpRequest('POST', '/api/quotes', 422, 0.01);
    const result = await renderMetrics(undefined, { enabled: true, token: undefined });
    expect(result.body).not.toContain('invoicerr_http_server_errors_total{method="POST"');
  });

  it('requires the bearer token when one is configured', async () => {
    const config = { enabled: true, token: 's3cret' };
    expect((await renderMetrics(undefined, config)).status).toBe(401);
    expect((await renderMetrics('Bearer wrong', config)).status).toBe(401);
    expect((await renderMetrics('Basic s3cret', config)).status).toBe(401);
    expect((await renderMetrics('Bearer s3cret', config)).status).toBe(200);
  });
});

describe('bearerToken', () => {
  it('reads the token after a case-insensitive Bearer scheme', () => {
    expect(bearerToken('Bearer s3cret')).toBe('s3cret');
    expect(bearerToken('bearer   s3cret  ')).toBe('s3cret');
    expect(bearerToken('BEARER\ts3cret')).toBe('s3cret');
  });

  it('rejects other schemes, a missing token and a scheme glued to the token', () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken('Basic s3cret')).toBeUndefined();
    expect(bearerToken('Bearer')).toBeUndefined();
    expect(bearerToken('Bearer    ')).toBeUndefined();
    expect(bearerToken('Bearers3cret')).toBeUndefined();
  });

  it('stays linear on a long run of spaces', () => {
    const header = `bearer ${' '.repeat(200_000)}x\n`;
    const start = performance.now();
    expect(bearerToken(header)).toBe('x');
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
