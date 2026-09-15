import { backendPublicUrl } from './backend-public-url';

describe('backendPublicUrl', () => {
  const originalAppUrl = process.env.APP_URL;
  const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
    process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
  });

  it('falls back to APP_URL when BACKEND_PUBLIC_URL is unset', () => {
    delete process.env.BACKEND_PUBLIC_URL;
    process.env.APP_URL = 'https://app.example.com';

    expect(backendPublicUrl()).toBe('https://app.example.com');
  });

  it('uses BACKEND_PUBLIC_URL when set, even though APP_URL is also set — this one wins', () => {
    process.env.APP_URL = 'http://localhost:5173';
    process.env.BACKEND_PUBLIC_URL = 'https://tunnel.example.com';

    expect(backendPublicUrl()).toBe('https://tunnel.example.com');
  });

  it('falls back to localhost:3000 when NEITHER is set', () => {
    delete process.env.BACKEND_PUBLIC_URL;
    delete process.env.APP_URL;

    expect(backendPublicUrl()).toBe('http://localhost:3000');
  });

  it('strips a trailing slash off either source', () => {
    delete process.env.BACKEND_PUBLIC_URL;
    process.env.APP_URL = 'https://app.example.com/';
    expect(backendPublicUrl()).toBe('https://app.example.com');

    process.env.BACKEND_PUBLIC_URL = 'https://tunnel.example.com/';
    expect(backendPublicUrl()).toBe('https://tunnel.example.com');
  });
});
