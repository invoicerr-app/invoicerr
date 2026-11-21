import { randomUUID } from 'node:crypto';

import prisma from '@/prisma/prisma.service';

/**
 * The session cookie a real sign-in sets, read off the HTTP response, for each scheme APP_URL can
 * name. Real better-auth, real Postgres.
 */
vi.setConfig({ testTimeout: 30_000 });

const PASSWORD = 'Session-cookie-spec-1!';

type Auth = typeof import('./auth')['auth'];

async function authServedAt(appUrl: string, nodeEnv: string): Promise<Auth> {
  vi.resetModules();
  vi.stubEnv('APP_URL', appUrl);
  vi.stubEnv('NODE_ENV', nodeEnv);
  return (await import('./auth')).auth;
}

async function createUser(auth: Auth): Promise<string> {
  const id = `session-cookie-${randomUUID()}`;
  const email = `${id}@example.test`;
  await prisma.user.create({ data: { id, email, firstname: 'Cookie', lastname: 'Spec' } });
  const { password } = await auth.$context;
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: await password.hash(PASSWORD),
    },
  });
  return email;
}

async function signInFrom(auth: Auth, appUrl: string, email: string): Promise<Response> {
  return auth.handler(
    new Request(`${appUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

function sessionCookieOf(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((c) => /^(__Secure-)?better-auth\.session_token=/.test(c));
  if (!cookie) throw new Error(`no session cookie on a ${response.status} sign-in`);
  return cookie;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('session cookie set by sign-in', () => {
  it('is a __Secure- cookie with the Secure attribute when APP_URL is https', async () => {
    const appUrl = 'https://invoicerr.example.test';
    const auth = await authServedAt(appUrl, 'test');

    const response = await signInFrom(auth, appUrl, await createUser(auth));

    expect(response.status).toBe(200);
    const cookie = sessionCookieOf(response);
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/;\s*Secure(;|$)/i);
  });

  it('is a plain cookie that signs the user in when a production instance is served over http', async () => {
    const appUrl = 'http://nas.local:8181';
    const auth = await authServedAt(appUrl, 'production');
    const email = await createUser(auth);

    const response = await signInFrom(auth, appUrl, email);

    expect(response.status).toBe(200);
    const cookie = sessionCookieOf(response);
    expect(cookie).toMatch(/^better-auth\.session_token=/);
    expect(cookie).not.toMatch(/;\s*Secure(;|$)/i);

    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.split(';')[0] }) });
    expect(session?.user.email).toBe(email);
  });
});
