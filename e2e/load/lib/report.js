// Turns one run directory (k6 summaries + the sampler's CSVs) into REPORT.md, and compares two of
// them — the before/after a change is meant to improve.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const ROLES = ['api', 'worker', 'postgres', 'redis', 'ocr', 'mailpit'];
const roleOf = (pod) => ROLES.find((r) => pod.includes(`-${r}-`) || pod.startsWith(r)) || 'other';

function readCsv(path) {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
}

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const ms = (v) => (v === undefined ? '—' : v >= 10000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export function collect(dir) {
  const pods = readCsv(`${dir}/pods.csv`);
  const nodes = readCsv(`${dir}/nodes.csv`);
  const queue = readCsv(`${dir}/queue.csv`);
  const ends = readCsv(`${dir}/stage-end.csv`);
  const stages = [];

  for (const end of ends) {
    const stage = end.stage;
    const k6 = JSON.parse(readFileSync(`${dir}/k6-${stage}.json`, 'utf8')).metrics;
    const step = (name, stat = 'p(95)') => k6[`http_req_duration{name:${name}}`]?.[stat];

    // CPU and memory are summed per role at each sample, then averaged and peaked over the stage.
    const perSample = {};
    for (const row of pods.filter((p) => p.stage === stage)) {
      const s = (perSample[row.ts] ||= {});
      const role = roleOf(row.pod);
      s[role] ||= { cpu: 0, mem: 0 };
      s[role].cpu += num(row.cpu_millicores);
      s[role].mem += num(row.mem_mib);
    }
    const samples = Object.values(perSample);
    const stat = (role, field) => {
      const vals = samples.map((s) => s[role]?.[field] ?? 0);
      return vals.length
        ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, peak: Math.max(...vals) }
        : { avg: 0, peak: 0 };
    };
    const nodeRows = nodes.filter((n) => n.stage === stage);
    const queueRows = queue.filter((q) => q.stage === stage);

    stages.push({
      stage,
      vus: Number(stage.replace(/\D+/g, '')),
      iterations: k6.iterations?.count ?? 0,
      rps: k6.http_reqs?.rate ?? 0,
      failedRatio: k6.http_req_failed?.value ?? 0,
      checks: { passes: k6.checks?.passes ?? 0, fails: k6.checks?.fails ?? 0 },
      throttled: k6['throttled_429']?.count ?? 0,
      sendFailed: k6['send_failed']?.count ?? 0,
      sendTimedOut: k6['send_timed_out']?.count ?? 0,
      sendToSent: k6['send_to_sent'],
      p95: k6.http_req_duration?.['p(95)'],
      steps: Object.keys(k6)
        .filter((n) => n.startsWith('http_req_duration{name:'))
        .map((n) => n.slice('http_req_duration{name:'.length, -1))
        .sort()
        .map((name) => ({
          name,
          count: step(name, 'count') ?? 0,
          p50: step(name, 'med'),
          p95: step(name),
          p99: step(name, 'p(99)'),
        }))
        .filter((s) => s.count > 0),
      cpu: Object.fromEntries(ROLES.map((r) => [r, stat(r, 'cpu')])),
      mem: Object.fromEntries(ROLES.map((r) => [r, stat(r, 'mem')])),
      node: {
        cpuPeak: Math.max(0, ...nodeRows.map((n) => num(n.cpu_millicores))),
        memPeak: Math.max(0, ...nodeRows.map((n) => num(n.mem_mib))),
      },
      pgPeak: Math.max(0, ...queueRows.map((q) => num(q.pg_connections))),
      queueEnd: { wait: num(end.wait), active: num(end.active), drainSeconds: num(end.drain_seconds) },
    });
  }
  stages.sort((a, b) => a.vus - b.vus);
  return { dir, stages };
}

