#!/usr/bin/env node
// One command: deploy Invoicerr on the Kubernetes cluster KUBECONFIG points at, seed N users, run
// the stages and write the report.
//
//   KUBECONFIG=<throwaway cluster> node loadtest.js [options]
//
// The cluster is yours to create and destroy, with whichever provider you use: this script only
// talks to it through kubectl and helm. Use a cluster of its own, never one that holds anything real.
// A second run against the same cluster upgrades the release already there instead of installing a
// second one.
//
// Options (all optional):
//   --stages 1,2,10,50     virtual users per stage
//   --duration 5m          length of each stage
//   --users 50             users to seed (defaults to the largest stage)
//   --spread-across-nodes  podAntiAffinity so api replicas prefer separate nodes (does nothing on a
//                          single-node cluster)
//   --ocr-pool             land the OCR pod on nodes labelled workload=ocr and tainted
//                          dedicated=ocr:NoSchedule (create that pool yourself)
//   --object-storage       archive and inbound stores on S3 instead of the node's disk (required for
//                          anything multi-node): reads S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID and
//                          S3_SECRET_ACCESS_KEY from the environment; the buckets must exist
//   --s3-bucket-prefix <p> bucket names <p>-archive and <p>-inbound (default invoicerr-lt)
//   --set-env NAME=VALUE   an extra environment variable on api and worker, repeatable
//   --image <ref>          image repository or digest to deploy, overriding values-loadtest.yaml
//   --set a=b              extra Helm --set, repeatable
//   --out results/<name>   where to write the run
//   --scan <file>          scanned PDF to upload for OCR (default scanned-supplier-invoice.pdf)
//   --no-scan              skip the OCR step
//   --reuse-ip <ip>        skip the deploy entirely and load an instance already running
//   --users-file <path>    reuse an earlier run's users.json instead of seeding again
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy, hasBinary, makeKube, spreadAcrossNodesValues, startSampler } from './lib/k8s.js';
import { seed } from './seed.js';
import { writeReport } from './lib/report.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { sets: [], envs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--stages') opts.stages = next().split(',').map(Number);
    else if (a === '--duration') opts.duration = next();
    else if (a === '--users') opts.users = Number(next());
    // --set-env NAME=VALUE appends to the chart's app.extraEnv list, which both the api and the
    // worker containers read.
    else if (a === '--set-env') opts.envs.push(next());
    else if (a === '--spread-across-nodes') opts.spreadAcrossNodes = true;
    // --object-storage points the archive and inbound stores at S3 buckets. Required for anything
    // multi-node: the documents PVC is ReadWriteOnce.
    else if (a === '--object-storage') opts.objectStorage = true;
    else if (a === '--s3-bucket-prefix') opts.bucketPrefix = next();
    else if (a === '--ocr-pool') opts.ocrPool = true;
    else if (a === '--image') opts.image = next();
    else if (a === '--set') opts.sets.push('--set', next());
    else if (a === '--out') opts.out = next();
    else if (a === '--scan') opts.scan = next();
    else if (a === '--no-scan') opts.scan = null;
    else if (a === '--reuse-ip') opts.reuseIp = next();
    // --users-file reuses an earlier run's seeded users instead of seeding again. Seeding is the
    // slowest part of a run (one sign-up every 3.5 s, and the instance-wide sign-up limit stretches
    // it further), so a campaign of several runs against the same cluster seeds once.
    else if (a === '--users-file') opts.usersFile = next();
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stages = opts.stages ?? [1, 2, 10, 50];
  const duration = opts.duration ?? '5m';
  const users = opts.users ?? Math.max(...stages);
  const scan = opts.scan === null ? null : resolve(here, opts.scan ?? 'scanned-supplier-invoice.pdf');
  const outDir = resolve(here, opts.out ?? `results/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);

  for (const bin of ['kubectl', 'helm', 'k6']) {
    if (!hasBinary(bin)) throw new Error(`${bin} is not on PATH`);
  }
  mkdirSync(outDir, { recursive: true });

  let base = opts.reuseIp && `http://${opts.reuseIp}`;
  const kube = makeKube(process.env.KUBECONFIG ?? `${process.env.HOME}/.kube/config`);

  if (!base) {
    log('waiting for a Ready node…');
    await waitForNode(kube);
    const sets = [...opts.sets];
    const extraValuesFiles = [];
    if (opts.image) sets.push('--set', `image.repository=${opts.image}`, '--set', 'image.tag=');
    // Helm REPLACES a list, it does not append to it: `--set app.extraEnv[0].name=…` overwrites
    // the first entry of the list values-loadtest.yaml already defines - which is the SMTP
    // configuration. Measured the hard way on 2026-09-22: every invoice then failed to send with
    // "No mail server is configured", and the run measured a broken instance instead of the
    // setting under test. So the whole list is rebuilt here, the file's own entries first.
    if (opts.envs.length) {
      const valuesText = readFileSync(resolve(here, 'values-loadtest.yaml'), 'utf8');
      const existing = [...valuesText.matchAll(/^\s*- \{name: ([^,]+), value: ([^}]*)\}/gm)].map((m) => ({
        name: m[1].trim(),
        value: m[2].trim().replace(/^"|"$/g, ''),
      }));
      const merged = [...existing];
      for (const pair of opts.envs) {
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const at = merged.findIndex((e) => e.name === name);
        if (at >= 0) merged[at] = { name, value };
        else merged.push({ name, value });
      }
      const envFile = resolve(outDir, 'extra-env.yaml');
      writeFileSync(
        envFile,
        `app:\n  extraEnv:\n${merged.map((e) => `    - {name: ${e.name}, value: "${e.value}"}`).join('\n')}\n`,
      );
      extraValuesFiles.push(envFile);
    }
    // --ocr-pool: matches the label (workload=ocr) and taint (dedicated=ocr:NoSchedule) the
    // operator put on the OCR pool - this is what actually lands the OCR pod there and keeps
    // every other pod off it. `operator=Equal` is Kubernetes' own default for a Toleration
    // (k8s.io/api/core/v1 Toleration.Operator), spelled out here anyway so this matches the
    // taint's key+value pair explicitly rather than relying on an unstated default.
    if (opts.ocrPool) {
      sets.push(
        '--set',
        'ocr.nodeSelector.workload=ocr',
        '--set',
        'ocr.tolerations[0].key=dedicated',
        '--set',
        'ocr.tolerations[0].operator=Equal',
        '--set',
        'ocr.tolerations[0].value=ocr',
        '--set',
        'ocr.tolerations[0].effect=NoSchedule',
      );
    }
    // --spread-across-nodes: a podAntiAffinity `helm --set` cannot express - see
    // spreadAcrossNodesValues's own header. Regenerated every run into this run's own directory,
    // never committed, never reused across runs.

    if (opts.objectStorage) {
      // Required for anything multi-node, not a preference: the documents PVC is ReadWriteOnce.
      // The credentials go to a git-ignored file in the run directory, NEVER into a values file
      // that lives in the repository - one was committed on 2026-09-23 and had to be revoked.
      const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
      if (!S3_ENDPOINT || !S3_REGION || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
        throw new Error('--object-storage needs S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
      }
      log(`archive and inbound stores on S3 (${S3_ENDPOINT})`);
      const prefix = opts.bucketPrefix ?? 'invoicerr-lt';
      const credsFile = resolve(outDir, 's3-credentials.yaml');
      writeFileSync(
        credsFile,
        [
          'archive:',
          '  s3:',
          `    bucket: ${prefix}-archive`,
          `    endpoint: "${S3_ENDPOINT}"`,
          `    region: "${S3_REGION}"`,
          'documents:',
          '  inbound:',
          '    s3:',
          `      bucket: ${prefix}-inbound`,
          `      endpoint: "${S3_ENDPOINT}"`,
          `      region: "${S3_REGION}"`,
          'generateSecret:',
          `  archiveS3AccessKeyId: "${S3_ACCESS_KEY_ID}"`,
          `  archiveS3SecretAccessKey: "${S3_SECRET_ACCESS_KEY}"`,
          `  inboundS3AccessKeyId: "${S3_ACCESS_KEY_ID}"`,
          `  inboundS3SecretAccessKey: "${S3_SECRET_ACCESS_KEY}"`,
          '',
        ].join('\n'),
        { mode: 0o600 },
      );
      extraValuesFiles.push(resolve(here, 'values-s3.yaml'), credsFile);
    }
    if (opts.spreadAcrossNodes) {
      const affinityFile = resolve(outDir, 'anti-affinity-values.yaml');
      writeFileSync(affinityFile, spreadAcrossNodesValues(kube.release));
      extraValuesFiles.push(affinityFile);
    }
    // A cluster used by an earlier run already carries the release; deploy() is only for a
    // fresh one.
    const installed = await kube
      .helm(['-n', kube.ns, 'status', kube.release])
      .then(() => true)
      .catch(() => false);
    if (installed) {
      // The release is already there, but --image / --set still have to reach the release, or a second
      // run would silently measure the first one's deployment.
      base = `http://${await kube.loadBalancerIp()}`;
      log(`release already installed, upgrading it in place (${base})…`);
      await kube.helm([
        'upgrade',
        kube.release,
        '-n',
        kube.ns,
        resolve(here, '../../deploy/helm/invoicerr'),
        ...extraValuesFiles.flatMap((f) => ['-f', f]),
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
        extraValuesFiles,
        log,
      });
      base = `http://${ip}`;
    }
  }
  log(`instance: ${base}`);

  let usersFile = resolve(outDir, 'users.json');
  if (opts.usersFile) {
    usersFile = resolve(opts.usersFile);
    log(`reusing the seeded users in ${usersFile}`);
  } else {
    log(`seeding ${users} users (one sign-up every 3.5 s - see seed.js)…`);
    await seed({ base, count: users, out: usersFile });
  }

  for (const vus of stages) await stage(kube, { vus, duration, base, usersFile, outDir, scan });

  writeReport(outDir, { title: `Load test - ${outDir.split('/').pop()}` });
  log(`report: ${outDir}/REPORT.md`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
