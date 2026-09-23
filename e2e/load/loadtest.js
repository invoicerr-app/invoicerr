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
//   --node BASIC2-A6C-24G  Scaleway node type (--node-type is the same option)
//   --nodes 2              nodes in the pool (default 1)
//   --autoscale 1:3        let the pool scale itself between these sizes, and record when a node
//                          actually joined (nodes.csv carries the count at every sample)
//   --spread-across-nodes  podAntiAffinity so api replicas prefer separate nodes (needs --nodes > 1
//                          to do anything; a single-node cluster still schedules, just with no effect)
//   --ocr-pool <type>      a second, single-node pool for --set ocr.enabled=true, tainted so only
//                          the OCR pod lands on it
//   --set-env NAME=VALUE   an extra environment variable on api and worker, repeatable
//   --image <ref>          image repository or digest to deploy, overriding values-loadtest.yaml
//   --set a=b              extra Helm --set, repeatable
//   --out results/<name>   where to write the run
//   --scan <file>          scanned PDF to upload for OCR (default scanned-supplier-invoice.pdf)
//   --no-scan              skip the OCR step
//   --keep                 leave the cluster running
//   --reuse-ip <ip>        skip cluster/deploy entirely and load an instance already running
//   --users-file <path>    reuse an earlier run's users.json instead of seeding again
//   --kill-a-node-at <dur> mid-run (e.g. 3m), delete one pool node and time the Ready-count recovery
//                          — timed from the start of the first stage, so use a single --stages value
//   --destroy              destroy the named cluster and print what the project still holds, then
//                          exit — what to run after a --keep
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCluster,
  deleteNode,
  destroyCluster,
  findPool,
  listPoolNodes,
  projectContents,
  waitReady,
  writeKubeconfig,
} from './lib/cluster.js';
import { deploy, hasBinary, makeKube, readyNodeCount, spreadAcrossNodesValues, startSampler } from './lib/k8s.js';
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
    else if (a === '--node' || a === '--node-type') opts.nodeType = next();
    // --set-env NAME=VALUE appends to the chart's app.extraEnv list, which both the api and the
    // worker containers read.
    else if (a === '--set-env') opts.envs.push(next());
    else if (a === '--nodes') opts.nodes = Number(next());
    else if (a === '--autoscale') {
      const [min, max] = next().split(':').map(Number);
      opts.autoscale = { min, max };
    }
    else if (a === '--spread-across-nodes') opts.spreadAcrossNodes = true;
    // --object-storage points the archive and inbound stores at the buckets named in
    // values-s3.yaml. Required for anything multi-node: the documents PVC is ReadWriteOnce.
    else if (a === '--object-storage') opts.objectStorage = true;
    else if (a === '--s3-bucket-prefix') opts.bucketPrefix = next();
    else if (a === '--ocr-pool') opts.ocrPoolNodeType = next();
    else if (a === '--image') opts.image = next();
    else if (a === '--set') opts.sets.push('--set', next());
    else if (a === '--out') opts.out = next();
    else if (a === '--scan') opts.scan = next();
    else if (a === '--no-scan') opts.scan = null;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--reuse-ip') opts.reuseIp = next();
    // --users-file reuses an earlier run's seeded users instead of seeding again. Seeding is the
    // slowest part of a run (one sign-up every 3.5 s, and the instance-wide sign-up limit stretches
    // it further), so a campaign of several runs against the same cluster seeds once.
    else if (a === '--users-file') opts.usersFile = next();
    else if (a === '--kill-a-node-at') opts.killNodeAt = next();
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

