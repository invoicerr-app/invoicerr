// kubectl/helm plumbing: deploy the chart on a fresh cluster, sample what the pods use, read the
// document queue and the Postgres connection count.
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function makeKube(kubeconfig, { ns = 'invoicerr', release = 'lt' } = {}) {
  const env = { ...process.env, KUBECONFIG: kubeconfig };
  const kubectl = (args, opts = {}) => run('kubectl', ['-n', ns, ...args], { env, ...opts });
  const quiet = async (args) => {
    try {
      return (await kubectl(args)).stdout;
    } catch {
      return '';
    }
  };

  return {
    env,
    ns,
    release,
    kubectl,
    helm: (args) => run('helm', args, { env, maxBuffer: 16 * 1024 * 1024 }),

    async exec(deployment, argv) {
      return (await quiet(['exec', `deploy/${release}-invoicerr-${deployment}`, '--', ...argv])).trim();
    },

    // BullMQ's default `bull:` prefix; `document-action` carries every send.
    async queueDepth() {
      const q = 'bull:document-action';
      const r = async (...a) => Number((await this.exec('redis', ['redis-cli', ...a])) || 0);
      const [wait, active, delayed, prioritized, failed] = await Promise.all([
        r('LLEN', `${q}:wait`),
        r('LLEN', `${q}:active`),
        r('ZCARD', `${q}:delayed`),
        r('ZCARD', `${q}:prioritized`),
        r('ZCARD', `${q}:failed`),
      ]);
      return { wait, active, delayed, prioritized, failed };
    },

    async pgConnections() {
      const sql = "select count(*) from pg_stat_activity where datname='invoicerr_db'";
      return Number(await this.exec('postgres', ['psql', '-U', 'invoicerr', '-d', 'invoicerr_db', '-tAc', sql])) || 0;
    },

    async topPods() {
      const out = await quiet(['top', 'pods', '--no-headers']);
      return out
        .split('\n')
        .filter(Boolean)
        .map((l) => l.trim().split(/\s+/))
        .map(([pod, cpu, mem]) => ({ pod, cpu: parseInt(cpu, 10), mem: parseInt(mem, 10) }));
    },

    async topNode() {
      const out = (await run('kubectl', ['top', 'nodes', '--no-headers'], { env })).stdout;
      const lines = out.trim().split('\n').filter(Boolean);
      // Summed over every node, with their count: an autoscaling pool changes size mid-run, and a
      // reading from one node alone would silently halve when a second one joins.
      const totals = lines.reduce(
        (acc, l) => {
          const [, cpu, , mem] = l.trim().split(/\s+/);
          acc.cpu += parseInt(cpu, 10) || 0;
          acc.mem += parseInt(mem, 10) || 0;
          return acc;
        },
        { cpu: 0, mem: 0 },
      );
      return { node: `${lines.length}-nodes`, nodes: lines.length, ...totals };
    },

    async loadBalancerIp(timeoutMs = 600000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const ip = (
          await quiet([
            'get',
            'svc',
            `${release}-invoicerr-api`,
            '-o',
            'jsonpath={.status.loadBalancer.ingress[0].ip}',
          ])
        ).trim();
        if (ip) return ip;
        await new Promise((r) => setTimeout(r, 10000));
      }
      throw new Error('the api Service never got a load balancer address');
    },
  };
}

// metrics-server is not installed on a fresh Kapsule cluster, and `kubectl top` is how this test
// measures anything at all. --kubelet-insecure-tls: Kapsule's kubelet certificates are not signed
// by the cluster CA.
const METRICS_SERVER =
  'https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml';

const MAILPIT = `apiVersion: apps/v1
kind: Deployment
metadata: {name: mailpit, labels: {app: mailpit}}
spec:
  replicas: 1
  selector: {matchLabels: {app: mailpit}}
  template:
    metadata: {labels: {app: mailpit}}
    spec:
      containers:
        - name: mailpit
          image: axllent/mailpit:latest
          ports: [{containerPort: 1025}, {containerPort: 8025}]
---
apiVersion: v1
kind: Service
metadata: {name: mailpit}
spec:
  selector: {app: mailpit}
  ports:
    - {name: smtp, port: 1025, targetPort: 1025}
    - {name: http, port: 8025, targetPort: 8025}
`;

