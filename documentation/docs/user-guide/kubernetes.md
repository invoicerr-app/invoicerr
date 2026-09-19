---
sidebar_position: 0.6
---

# Kubernetes Deployment

For running Invoicerr on more than one host, use the Helm chart at `deploy/helm/invoicerr/` in the
repository instead of `docker-compose.yml`. It deploys the same image in two roles — `api`
(nginx + the Nest API, runs Prisma migrations at boot) and `worker` (the BullMQ document-action
queue consumer) — as independently-scaled Deployments, plus Redis, an optional OCR service, and an
Ingress.

:::info Reference deployment
This guide follows the setup this project actually runs in production: **Scaleway Kubernetes
Kapsule** (Paris), **Scaleway Object Storage** for the legal document archive, and **Scaleway
Managed Database for PostgreSQL** (Paris) for the database — one provider, one region, for every
piece of it. Any conformant Kubernetes cluster, S3-compatible store, and Postgres instance work the
same way — swap the provider-specific values where noted.
:::

## Prerequisites

- A Kubernetes cluster (1.28+) and `kubectl` pointed at it.
- [Helm 3](https://helm.sh/docs/intro/install/).
- An `ingress-nginx` controller and `cert-manager` installed in the cluster **if** you use the
  chart's bundled Ingress (`ingress.enabled: true`, the default). Skip both and set
  `ingress.enabled: false` if you front the cluster with something else.
- An S3-compatible bucket for the legal document archive (`archive.storage: s3`, this chart's
  default — see the warning below on why `local` does not survive more than one replica).
- A Postgres database, unless you only need `postgresql.enabled: true`'s bundled, single-replica,
  **dev/kind-only** Postgres (no HA, no backups — never use it for anything real).

:::warning Why `archive.storage` defaults to `s3`
`backend/src/modules/documents/archive/**` is the legal document archive — content-hash-addressed,
WORM-discipline storage that a country's retention law can require for years. Its `local` mode
writes to the pod's own filesystem: safe on a single instance, but the moment there is more than
one `api`/`worker` replica, a document archived by one pod is simply not on the disk another pod
reads back from — the exact failure `docker-compose.scale.yml`'s own shared-volume comment
describes for its two-container case. `s3` is the only mode that is safe at `replicaCount > 1` out
of the box.
:::

## 1. Create the cluster — Scaleway Kapsule

Scaleway's Kubernetes control plane is free; you only pay for the worker nodes. From the
[Scaleway Console](https://console.scaleway.com/): **Kubernetes → Create a cluster**, region
**Paris (`fr-par`)**, add a node pool sized for Invoicerr + Postgres/Redis (2 vCPU / 4 GB per node
is a reasonable starting point for a small install). Download the kubeconfig from the cluster's
"Overview" tab and point `kubectl`/`KUBECONFIG` at it. The [`scw` CLI](https://github.com/scaleway/scaleway-cli)
can do the same non-interactively — see `scw k8s cluster create --help` for the exact flags for
your Scaleway CLI version.

Install `ingress-nginx` and `cert-manager` (skip if you set `ingress.enabled: false`):

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace

helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
  --set crds.enabled=true
```

Then create the `ClusterIssuer` the chart's Ingress references (`ingress.clusterIssuer`, default
`letsencrypt`):

```yaml title="cluster-issuer.yaml"
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: you@example.com
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
```

```bash
kubectl apply -f cluster-issuer.yaml
```

## 2. Create the archive bucket — Scaleway Object Storage

**Object Storage → Create a bucket**, region `fr-par`. Then **IAM → API Keys → Generate an API
key** scoped to that bucket (a project-level key with Object Storage read/write is enough — do not
reuse an admin-level key). You need the bucket name, the access key, and the secret key — the chart
reads these as `ARCHIVE_S3_BUCKET`, `ARCHIVE_S3_ACCESS_KEY_ID`, `ARCHIVE_S3_SECRET_ACCESS_KEY`. The
endpoint and region are fixed for Scaleway: `https://s3.fr-par.scw.cloud` / `fr-par`.

WORM/immutability (Object Lock) is exposed as a standard S3 API feature — if your bucket has Object
Lock + versioning enabled with a default retention configured (a one-time bucket-level setting, not
something this chart's install touches), every object this app writes inherits that retention
automatically, no per-request code change needed. This session did not independently verify
Scaleway Object Storage's own Object Lock support against its docs — check
[Scaleway's Object Storage documentation](https://www.scaleway.com/en/docs/object-storage/) before
relying on it for a compliance requirement.

## 3. Create the database — Scaleway Managed Database for PostgreSQL

[Scaleway's Managed Database for PostgreSQL and MySQL](https://www.scaleway.com/en/database/) is a
traditional, fixed-size managed Postgres — you pick a node size, not a request-based scaler. From
the [Scaleway Console](https://console.scaleway.com/): **Managed Databases → PostgreSQL and MySQL →
Create a Database Instance**, region **Paris (`fr-par`)** — the same region as the cluster and the
archive bucket, so every piece of the Service sits in one place.

This chart's reference deployment attaches the Database Instance to the same **Private Network** as
the Kapsule cluster, so the `api`/`worker` pods reach it over Scaleway's own network rather than the
public internet — see Scaleway's own "Connecting Managed Databases to Kubernetes clusters" guide for
the exact steps, which vary slightly by Console version. If you skip this, use the Database
Instance's **Manage allowed IPs** setting to restrict its public endpoint instead of leaving it open
to the internet.

The Console's **Connection Details** panel gives you a **single** endpoint — hostname, port,
database name, user, password. Unlike this chart's previous reference provider (Neon, a serverless
Postgres that fronted every connection with its own PgBouncer), Scaleway does not put a
transaction-mode pooler in front of a Database Instance: the one connection string you get back
already is a direct connection. Build it from those values and append `?sslmode=require`.

### About `DATABASE_URL_UNPOOLED`

The chart also accepts an optional `DATABASE_URL_UNPOOLED` (api pod and the `catalogs-release` hook
Job only): `backend/src/prisma/sync-schema.ts` prefers it — falling back to `DATABASE_URL` when
unset — for the one-off `prisma migrate deploy`/`db push` it runs at api-pod boot, and the
`catalogs-release` Job does the same for its own `migrate deploy` step. It exists because Prisma
Migrate takes a session-level advisory lock that does not reliably survive a **transaction-mode
connection pooler** sitting in front of the database — Neon fronted every connection with exactly
that, so migrations needed a separate, unpooled string to bypass it.

Scaleway's Managed Database does not front your connection with a transaction-mode pooler at all —
the single endpoint above is already the direct connection Prisma Migrate needs. There is nothing
left for `DATABASE_URL_UNPOOLED` to point to that would differ from `DATABASE_URL`: **leave it
unset**. The chart's own fallback to `DATABASE_URL` when it is unset (`deployment-api.yaml` and the
`catalogs-release` Job) already does the right thing without it — it is not a variable this
deployment needs to satisfy.

**Backups**: Scaleway takes automated backups of a Database Instance and also lets you trigger
on-demand snapshots — see
[Scaleway's own backup documentation](https://www.scaleway.com/en/docs/managed-databases-for-postgresql-and-mysql/how-to/manage-backups/)
for the schedule, retention, and point-in-time-restore granularity your plan actually gets; this
guide did not independently verify those specifics, so check that page before relying on a
particular recovery point for a compliance requirement. No `pg_dump` CronJob is required for a
Scaleway-backed install; this chart does not ship one (an optional
scheduled-`pg_dump`-to-object-storage CronJob is reasonable to add later for an extra, provider-
independent copy — it is not part of this chart today).

## 4. Redis

Bundled by default (a plain, dependency-free Deployment+PVC — see `values.yaml`'s own `redis`
comment for why this is not the Bitnami subchart). For a managed/HA Redis instead, set
`redis.external.host` (and `redis.external.port` if not 6379) — no Redis resources render at all
once that is set.

## 5. Create the Secret

```bash
kubectl create secret generic invoicerr-secrets \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL="postgresql://<user>:<password>@<endpoint>:<port>/<db>?sslmode=require" \
  --from-literal=ARCHIVE_S3_ACCESS_KEY_ID="<scaleway access key>" \
  --from-literal=ARCHIVE_S3_SECRET_ACCESS_KEY="<scaleway secret key>"
```

`<endpoint>`, `<port>`, and `<db>` come from the Database Instance's own **Connection Details** panel
(step 3). `DATABASE_URL_UNPOOLED` is deliberately omitted — see "About `DATABASE_URL_UNPOOLED`" in
step 3 for why it has nothing to point to on this provider.

Never commit these values. For a real operation, prefer a secrets manager
(`sealed-secrets`, `external-secrets`, your CI/CD's own vault integration) that renders this exact
Secret rather than a plaintext `kubectl create` typed by hand — the command above is the quickest
path for a first install.

## 6. Install

```yaml title="values.prod.yaml"
image:
  repository: ghcr.io/invoicerr-app/invoicerr
  tag: "v1.5.0" # pin a real tag/digest — never "latest" for anything you operate

existingSecret: invoicerr-secrets

postgresql:
  enabled: false # Scaleway Managed Database is external — see step 3

archive:
  storage: s3
  s3:
    bucket: invoicerr-archive
    endpoint: https://s3.fr-par.scw.cloud
    region: fr-par
    forcePathStyle: false

app:
  appUrl: "https://my.invoicerr.app"
  corsOrigins: "https://my.invoicerr.app"

ingress:
  enabled: true
  className: nginx
  clusterIssuer: letsencrypt
  host: my.invoicerr.app
```

```bash
helm install invoicerr deploy/helm/invoicerr -f values.prod.yaml
```

`helm upgrade invoicerr deploy/helm/invoicerr -f values.prod.yaml` re-applies the same file for any
later change (including a new `image.tag`).

## 7. Verify

```bash
kubectl get pods -l app.kubernetes.io/instance=invoicerr
```

The api pod runs Prisma migrations before its readiness probe (`GET /api/health`) can pass — give
it a little longer than a normal boot on first install. Without a public DNS record yet, check it
directly:

```bash
kubectl port-forward svc/invoicerr-api 8080:80
curl http://localhost:8080/api/health
# {"status":"ok","database":"up"}
```

Once `my.invoicerr.app` resolves to the Ingress's external IP (`kubectl get ingress`) and
cert-manager has issued the certificate (`kubectl get certificate`), the app is reachable at
`https://my.invoicerr.app`.

## Updating

1. Bump `image.tag` in your values file to the new release.
2. `helm upgrade invoicerr deploy/helm/invoicerr -f values.prod.yaml`.
3. Helm runs a `catalogs-release` Job as a `pre-upgrade` hook **before** the api/worker Deployments
   roll out — `kubectl logs job/invoicerr-catalogs-release` shows it. It applies pending migrations
   and then runs `npm run catalogs:release`, the only thing allowed to remove a country's rows
   (document-action policy, identifier requirements, B2G routing) once that country drops out of a
   catalog — every per-pod boot path only ever adds/updates rows for its own replicas, never purges,
   precisely so an old replica mid-rollout can never delete a country a newer one already seeded. A
   failed Job blocks the upgrade and is left in place (not auto-deleted) so its logs stay readable.
4. Watch the api pod's logs during the rollout too — migrations also run there automatically
   (`backend/src/prisma/sync-schema.ts`, redundantly-safe after step 3), same as every other
   Invoicerr upgrade.
5. `helm rollback invoicerr` reverts the Kubernetes objects to the previous revision if something
   goes wrong — it does **not** revert a database migration or catalog purge that already ran; check
   the release notes for the version you are rolling back from before relying on it for either.

## Operational notes from a real install

A few things worth knowing before your first install, found while proving this chart end-to-end
against a real cluster:

- **First-boot ordering.** A Kubernetes Deployment has no equivalent of `docker-compose.yml`'s
  `depends_on: condition: service_healthy`: `api` and `worker` start at the same time as Redis and
  each other. The chart's `api` and `worker` Deployments carry `initContainers` that wait for Redis
  to be reachable (both need it — BullMQ) and, for `worker`, for `api`'s own `/api/health` to answer
  (migrations only run there) — without them, a fresh install's first minute shows a
  `CrashLoopBackOff` or two before everything settles on its own. If you see this on an OLDER chart
  version without these `initContainers`, it is expected and self-healing, just noisy.
- **Memory.** Sending an invoice renders a PDF through a real headless Chromium
  (`playwright-core`, see `CLAUDE.md`'s "pdf-renderer-needs-chromium") — a much heavier one-off
  spike than either pod's steady-state footprint. The chart's default memory limits (768Mi for both
  `api` and `worker`) were sized to survive this in a real test; profile your own invoice volumes
  and PDF complexity before shrinking them.
- **`archive.storage: local` and `documents.persistence`.** The `documents-data` PVC (mounted at
  `/data` on both `api` and `worker`) is `ReadWriteOnce` by default. That is fine for
  `DOCUMENTS_INBOUND_DIR` (received-invoice uploads have no S3 backend today) but will silently
  break `DOCUMENTS_ARCHIVE_DIR` the moment you scale past one node unless the StorageClass is
  ReadWriteMany-capable (NFS, EFS/Filestore-equivalent, Longhorn…) — another reason `s3` is this
  chart's default for the archive specifically.
