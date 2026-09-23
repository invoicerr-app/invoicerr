// Builds the campaign table: one line per run directory, the same five figures each time.
//
//   node lib/campaign-table.js results/t0-reference:"T0 reference":57.60 …
//
// Each argument is <dir>:<label>:<monthly euros excl. VAT>, and the stage is taken from the run's
// own k6 summaries (50 users unless the directory only holds another stage).
import { readFileSync, existsSync } from 'node:fs';

const rows = process.argv.slice(2).map((arg) => {
  const [dir, label, price] = arg.split(':');
  const stage = existsSync(`${dir}/k6-50vu.json`) ? '50vu' : '10vu';
  const k6 = JSON.parse(readFileSync(`${dir}/k6-${stage}.json`, 'utf8')).metrics;
  const nodes = readFileSync(`${dir}/nodes.csv`, 'utf8').trim().split('\n').slice(1);
  let cpu = 0;
  let mem = 0;
  let maxNodes = 1;
  for (const line of nodes) {
    const [, , name, c, m] = line.split(',');
    cpu = Math.max(cpu, Number(c) || 0);
    mem = Math.max(mem, Number(m) || 0);
    const n = Number((name.match(/^(\d+)-nodes$/) || [])[1]);
    if (n) maxNodes = Math.max(maxNodes, n);
  }
  return {
    label,
    price: Number(price),
    stage,
    sent: k6.send_to_sent?.count ?? 0,
    pdf: k6['http_req_duration{name:invoice_pdf}']?.['p(95)'] ?? 0,
    scan: k6.ocr_to_extracted?.['p(95)'] ?? 0,
    cpu: cpu / 1000,
    mem: mem / 1024,
    throttled: k6.throttled_429?.count ?? 0,
    sendFailed: k6.send_failed?.count ?? 0,
    lost: k6.ocr_not_extracted?.count ?? 0,
    nodes: maxNodes,
  };
});

const ms = (v) => (v >= 10000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
console.log(
  '| Run | €/month | Invoices / 5 min | p95 PDF | p95 scan wait | peak CPU | peak RAM | 429 | lost work |',
);
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.label} | ${r.price.toFixed(2)} | **${r.sent}** | ${ms(r.pdf)} | ${ms(r.scan)} | ` +
      `${r.cpu.toFixed(1)} vCPU | ${r.mem.toFixed(1)} GiB | ${r.throttled} | ${r.sendFailed + r.lost} |`,
  );
}