export async function deploy(
  kube,
  { chart, values, extraSets = [], extraValuesFiles = [], secretsFile, workDir, log = () => {} },
) {
  const { kubectl, helm, env, ns, release } = kube;
  log('installing metrics-server and Mailpit…');
  await run('kubectl', ['apply', '-f', METRICS_SERVER], { env });
  await run(
    'kubectl',
    [
      '-n',
      'kube-system',
      'patch',
      'deploy',
      'metrics-server',
      '--type=json',
      '-p',
      '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]',
    ],
    { env },
  );
  await run('kubectl', ['create', 'ns', ns], { env }).catch(() => {});
  // Written to a file rather than piped: execFile has no stdin, and `kubectl apply -f -` would
  // wait on it for ever.
  const mailpitFile = `${workDir}/mailpit.yaml`;
  writeFileSync(mailpitFile, MAILPIT);
  await kubectl(['apply', '-f', mailpitFile]);

  if (!existsSync(secretsFile)) {
    writeFileSync(
      secretsFile,
      `generateSecret:\n  betterAuthSecret: "${randomBytes(32).toString('hex')}"\n` +
        `  credentialsEncryptionKey: "${randomBytes(32).toString('hex')}"\n`,
      { mode: 0o600 },
    );
  }

  // extraValuesFiles: e.g. --spread-across-nodes's podAntiAffinity file — a nested value `--set`
  // cannot express. Order among -f files matters (last wins); extraSets' own --set flags still win
  // over all of them, since Helm applies every --set after every -f regardless of position.
  const base = [
    '-n',
    ns,
    chart,
    '-f',
    values,
    '-f',
    secretsFile,
    ...extraValuesFiles.flatMap((f) => ['-f', f]),
    ...extraSets,
  ];
  // --no-hooks on the first install: the chart's pre-install hook runs `prisma migrate deploy`
  // before the bundled Postgres exists, so a fresh install with postgresql.enabled cannot succeed
  // with hooks on. The upgrade below runs that same hook, once the database answers.
  log('helm install (no hooks — see the comment above)…');
  await helm(['install', release, ...base, '--no-hooks']);
  await kubectl(['rollout', 'status', `deploy/${release}-invoicerr-postgres`, '--timeout=600s']);
  await kubectl(['rollout', 'status', `deploy/${release}-invoicerr-api`, '--timeout=600s']);
  log('waiting for the load balancer…');
  const ip = await kube.loadBalancerIp();
  log(`helm upgrade with APP_URL=http://${ip} (runs the catalogs hook)…`);
  // APP_URL has to be the address the load generator uses: better-auth checks Origin against it.
  await helm([
    'upgrade',
    release,
    ...base,
    '--set',
    `app.appUrl=http://${ip}`,
    '--set',
    `app.corsOrigins=http://${ip}`,
    '--wait',
    '--timeout',
    '10m',
  ]);
  return ip;
}

// Writes one line per pod, per node and per queue reading every `intervalMs`, until stopped.
export function startSampler(kube, dir, stage, intervalMs = 15000) {
  const files = {
    pods: `${dir}/pods.csv`,
    nodes: `${dir}/nodes.csv`,
    queue: `${dir}/queue.csv`,
  };
  if (!existsSync(files.pods)) appendFileSync(files.pods, 'ts,stage,pod,cpu_millicores,mem_mib\n');
  if (!existsSync(files.nodes)) appendFileSync(files.nodes, 'ts,stage,node,cpu_millicores,mem_mib\n');
  if (!existsSync(files.queue))
    appendFileSync(files.queue, 'ts,stage,wait,active,delayed,prioritized,failed,pg_connections\n');

  let stopped = false;
  const tick = async () => {
    const ts = new Date().toISOString();
    const [pods, node, queue, pg] = await Promise.all([
      kube.topPods(),
      kube.topNode().catch(() => null),
      kube.queueDepth(),
      kube.pgConnections(),
    ]);
    for (const p of pods) appendFileSync(files.pods, `${ts},${stage},${p.pod},${p.cpu},${p.mem}\n`);
    if (node) appendFileSync(files.nodes, `${ts},${stage},${node.node},${node.cpu},${node.mem}\n`);
    appendFileSync(
      files.queue,
      `${ts},${stage},${queue.wait},${queue.active},${queue.delayed},${queue.prioritized},${queue.failed},${pg}\n`,
    );
  };

  const loop = (async () => {
    while (!stopped) {
      await tick().catch(() => {});
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      await loop;
    },
  };
}

// How many nodes `kubectl get nodes` currently reports Ready — used by --kill-a-node-at to notice
// when the cluster has recovered from a deleted node. Asked of kubectl rather than the Scaleway API:
// what actually matters for this test is whether the scheduler has somewhere to put pods again, not
// whether Kapsule's own pool object has settled.
export async function readyNodeCount(kube) {
  const out = await run('kubectl', ['get', 'nodes', '--no-headers'], { env: kube.env }).catch(() => ({ stdout: '' }));
  return out.stdout
    .split('\n')
    .filter((l) => l.trim().split(/\s+/)[1] === 'Ready').length;
}

// --spread-across-nodes: a podAntiAffinity on api.affinity, preferring (never requiring — a
// single-node cluster must still schedule) that no two api pods share a node. `helm --set` cannot
// express a nested list of objects, so this is written to its own values file and passed as another
// `-f` (see loadtest.js's call site). Label values match templates/_helpers.tpl's
// invoicerr.componentSelectorLabels for the api component: app.kubernetes.io/name is this chart's
// own Chart.Name ("invoicerr" — nothing in this repo ever sets nameOverride),
// app.kubernetes.io/instance is the release name this tool always installs under.
export function spreadAcrossNodesValues(release, chartName = 'invoicerr') {
  return `# Written by loadtest.js --spread-across-nodes. Regenerated every run — do not edit by
# hand. Exists only because helm --set cannot express a nested podAntiAffinity.
api:
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            topologyKey: kubernetes.io/hostname
            labelSelector:
              matchLabels:
                app.kubernetes.io/name: ${chartName}
                app.kubernetes.io/instance: ${release}
                app.kubernetes.io/component: api
`;
}

export function hasBinary(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
