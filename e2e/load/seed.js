// Seeds N load-test users against a running instance, each in its own German company with a few
// clients and articles, and writes users.json for k6 to read.
//
//   npm run loadtest:seed -- http://<host> <count> [users.json]
//
// Germany because its channel policy imposes no transmission channel: with the company's transport
// set to plain e-mail, "send" runs the whole render path and ends in the instance's SMTP server.
//
// Paced at one sign-up every 3.5 s: better-auth's own limiter allows 3 sign-ins/sign-ups per 10 s,
// and behind the in-pod nginx every request carries a two-entry X-Forwarded-For, which that limiter
// does not split per client — measured 2026-09-22: eight sign-ins from eight distinct client
// addresses, the fourth onwards answered 429. The cap is instance-wide, not per user.
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function seed({ base, count, out, pauseMs = 3500, onProgress = () => {} }) {
  const runId = Date.now().toString(36);

  async function call(method, path, body, cookie) {
    const headers = { 'content-type': 'application/json', origin: base };
    if (cookie) headers.cookie = cookie;
    let res;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
      if (res.status !== 429 || attempt === 10) break;
      await sleep(11000); // outlive the limiter's 10 s window
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return { res, json: text ? JSON.parse(text) : null };
  }

  // The production cookie is `__Secure-…` with the Secure flag, which neither fetch nor k6 replays
  // over plain http, so the name=value pair is lifted from Set-Cookie and sent by hand.
  function sessionCookie(res) {
    const c = res.headers.getSetCookie().find((h) => h.includes('session_token='));
    if (!c) throw new Error('no session cookie in sign-up response');
    return c.split(';')[0];
  }

  const users = [];
  for (let i = 0; i < count; i++) {
    const email = `lt-${runId}-${i}@load.test`;
    const password = `Load-test-${runId}-${i}!`;
    const signup = await call('POST', '/api/auth/sign-up/email', {
      name: `Load ${i}`,
      firstname: 'Load',
      lastname: `User${i}`,
      email,
      password,
      acceptLegal: true,
    });
    const cookie = sessionCookie(signup.res);
    await call(
      'POST',
      '/api/companies',
      {
        name: `Load ${i} GmbH`,
        country: 'Germany',
        countryCode: 'DE',
        currency: 'EUR',
        address: 'Unter den Linden 1',
        postalCode: '10117',
        city: 'Berlin',
        phone: '+4930123456',
        email: `billing-${i}@load.test`,
        // Without a transport, "send" answers 501 "No transport is configured".
        invoiceTransportId: 'email',
        identifiers: [{ scheme: 'VAT', value: 'DE136695976' }],
      },
      cookie,
    );
    const clientIds = [];
    for (let c = 0; c < 3; c++) {
      const { json } = await call(
        'POST',
        '/api/clients',
        {
          name: `Kunde ${c} GmbH`,
          type: 'COMPANY',
          contactEmail: `buyer-${i}-${c}@load.test`,
          address: 'Mönckebergstraße 1',
          postalCode: '20095',
          city: 'Hamburg',
          country: 'Germany',
          countryCode: 'DE',
          currency: 'EUR',
          isActive: true,
        },
        cookie,
      );
      clientIds.push(json.id);
    }
    const articleIds = [];
    for (const [name, type, unitPrice] of [
      ['Consulting', 'SERVICE', 200],
      ['Development', 'HOUR', 90],
      ['Licence', 'PRODUCT', 49],
    ]) {
      const { json } = await call('POST', '/api/articles', { name, type, unitPrice, vatRate: 19 }, cookie);
      articleIds.push(json.id);
    }
    // The sign-up session is kept: see scenario.js for why k6 does not sign in by default.
    users.push({ email, password, cookie, clientIds, articleIds });
    onProgress(i + 1, count, email);
    if (i < count - 1) await sleep(pauseMs);
  }
  writeFileSync(out, JSON.stringify(users, null, 2));
  return users;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, count, out = 'users.json'] = process.argv.slice(2);
  if (!base || !count) {
    console.error('usage: node seed.js http://<host> <count> [users.json]');
    process.exit(1);
  }
  await seed({
    base,
    count: Number(count),
    out,
    onProgress: (n, total, email) => console.log(`seeded ${n}/${total} ${email}`),
  });
  console.log(`wrote ${out}`);
}
