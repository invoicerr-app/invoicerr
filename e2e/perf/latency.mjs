// Usage: node latency.mjs [runs]. Needs the perfloop stack on :4189. Prints p50/p95 ms per endpoint.
const api = process.env.PERF_API ?? 'http://localhost:4189';
const runs = Number(process.argv[2] ?? 30);
const email = 'perf@example.org';
const password = 'Perf-Passw0rd!';
const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const call = async (method, path, body) => {
  const res = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: process.env.PERF_APP ?? 'http://localhost:6289', Cookie: cookie() },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return res;
};
const json = async (m, p, b) => {
  const r = await call(m, p, b);
  if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${await r.text()}`);
  return r.json();
};
const su = await call('POST', '/api/auth/sign-up/email', { name: 'Perf', firstname: 'Perf', lastname: 'User', email, password, acceptLegal: true });
await json('POST', '/api/auth/sign-in/email', { email, password });
const companies = await (await call('GET', '/api/company/info')).text();
if (!companies.includes('Perf Co')) {
  await json('POST', '/api/companies', {
    name: 'Perf Co', description: 'x', phone: '+33123456789', email: 'c@perf.org', address: '1 Rue', city: 'Paris',
    postalCode: '75001', country: 'France', countryCode: 'FR', currency: 'EUR',
    identifiers: [{ scheme: 'LEGAL_ID', value: '73282932000074' }, { scheme: 'VAT', value: 'FR44732829320' }],
  });
}
let clients = await json('GET', '/api/documents/references/client/search');
if (!clients.length) {
  for (let i = 0; i < 20; i++) {
    await json('POST', '/api/clients', { name: `Client ${i}`, contactEmail: `c${i}@example.com`, currency: 'EUR', country: 'FR', address: '1 Rue', city: 'Paris', postalCode: '75001', isActive: true, type: 'COMPANY' });
  }
  clients = await json('GET', '/api/documents/references/client/search');
}
const draft = (type, i) => json('POST', `/api/documents/types/${type}/actions/save-draft`, {
  data: { client: clients[i % clients.length].id, issueDate: '2026-08-30', dueDate: '2026-09-30', currency: 'EUR',
    lines: Array.from({ length: 5 }, (_, n) => ({ description: `Line ${n}`, quantity: 1 + n, unit: 'unit', unitPrice: 100 + n, vatRate: '20' })) },
});
const listOf = (x) => x.items;
const L = '/api/documents?typeId=invoice&pageSize=100';
let docs = listOf(await json('GET', L));
if (docs.length < 60) {
  for (let i = docs.length; i < 60; i++) await draft('invoice', i);
  docs = listOf(await json('GET', L));
}
const id = docs[0].id;
const endpoints = [
  ['GET', L],
  ['GET', '/api/documents/types/invoice'],
  ['GET', '/api/documents/references/client/search'],
  ['GET', '/api/company/info'],
  ['GET', '/api/documents/dashboard'],
  ['GET', '/api/documents/statistics'],
  ['GET', `/api/documents/${id}/totals?typeId=invoice`],
  ['GET', `/api/documents/${id}/pdf?typeId=invoice`],
];
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
for (const [m, p] of endpoints) {
  const t = [];
  let status = 0;
  for (let i = 0; i < runs + 3; i++) {
    const s = performance.now();
    const r = await call(m, p);
    await r.arrayBuffer();
    status = r.status;
    if (i >= 3) t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  console.log(`${m} ${p.replace(id, ':id')}\t${status}\tp50=${pct(t, 50).toFixed(1)}\tp95=${pct(t, 95).toFixed(1)}`);
}
