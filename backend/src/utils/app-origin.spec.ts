import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appOrigin } from './app-origin';

describe('appOrigin', () => {
  const original = process.env.APP_URL;

  beforeEach(() => {
    delete process.env.APP_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  });

  it('strips trailing slashes from APP_URL', () => {
    process.env.APP_URL = 'https://invoicerr.example.com/';
    expect(appOrigin()).toBe('https://invoicerr.example.com');
  });

  it('falls back to the Vite dev origin when APP_URL is unset', () => {
    expect(appOrigin()).toBe('http://localhost:5173');
  });
});
