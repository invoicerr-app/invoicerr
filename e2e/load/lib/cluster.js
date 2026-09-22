// Scaleway Kapsule, over the public API — create a throwaway cluster, take its kubeconfig, destroy
// it, and check the project is empty afterwards. A forgotten node is the only real cost of this
// test, so `destroy` also asks the project what is left and `assertEmpty` prints it.
//
// Credentials come from the environment (SCW_SECRET_KEY, SCW_DEFAULT_PROJECT_ID,
// SCW_DEFAULT_ORGANIZATION_ID), never from a file this repository knows about: run node with
// `--env-file=<path>` pointing at wherever you keep them.
import { writeFileSync } from 'node:fs';

const REGION = process.env.SCW_DEFAULT_REGION || 'fr-par';
const ZONE = process.env.SCW_DEFAULT_ZONE || 'fr-par-1';

function creds() {
  const secret = process.env.SCW_SECRET_KEY;
  const project = process.env.SCW_DEFAULT_PROJECT_ID;
  if (!secret || !project) {
    throw new Error('SCW_SECRET_KEY and SCW_DEFAULT_PROJECT_ID are required (node --env-file=…)');
  }
  return { secret, project };
}

async function api(method, path, body) {
  const { secret } = creds();
  const res = await fetch(`https://api.scaleway.com${path}`, {
    method,
    headers: { 'x-auth-token': secret, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A Kapsule cluster requires a private network, and creating one is not implicit over the API.
// It is created here so that `destroyCluster` can delete it again: a leftover private network is
// free, but it keeps the project from being provably empty.
export async function createPrivateNetwork(name) {
  const { project } = creds();
  const existing = await api('GET', `/vpc/v2/regions/${REGION}/private-networks?project_id=${project}&name=${name}`);
  const found = (existing.private_networks || []).find((n) => n.name === name);
  if (found) return found;
  return api('POST', `/vpc/v2/regions/${REGION}/private-networks`, { name, project_id: project, tags: ['loadtest'] });
}

export async function deletePrivateNetwork(id) {
  await api('DELETE', `/vpc/v2/regions/${REGION}/private-networks/${id}`).catch(() => {});
}

export async function createCluster({ name, nodeType, version = '1.37.0', size = 1, diskGb = 40 }) {
  const { project } = creds();
  const network = await createPrivateNetwork(`${name}-net`);
  const cluster = await api('POST', `/k8s/v1/regions/${REGION}/clusters`, {
    private_network_id: network.id,
    project_id: project,
    name,
    // "kapsule" is the free, mutualized control plane. Never a Dedicated one: it is billed by the
    // hour and this cluster lives for two.
    type: 'kapsule',
    version,
    cni: 'cilium',
    tags: ['loadtest'],
    pools: [
      {
        name: 'load',
        node_type: nodeType,
        size,
        min_size: size,
        max_size: size,
        autoscaling: false,
        autohealing: false,
        root_volume_size: diskGb * 1000 * 1000 * 1000,
        container_runtime: 'containerd',
      },
    ],
  });
  return cluster;
}

export async function waitReady(id, { timeoutMs = 900000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const c = await api('GET', `/k8s/v1/regions/${REGION}/clusters/${id}`);
    if (c.status === 'ready') return c;
    if (['error', 'locked', 'deleting'].includes(c.status)) throw new Error(`cluster is ${c.status}`);
    await sleep(15000);
  }
  throw new Error('cluster did not become ready');
}

export async function writeKubeconfig(id, path) {
  const kc = await api('GET', `/k8s/v1/regions/${REGION}/clusters/${id}/kubeconfig`);
  writeFileSync(path, Buffer.from(kc.content, 'base64'), { mode: 0o600 });
  return path;
}

export async function destroyCluster(id, { privateNetworkName } = {}) {
  // with_additional_resources deletes the block volumes and load balancers this cluster created —
  // without it they outlive it and keep being billed.
  await api('DELETE', `/k8s/v1/regions/${REGION}/clusters/${id}?with_additional_resources=true`);
  const until = Date.now() + 900000;
  while (Date.now() < until) {
    try {
      await api('GET', `/k8s/v1/regions/${REGION}/clusters/${id}`);
    } catch (err) {
      if (String(err).includes('-> 404')) {
        if (privateNetworkName) {
          const { project } = creds();
          const nets = await api(
            'GET',
            `/vpc/v2/regions/${REGION}/private-networks?project_id=${project}&name=${privateNetworkName}`,
          );
          for (const n of nets.private_networks || []) await deletePrivateNetwork(n.id);
        }
        return true;
      }
      throw err;
    }
    await sleep(15000);
  }
  throw new Error('cluster is still there after 15 minutes');
}

// What the project still holds, as proof that nothing was left running.
export async function projectContents() {
  const { project } = creds();
  const q = `project=${project}`;
  const [clusters, servers, volumes, lbs, networks] = await Promise.all([
    api('GET', `/k8s/v1/regions/${REGION}/clusters?${q}`),
    api('GET', `/instance/v1/zones/${ZONE}/servers?${q}`),
    api('GET', `/block/v1alpha1/zones/${ZONE}/volumes?${q}`),
    api('GET', `/lb/v1/zones/${ZONE}/lbs?${q}`),
    api('GET', `/vpc/v2/regions/${REGION}/private-networks?${q}`),
  ]);
  // Several of these endpoints answer without a total_count, so each list is counted itself.
  const count = (page, key) => page.total_count ?? (page[key] ?? []).length;
  return {
    clusters: count(clusters, 'clusters'),
    instances: count(servers, 'servers'),
    volumes: count(volumes, 'volumes'),
    loadBalancers: count(lbs, 'lbs'),
    privateNetworks: count(networks, 'private_networks'),
  };
}

// Monthly prices (excl. VAT) of every instance type, for the sizing conclusion.
export async function nodePrices() {
  const res = await fetch(`https://api.scaleway.com/instance/v1/zones/${ZONE}/products/servers?per_page=100`);
  const { servers } = await res.json();
  return Object.entries(servers).map(([name, s]) => ({
    name,
    arch: s.arch,
    vcpu: s.ncpus,
    ramGb: Math.floor(s.ram / 1024 ** 3),
    monthlyEur: s.monthly_price,
  }));
}
