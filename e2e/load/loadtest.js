#!/usr/bin/env node
// One command: make sure the throwaway cluster exists, deploy Invoicerr on it, seed N users, run
// the stages, write the report, and destroy the cluster.
//
//   node --env-file=<scaleway key file> loadtest.js [options]
//
// The cluster is found by name, so a second run reuses the one already there instead of creating a
// second. It is destroyed when the run ends, including on failure, unless --keep is given.
//
// Options (all optional):
//   --stages 1,2,10,50     virtual users per stage
//   --duration 5m          length of each stage
//   --users 50             users to seed (defaults to the largest stage)
//   --node BASIC2-A6C-24G  Scaleway node type
//   --image <ref>          image repository or digest to deploy, overriding values-loadtest.yaml
//   --set a=b              extra Helm --set, repeatable
//   --out results/<name>   where to write the run
//   --scan <file>          scanned PDF to upload for OCR (default scanned-supplier-invoice.pdf)
//   --no-scan              skip the OCR step
//   --keep                 leave the cluster running
//   --reuse-ip <ip>        skip cluster/deploy entirely and load an instance already running
//   --destroy              destroy the named cluster and print what the project still holds, then
//                          exit — what to run after a --keep
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCluster, destroyCluster, projectContents, waitReady, writeKubeconfig } from './lib/cluster.js';
import { deploy, hasBinary, makeKube, startSampler } from './lib/k8s.js';
import { seed } from './seed.js';
import { writeReport } from './lib/report.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--stages') opts.stages = next().split(',').map(Number);
    else if (a === '--duration') opts.duration = next();
    else if (a === '--users') opts.users = Number(next());
    else if (a === '--node') opts.nodeType = next();
    else if (a === '--image') opts.image = next();
    else if (a === '--set') opts.sets.push('--set', next());
    else if (a === '--out') opts.out = next();
    else if (a === '--scan') opts.scan = next();
    else if (a === '--no-scan') opts.scan = null;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--reuse-ip') opts.reuseIp = next();
    else if (a === '--name') opts.name = next();
    else if (a === '--destroy') opts.destroy = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// The cluster this run works with, if it is already there. Named lookup is what makes a second
// run reuse the first one's cluster instead of paying for a second.
async function findCluster(name) {
  const { SCW_DEFAULT_REGION = 'fr-par', SCW_SECRET_KEY, SCW_DEFAULT_PROJECT_ID } = process.env;
  const res = await fetch(
    `https://api.scaleway.com/k8s/v1/regions/${SCW_DEFAULT_REGION}/clusters?project_id=${SCW_DEFAULT_PROJECT_ID}&name=${name}`,
    { headers: { 'x-auth-token': SCW_SECRET_KEY } },
  );
  const { clusters = [] } = await res.json();
  return clusters.find((c) => c.name === name && c.status !== 'deleting') ?? null;
}

async function ensureCluster(name, nodeType) {
  const existing = await findCluster(name);
  if (existing) {
    log(`cluster ${name} already exists (${existing.status}), reusing it`);
    return { cluster: await waitReady(existing.id), created: false };
  }
  log(`creating cluster ${name} (${nodeType})…`);
  const cluster = await createCluster({ name, nodeType });
  return { cluster: await waitReady(cluster.id), created: true };
}

async function waitForNode(kube) {
  for (let i = 0; i < 60; i++) {
    const out = await run('kubectl', ['get', 'nodes', '--no-headers'], { env: kube.env }).catch(() => ({ stdout: '' }));
    if (/\sReady\s/.test(out.stdout)) return;
    await sleep(10000);
  }
  throw new Error('no node became Ready');
}

function k6(args, env) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn('k6', args, { stdio: ['ignore', 'pipe', 'inherit'], env });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.on('error', reject);
    p.on('close', () => resolvePromise(out));
  });
}

async function stage(kube, { vus, duration, base, usersFile, outDir, scan }) {
  const label = `${vus}vu`;
  log(`== stage ${label}`);
  const sampler = startSampler(kube, outDir, label);
  const env = { ...process.env };
  const args = [
    'run',
    '-q',
    '-e',
    `BASE=${base}`,
    '-e',
    `USERS=${usersFile}`,
    '-e',
    `VUS=${vus}`,
    '-e',
    `DURATION=${duration}`,
    ...(scan ? ['-e', `SCAN=${scan}`] : []),
    '--summary-export',
    `${outDir}/k6-${label}.json`,
    resolve(here, 'scenario.js'),
  ];
  const summary = await k6(args, env);
  writeFileSync(`${outDir}/k6-${label}.txt`, summary);

  // The queue as k6 stops, then how long the workers need to catch up.
  const end = await kube.queueDepth();
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    const q = await kube.queueDepth();
    if (q.wait === 0 && q.active === 0) break;
    await sleep(5000);
  }
  const drain = Math.round((Date.now() - t0) / 1000);
  const file = `${outDir}/stage-end.csv`;
  if (!existsSync(file)) appendFileSync(file, 'stage,ts,wait,active,delayed,prioritized,failed,drain_seconds\n');
  appendFileSync(
    file,
    `${label},${new Date().toISOString()},${end.wait},${end.active},${end.delayed},${end.prioritized},${end.failed},${drain}\n`,
  );
  await sampler.stop();
  log(`   queue when k6 stopped: wait ${end.wait}, active ${end.active}; drained in ${drain} s`);
}