async function ensureCluster(name, nodeType, size = 1, ocrPoolNodeType = null) {
  const existing = await findCluster(name);
  if (existing) {
    log(`cluster ${name} already exists (${existing.status}), reusing it`);
    // --ocr-pool only creates the pool at cluster-creation time (below) — a reused cluster keeps
    // whatever pools it already had. Worth a loud warning rather than silently deploying OCR onto
    // an unlabelled/untainted pool, since --ocr-pool's whole point is that OCR gets a machine no
    // other pod shares.
    if (ocrPoolNodeType && !(await findPool(existing.id, 'ocr'))) {
      log(`WARNING: --ocr-pool was given but ${name} has no "ocr" pool (it was reused, not created) — the OCR pod will land wherever its nodeSelector/tolerations allow, which may be nowhere`);
    }
    return { cluster: await waitReady(existing.id), created: false };
  }
  log(`creating cluster ${name} (${nodeType})${ocrPoolNodeType ? ` + ocr pool (${ocrPoolNodeType})` : ''}…`);
  const cluster = await createCluster({ name, nodeType, size, ocrPoolNodeType });
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

// Same shorthand k6's own --duration/DURATION already use (Go duration syntax) — "3m", "90s",
// "1h30m" — so --kill-a-node-at reads like every other duration option in this file.
function parseDuration(s) {
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  const unitMs = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  let ms = 0;
  let matched = false;
  let m;
  while ((m = re.exec(s))) {
    matched = true;
    ms += Number(m[1]) * unitMs[m[2]];
  }
  if (!matched) throw new Error(`bad duration: ${s}`);
  return ms;
}

// --kill-a-node-at (T4 — what redundancy costs): after `delay`, delete one node of the pool api/
// worker/postgres run on, ask Kapsule to replace it, and time how long the cluster takes to show a
// Ready node count again. Fires once, timed from when this function is called — call it once, at the
// start of the stage loop, not once per stage: with several --stages values the delay is only ever
// measured against the first one.
async function killANodeAfter(kube, clusterId, outDir, delay) {
  await sleep(parseDuration(delay));

  const pool = await findPool(clusterId, 'load');
  if (!pool) throw new Error(`no "load" pool on cluster ${clusterId} to kill a node from`);
  const nodes = (await listPoolNodes(clusterId, pool.id)).filter((n) => n.status === 'ready');
  if (nodes.length < 2) {
    log(`--kill-a-node-at: only ${nodes.length} ready node(s) in the pool — killing it would just be an outage with nothing to compare against, skipping`);
    return;
  }

  // The bundled Postgres (postgresql.enabled in values-loadtest.yaml) has no replica: killing its
  // node takes the database down too, which answers "what does an outage cost" rather than "what
  // does redundancy cost" — the question this run is for. Best-effort only: an external Postgres or
  // no matching pod means we genuinely cannot tell, and we say so rather than guess.
  const pgNodeName = (
    await kube
      .kubectl(['get', 'pod', '-l', 'app.kubernetes.io/component=postgres', '-o', 'jsonpath={.items[0].spec.nodeName}'])
      .catch(() => ({ stdout: '' }))
  ).stdout.trim();

  let candidates = nodes;
  if (pgNodeName) {
    const withoutPg = nodes.filter((n) => n.name !== pgNodeName);
    if (withoutPg.length) candidates = withoutPg;
    else log(`--kill-a-node-at: every ready node matches Postgres's own (${pgNodeName}) — cannot avoid it, killing one anyway`);
  } else {
    log('--kill-a-node-at: could not tell which node runs Postgres (no matching pod, or an external database) — picking any node');
  }
  const target = candidates[Math.floor(Math.random() * candidates.length)];

  const readyBefore = await readyNodeCount(kube);
  const killedAt = new Date();
  log(`--kill-a-node-at: deleting ${target.name} (${target.id}), replacement requested…`);
  await deleteNode(target.id, { replace: true });

  let recoveredAt = null;
  for (let i = 0; i < 180; i++) {
    await sleep(10000);
    if ((await readyNodeCount(kube)) >= readyBefore) {
      recoveredAt = new Date();
      break;
    }
  }
  if (!recoveredAt) log('--kill-a-node-at: no Ready node count recovery seen after 30 min — recorded as "timeout"');
  else log(`--kill-a-node-at: recovered in ${Math.round((recoveredAt - killedAt) / 1000)} s`);

  const file = `${outDir}/node-kill.csv`;
  if (!existsSync(file)) {
    appendFileSync(file, 'killed_at,node_name,node_id,ready_nodes_before,recovered_at,recovery_seconds\n');
  }
  appendFileSync(
    file,
    `${killedAt.toISOString()},${target.name},${target.id},${readyBefore},` +
      `${recoveredAt ? recoveredAt.toISOString() : 'timeout'},${recoveredAt ? Math.round((recoveredAt - killedAt) / 1000) : ''}\n`,
  );
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
  // --kill-a-node-at needs a cluster this run itself created/found (clusterId below) to delete a
  // node from — --reuse-ip skips cluster management entirely, so there is nothing for it to act on.
  if (opts.killNodeAt && opts.reuseIp) throw new Error('--kill-a-node-at cannot be combined with --reuse-ip');

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
      const ensured = await ensureCluster(name, nodeType, opts.nodes ?? 1, opts.ocrPoolNodeType);
      clusterId = ensured.cluster.id;
      await writeKubeconfig(clusterId, kubeconfig);
      log('cluster ready, waiting for its node…');
      kube = makeKube(kubeconfig);
      await waitForNode(kube);
      const sets = [...opts.sets];
      const extraValuesFiles = [];
      if (opts.image) sets.push('--set', `image.repository=${opts.image}`, '--set', 'image.tag=');
      // Helm REPLACES a list, it does not append to it: `--set app.extraEnv[0].name=…` overwrites
      // the first entry of the list values-loadtest.yaml already defines — which is the SMTP
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
      // --ocr-pool: matches the label/taint createCluster put on the "ocr" pool (lib/cluster.js's
      // OCR_POOL_LABEL/OCR_POOL_TAINT) — this is what actually lands the OCR pod there and keeps
      // every other pod off it. `operator=Equal` is Kubernetes' own default for a Toleration
      // (k8s.io/api/core/v1 Toleration.Operator), spelled out here anyway so this matches the
      // taint's key+value pair explicitly rather than relying on an unstated default.
      if (opts.ocrPoolNodeType) {
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
      // --spread-across-nodes: a podAntiAffinity `helm --set` cannot express — see
      // spreadAcrossNodesValues's own header. Regenerated every run into this run's own directory,
      // never committed, never reused across runs.

      if (opts.objectStorage) {
        // Required for anything multi-node, not a preference: see values-s3.yaml's own header.
        // The credentials go to a git-ignored file in the run directory, NEVER into the values file
        // that lives in the repository — one was committed on 2026-09-23 and had to be revoked.
        log('archive and inbound stores on Scaleway Object Storage');
        const prefix = opts.bucketPrefix ?? 'invoicerr-lt';
        const stamp = Date.now();
        const credsFile = resolve(outDir, 's3-credentials.yaml');
        writeFileSync(
          credsFile,
          [
            'archive:',
            '  s3:',
            `    bucket: ${prefix}-archive-${stamp}`,
            'documents:',
            '  inbound:',
            '    s3:',
            `      bucket: ${prefix}-inbound-${stamp}`,
            'generateSecret:',
            `  archiveS3AccessKeyId: "${process.env.SCW_ACCESS_KEY}"`,
            `  archiveS3SecretAccessKey: "${process.env.SCW_SECRET_KEY}"`,
            `  inboundS3AccessKeyId: "${process.env.SCW_ACCESS_KEY}"`,
            `  inboundS3SecretAccessKey: "${process.env.SCW_SECRET_KEY}"`,
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
    } else {
      kube = makeKube(process.env.KUBECONFIG ?? `${process.env.HOME}/.kube/config`);
    }
    log(`instance: ${base}`);

    let usersFile = resolve(outDir, 'users.json');
    if (opts.usersFile) {
      usersFile = resolve(opts.usersFile);
      log(`reusing the seeded users in ${usersFile}`);
    } else {
      log(`seeding ${users} users (one sign-up every 3.5 s — see seed.js)…`);
      await seed({ base, count: users, out: usersFile });
    }

    // Fired once, alongside the first stage — see killANodeAfter's own header for why a run using
    // --kill-a-node-at should pass a single --stages value.
    const killTask = opts.killNodeAt
      ? killANodeAfter(kube, clusterId, outDir, opts.killNodeAt).catch((err) =>
          log(`--kill-a-node-at failed: ${err.message}`),
        )
      : null;
    for (const vus of stages) await stage(kube, { vus, duration, base, usersFile, outDir, scan });
    if (killTask) await killTask;

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