export function toMarkdown(run, { title = 'Load test' } = {}) {
  const L = [`# ${title}`, ''];
  L.push('One virtual user = one person invoicing without a pause. Sent/min counts invoices that');
  L.push('reached `sent`, e-mail included.', '');
  L.push(
    '| VUs | loops | sent/min | p95 lists | p95 PDF | p95 send | send→sent p95 | node CPU peak | node RAM peak | api CPU avg/peak | workers CPU avg/peak | pg conns | queue at end | errors |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of run.stages) {
    const lists = Math.max(
      ...['list_quotes', 'list_invoices', 'list_clients'].map((n) => s.steps.find((x) => x.name === n)?.p95 ?? 0),
    );
    const pick = (n, f = 'p95') => s.steps.find((x) => x.name === n)?.[f];
    const durationMin = 5; // stages are 5 minutes by default; see run.duration in the raw summary
    const errors = s.checks.fails
      ? `${s.checks.fails}/${s.checks.fails + s.checks.passes} checks`
      : s.throttled
        ? `${s.throttled}× 429`
        : 'none';
    L.push(
      `| ${s.vus} | ${s.iterations} | ${(s.sendToSent?.count / durationMin || 0).toFixed(0)} | ${ms(lists)} | ` +
        `${ms(pick('invoice_pdf'))} | ${ms(pick('invoice_send'))} | ${ms(s.sendToSent?.['p(95)'])} | ` +
        `${(s.node.cpuPeak / 1000).toFixed(1)} vCPU | ${(s.node.memPeak / 1024).toFixed(1)} GiB | ` +
        `${s.cpu.api.avg.toFixed(0)}/${s.cpu.api.peak.toFixed(0)} m | ` +
        `${s.cpu.worker.avg.toFixed(0)}/${s.cpu.worker.peak.toFixed(0)} m | ${s.pgPeak} | ` +
        `wait ${s.queueEnd.wait}, drained in ${s.queueEnd.drainSeconds} s | ${errors} |`,
    );
  }

  L.push('', '## Per step', '');
  for (const s of run.stages) {
    L.push(
      `**${s.vus} VUs** — ${s.iterations} loops, ${s.sendFailed} failed sends, ${s.sendTimedOut} timed out; ` +
        'memory avg/peak MiB: ' +
        ROLES.filter((r) => s.mem[r].peak)
          .map((r) => `${r} ${s.mem[r].avg.toFixed(0)}/${s.mem[r].peak.toFixed(0)}`)
          .join(', '),
      '',
      '| step | p50 | p95 | p99 | count |',
      '|---|---|---|---|---|',
    );
    for (const st of s.steps) L.push(`| ${st.name} | ${ms(st.p50)} | ${ms(st.p95)} | ${ms(st.p99)} | ${st.count} |`);
    L.push('');
  }
  return L.join('\n');
}

export function compare(beforeDir, afterDir) {
  const a = collect(beforeDir);
  const b = collect(afterDir);
  const L = ['# Load test comparison', '', `Before: \`${beforeDir}\` · After: \`${afterDir}\``, ''];
  const names = [...new Set(a.stages.flatMap((s) => s.steps.map((x) => x.name)))].sort();
  for (const stage of b.stages) {
    const other = a.stages.find((s) => s.vus === stage.vus);
    if (!other) continue;
    L.push(`## ${stage.vus} VUs`, '', '| step | before p95 | after p95 | change |', '|---|---|---|---|');
    for (const name of names) {
      const x = other.steps.find((s) => s.name === name)?.p95;
      const y = stage.steps.find((s) => s.name === name)?.p95;
      if (x === undefined || y === undefined) continue;
      const pct = x ? ((y - x) / x) * 100 : 0;
      L.push(`| ${name} | ${ms(x)} | ${ms(y)} | ${pct > 0 ? '+' : ''}${pct.toFixed(0)} % |`);
    }
    const nodeDelta = ((stage.node.cpuPeak - other.node.cpuPeak) / (other.node.cpuPeak || 1)) * 100;
    L.push(
      '',
      `Node CPU peak ${(other.node.cpuPeak / 1000).toFixed(1)} → ${(stage.node.cpuPeak / 1000).toFixed(1)} vCPU ` +
        `(${nodeDelta > 0 ? '+' : ''}${nodeDelta.toFixed(0)} %), RAM peak ` +
        `${(other.node.memPeak / 1024).toFixed(1)} → ${(stage.node.memPeak / 1024).toFixed(1)} GiB.`,
      '',
    );
  }
  return L.join('\n');
}

export function writeReport(dir, opts) {
  const md = toMarkdown(collect(dir), opts);
  writeFileSync(`${dir}/REPORT.md`, `${md}\n`);
  return md;
}

export function runDirs(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${root}/${d.name}`);
}
