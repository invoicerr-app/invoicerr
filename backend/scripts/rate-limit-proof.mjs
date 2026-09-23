// The proof for BRIEF_RATELIMIT_OCR_LIMITS.md §1: are better-auth's limits per client or global?
//
//   node ratelimit-test.mjs http://localhost:8099
//
// Three measurements, each after an 11 s pause so the 10 s window has rolled over:
//   1. 150 concurrent get-session from 150 DIFFERENT client addresses — all 150 must be served
//      once the fix is in; before it, 100 are served and 50 refused.
//   2. the same 150 from ONE address — the limit must still bite, or the fix would have removed it.
//   3. 8 sign-ins from 8 different addresses — before the fix, only 3 are served.
const base = process.argv[2] || 'http://localhost:8099';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36);
const email = `rl-${run}@load.test`;
const password = `Rate-limit-${run}!`;

const signup = await fetch(`${base}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ name: 'Rate Limit', firstname: 'Rate', lastname: 'Limit', email, password }),
});
if (!signup.ok) throw new Error(`sign-up -> ${signup.status} ${await signup.text()}`);
const cookie = signup.headers.getSetCookie().find((c) => c.includes('session_token=')).split(';')[0];

async function burst(label, n, addr) {
  const codes = {};
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      fetch(`${base}/api/auth/get-session`, {
        headers: { cookie, origin: base, 'x-forwarded-for': addr(i) },
      }).then((r) => {
        codes[r.status] = (codes[r.status] || 0) + 1;
      }),
    ),
  );
  console.log(`${label}: ${JSON.stringify(codes)}`);
  return codes;
}

await sleep(11000);
await burst('150 get-session, 150 client addresses', 150, (i) => `203.0.113.${i % 250}`);
await sleep(11000);
await burst('150 get-session, 1 client address    ', 150, () => '198.18.0.9');
await sleep(11000);
const codes = {};
for (let i = 0; i < 8; i++) {
  const r = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-forwarded-for': `198.51.100.${i}` },
    body: JSON.stringify({ email, password }),
  });
  codes[r.status] = (codes[r.status] || 0) + 1;
}
console.log(`8 sign-ins, 8 client addresses       : ${JSON.stringify(codes)}`);