async function reportProject(outDir) {
  const left = await projectContents();
  log('project now holds:', JSON.stringify(left));
  if (outDir) writeFileSync(`${outDir}/project-after.json`, `${JSON.stringify(left, null, 2)}\n`);
  const dirty = Object.entries(left).filter(([, n]) => n > 0);
  if (dirty.length) log(`WARNING: still billed: ${dirty.map(([k, n]) => `${k}=${n}`).join(', ')}`);
  return left;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.destroy) {
    const name = opts.name ?? 'invoicerr-loadtest';
    const existing = await findCluster(name);
    if (!existing) {
      log(`no cluster named ${name}`);
      await reportProject(null);
      return;
    }
    log(`destroying ${name}…`);
    await destroyCluster(existing.id, { privateNetworkName: `${name}-net` });
    await reportProject(null);
    return;
  }
  const stages = opts.stages ?? [1, 2, 10, 50];
  const duration = opts.duration ?? '5m';
  const name = opts.name ?? 'invoicerr-loadtest';
  const nodeType = opts.nodeType ?? 'BASIC2-A6C-24G';
  const users = opts.users ?? Math.max(...stages);
  const scan = opts.scan === null ? null : resolve(here, opts.scan ?? 'scanned-supplier-invoice.pdf');
  const outDir = resolve(here, opts.out ?? `results/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);

  for (const bin of ['kubectl', 'helm', 'k6']) {
    if (!hasBinary(bin)) throw new Error(`${bin} is not on PATH`);
  }
  mkdirSync(outDir, { recursive: true });

  let clusterId = null;
  let base = opts.reuseIp && `http://${opts.reuseIp}`;
  const kubeconfig = resolve(outDir, 'kubeconfig');
  let kube;

  try {
    if (!base) {
      const ensured = await ensureCluster(name, nodeType);
      clusterId = ensured.cluster.id;
      await writeKubeconfig(clusterId, kubeconfig);
      log('cluster ready, waiting for its node…');
      kube = makeKube(kubeconfig);
      await waitForNode(kube);
      const sets = [...opts.sets];
      if (opts.image) sets.push('--set', `image.repository=${opts.image}`, '--set', 'image.tag=');
      // A cluster reused from an earlier run already carries the release; deploy() is only for a
      // fresh one.
      const installed = await kube
        .helm(['-n', kube.ns, 'status', kube.release])
        .then(() => true)
        .catch(() => false);
      if (installed) {
        // The cluster was reused, but --image / --set still have to reach the release, or a second
        // run would silently measure the first one's deployment.
        base = `http://${await kube.loadBalancerIp()}`;
        log(`release already installed, upgrading it in place (${base})…`);
        await kube.helm([
          'upgrade',
          kube.release,
          '-n',
          kube.ns,
          resolve(here, '../../deploy/helm/invoicerr'),
          // --reuse-values keeps the release's own values, secrets included: this run's directory
          // has no secrets.yaml of its own, the first install's release holds them.
          ...sets,
          '--reuse-values',
          '--wait',
          '--timeout',
          '10m',
        ]);
      } else {
        const ip = await deploy(kube, {
          chart: resolve(here, '../../deploy/helm/invoicerr'),
          values: resolve(here, 'values-loadtest.yaml'),
          secretsFile: resolve(outDir, 'secrets.yaml'),
          workDir: outDir,
          extraSets: sets,
          log,
        });
        base = `http://${ip}`;
      }
    } else {
      kube = makeKube(process.env.KUBECONFIG ?? `${process.env.HOME}/.kube/config`);
    }
    log(`instance: ${base}`);

    const usersFile = resolve(outDir, 'users.json');
    log(`seeding ${users} users (one sign-up every 3.5 s — see seed.js)…`);
    await seed({ base, count: users, out: usersFile });

    for (const vus of stages) await stage(kube, { vus, duration, base, usersFile, outDir, scan });

    writeReport(outDir, { title: `Load test — ${outDir.split('/').pop()}` });
    log(`report: ${outDir}/REPORT.md`);
  } finally {
    if (clusterId && !opts.keep) {
      log('destroying the cluster and everything it created…');
      await destroyCluster(clusterId, { privateNetworkName: `${name}-net` });
      await reportProject(outDir);
    } else if (clusterId) {
      log(`cluster left running (--keep). Destroy it with: npm run loadtest -- --destroy --name ${name}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
