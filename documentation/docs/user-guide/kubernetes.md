---
sidebar_position: 0.6
---

# Kubernetes Deployment

For running Invoicerr on more than one host, use the Helm chart at `deploy/helm/invoicerr/` in the
repository instead of `docker-compose.yml`. It deploys the same image in two roles — `api`
(nginx + the Nest API, runs Prisma migrations at boot) and `worker` (the BullMQ document-action
queue consumer) — as independently-scaled Deployments, plus Redis, an optional OCR service, and an
Ingress.

:::info[Reference deployment]
This guide follows the setup this project actually runs in production: **Scaleway Kubernetes
Kapsule** (Paris), **Scaleway Object Storage** for the legal document archive, and **Scaleway
Managed Database for PostgreSQL** (Paris) for the database — one provider, one region, for every
piece of it. Any conformant Kubernetes cluster, S3-compatible store, and Postgres instance work the
same way — swap the provider-specific values where noted.
:::

## Prerequisites

- A Kubernetes cluster (1.28+) and `kubectl` pointed at it.
- [Helm 3](https://helm.sh/docs/intro/install/).
- **A DNS name for the instance, and HTTPS in front of it.** Neither is optional, and neither fails
  in a way that looks like what it is — see the warning just below, and "The Ingress needs a real
  host name" in step 1.
- An `ingress-nginx` controller and `cert-manager` installed in the cluster **if** you use the
  chart's bundled Ingress (`ingress.enabled: true`, the default). Skip both and set
  `ingress.enabled: false` if you front the cluster with something else.
- An S3-compatible bucket for the legal document archive (`archive.storage: s3`, this chart's
  default — see the warning below on why `local` does not survive more than one replica).
- A Postgres database, unless you only need `postgresql.enabled: true`'s bundled, single-replica,
  **dev/kind-only** Postgres (no HA, no backups — never use it for anything real).

:::warning[HTTPS is a prerequisite, and it fails looking like a login bug]
`backend/src/lib/auth.ts` configures better-auth with
`advanced.useSecureCookies: process.env.NODE_ENV === 'production'`, and the published image sets
`ENV NODE_ENV=production` (repository `Dockerfile`, runtime stage). Every session cookie this
deployment mints is therefore named with the `__Secure-` prefix and carries the `Secure` attribute —
and a browser refuses to store a `__Secure-` cookie received over plain HTTP.

Served over `http://`, the instance then looks healthy and is not. `GET /api/health` is `@Public()`
(`backend/src/modules/health/health.controller.ts`) and answers `200` with no session at all, so
every probe, `curl` and dashboard stays green. Every other route goes through the global `AuthGuard`
(`backend/src/guards/auth.guard.ts`), finds no session cookie, and throws `UnauthorizedException` —
**401**. The SPA turns that 401 into a redirect to `/auth/sign-in`
(`frontend/src/hooks/use-fetch.ts`), so the visible symptom is "I sign in and land back on the
sign-in page": it reads as broken authentication, and the thing actually missing is TLS. Terminate
HTTPS before debugging anything else.

Same family, same disguise: `app.appUrl` and `app.corsOrigins` must be spelled `https://` as well.
Both feed better-auth's `trustedOrigins` (`backend/src/lib/auth.ts`) and Nest's own
`app.enableCors({ credentials: true, origin: [...] })` (`backend/src/create-app.ts`), and
better-auth compares the browser's `Origin` header against that list as an **exact origin string,
scheme included** — `matchesOriginPattern` reduces to `pattern === getOrigin(url)` for `http:`/
`https:` URLs. An `http://` entry therefore never matches an `https://` page: better-auth answers
**403 `INVALID_ORIGIN`** on its own routes, and Nest's CORS layer omits the
`Access-Control-Allow-Origin` header on the rest, so the browser throws the response away.
:::

:::warning[Why `archive.storage` defaults to `s3`]
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

### If you do not run cert-manager

`deploy/helm/invoicerr/templates/ingress.yaml` emits the
`cert-manager.io/cluster-issuer: {{ .Values.ingress.clusterIssuer }}` annotation
**unconditionally** — it sits in the Ingress's `metadata.annotations`, outside every `if`, and in
particular it is *not* guarded by `ingress.tls.enabled`. Turning TLS off does not remove it, and
`ingress.clusterIssuer: ""` does not either: `helm template` then renders the annotation key with an
empty value rather than dropping the line. There is no values switch that suppresses it.

That is harmless in itself — with no cert-manager in the cluster, no controller watches the
annotation and nothing acts on it. What you do have to decide is where the certificate comes from,
because HTTPS is still required (see the prerequisites above). Two working shapes:

- **Bring your own certificate.** Leave `ingress.tls.enabled: true` and create the Secret the
  template already names, `<ingress.host>-tls`, in the release's namespace yourself:

  ```bash
  kubectl create secret tls my.invoicerr.app-tls --cert=fullchain.pem --key=privkey.pem
  ```

  The Ingress references that exact name (`secretName: {{ .Values.ingress.host }}-tls`), so it
  picks the Secret up with no further configuration. The stray cert-manager annotation is ignored.
- **Terminate TLS in front of the cluster.** Set `ingress.enabled: false`, expose the `api` Service
  through your own Ingress/Gateway/load balancer, and adjust `app.trustProxyHops` to the real number
  of HTTP-aware hops now sitting in front of the pod's own nginx (the chart defaults it to `2`,
  which counts its own bundled Ingress — `values.yaml` explains the count).

### The Ingress needs a real host name

`ingress.host` is not optional and cannot be an IP address. The template always emits
`- host: {{ .Values.ingress.host | quote }}`, and with `ingress.tls.enabled: true` (the default) it
also derives the TLS entry from the same value — `hosts: ["<host>"]` and
`secretName: <host>-tls`. Neither of the two ways to ask for an IP-only install survives:

- Leaving `ingress.host` empty, with the chart's default `ingress.tls.enabled: true`, renders
  `hosts: [""]` and `secretName: -tls`. Kubernetes validates both (`validateIngressTLS`): an empty
  string is not a valid DNS-1123 subdomain, and `-tls` is not a valid Secret name. Switching TLS off
  to get past that is not a route out — HTTPS is a prerequisite here, not a preference.
- Putting the IP in `ingress.host` renders `host: "203.0.113.10"`, which Kubernetes rejects outright
  — `validateIngressRules` fails any rule host that parses as an IP with *"must be a DNS name, not
  an IP address"*.

If you have no domain yet, the workaround is a wildcard DNS service that maps an address back to
itself, such as [nip.io](https://nip.io): `203.0.113.10.nip.io` resolves to `203.0.113.10`, is a
valid DNS name as far as both Kubernetes and the browser are concerned, and can be used as
`ingress.host` and in `app.appUrl` / `app.corsOrigins` as-is. You still have to solve the
certificate for it by one of the two routes above.

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

## Steps 2 and 3 on a bare cluster

Everything above assumes a cloud provider. If you run your own cluster — k3s on three machines,
kubeadm, a rack — you have no managed Object Storage and no managed Postgres, and the chart creates
neither for you. This section is the **alternative to steps 2 and 3 only**: steps 1 and 4 through 7
are unchanged, and so is everything the rest of this guide says about HTTPS, the Secret and
`helm install`.

### Object storage

`archive.storage: s3` is the chart's default and the chart **provisions nothing**. It only passes
values through to the pods — `ARCHIVE_S3_BUCKET` / `ARCHIVE_S3_ENDPOINT` / `ARCHIVE_S3_REGION` /
`ARCHIVE_S3_FORCE_PATH_STYLE` from `values.yaml`, and `ARCHIVE_S3_ACCESS_KEY_ID` /
`ARCHIVE_S3_SECRET_ACCESS_KEY` from the Secret. There has to be a bucket behind them:
`backend/src/modules/documents/archive/s3-storage.ts` throws, deliberately and loudly, when any of
region, access key or secret key is missing, rather than quietly writing a legal archive somewhere
else.

**Falling back to `archive.storage: local` on more than one node does not merely lose documents —
it stops pods from running.** `invoicerr.documentsVolumeNeeded` (`templates/_helpers.tpl`) is true
unless **both** `archive.storage` and `documents.inbound.storage` are `s3`; when it is true,
`deployment-api.yaml` *and* `deployment-worker.yaml` both mount the same `invoicerr-documents` PVC
at `/data`, and `documents.persistence.accessMode` defaults to `ReadWriteOnce`. api and worker are two separate Deployments, so even at the chart's own default of
one replica each, that is two pods with nothing pinning them to the same node. On a multi-node
cluster with ordinary block storage, whichever of the two is scheduled onto the second node never
starts at all: a ReadWriteOnce volume can only be attached to one node at a time, so the pod sits
in `ContainerCreating` with a `FailedAttachVolume` multi-attach event against it. Note that this
applies to the Scaleway path too, which leaves `documents.inbound.storage` at its default `local` —
the PVC is rendered there as well.

**MinIO in the cluster** is the shortest way out, and is what this section was written against:

```bash
helm repo add minio https://charts.min.io/
helm install minio minio/minio -n minio --create-namespace \
  --set mode=standalone \
  --set persistence.size=50Gi \
  --set rootUser=invoicerr \
  --set rootPassword='<a long random string>' \
  --set 'buckets[0].name=invoicerr-archive' \
  --set 'buckets[0].policy=none'
```

`mode=standalone` renders a single-replica Deployment, one PVC, a `minio` Service on port 9000, and
a post-install Job that creates the bucket. Point the chart at it:

```yaml
archive:
  storage: s3
  s3:
    bucket: invoicerr-archive
    endpoint: http://minio.minio.svc.cluster.local:9000
    region: us-east-1
    # REQUIRED here, unlike the Scaleway path. Virtual-hosted-style addressing would have the SDK
    # resolve invoicerr-archive.minio.minio.svc.cluster.local, which no cluster DNS record answers.
    forcePathStyle: true
```

and put MinIO's `rootUser` / `rootPassword` into the Secret of step 5 as
`ARCHIVE_S3_ACCESS_KEY_ID` / `ARCHIVE_S3_SECRET_ACCESS_KEY`. `region` may not be left empty —
`s3-storage.ts` reads it through `requireEnv('ARCHIVE_S3_REGION')` and throws on an empty value —
so it has to say something; `us-east-1` is the conventional value in front of a MinIO endpoint.

That covers the archive. To drop the `/data` PVC altogether — the only configuration that lets api
and worker be scheduled freely across nodes — move the inbound store to object storage as well:
`documents.inbound.storage: s3` with its own `documents.inbound.s3.*` block, a **different** bucket
from the archive's, and `INBOUND_S3_ACCESS_KEY_ID` / `INBOUND_S3_SECRET_ACCESS_KEY` added to the
same Secret. `values.yaml`'s own `documents.inbound` header explains why that store defaults to
`local` and what does *not* migrate itself when you switch it later.

### PostgreSQL

`postgresql.enabled: true` gives you a single-replica Deployment of the public
`postgres` image (`postgresql.image.tag`, `15` by default), one ReadWriteOnce PVC
(`postgresql.persistence.size`, 5Gi by default) and the `invoicerr` / `invoicerr` / `invoicerr_db`
credentials written in clear in `values.yaml`. `values.yaml` calls it dev/kind-only and means it.
Before pointing real invoices at it, know what you are accepting:

- **No replication, no failover, no point-in-time recovery, no connection pooler, no TLS.** Its
  durability is exactly the durability of that one PVC on that one node.
- **No backups, from anything.** This chart ships no `pg_dump` CronJob (see step 3), and nothing
  else in it touches the database's own durability. Scheduling dumps to somewhere off the cluster
  is entirely on you.
- **The PVC is an ordinary chart resource** (`templates/pvc-postgres.yaml`, no
  `helm.sh/resource-policy: keep`), so `helm uninstall` deletes it along with everything else, and
  with a `Delete` reclaim policy the data goes with it.
- **The password is not a Secret on this path.** `invoicerr.bundledDatabaseUrl`
  (`templates/_helpers.tpl`) interpolates `postgresql.auth.*` straight into a literal `DATABASE_URL`
  env value on the api, worker and `catalogs-release` pod specs — readable by anyone who can
  `kubectl get deployment -o yaml`. Change the defaults at a minimum.

For real data on a bare cluster, run Postgres properly and treat it as external, exactly as step 3
does: a Postgres operator (CloudNativePG, Zalando's postgres-operator, …) in the cluster, or a
plain Postgres on a machine outside it. Either way you end up in the same place — `postgresql.enabled:
false` and a `DATABASE_URL` in the Secret — and every remaining step of this guide applies unchanged.
`DATABASE_URL_UNPOOLED` stays unset unless you deliberately put a transaction-mode pooler (PgBouncer)
in front of the database, which is the one case step 3 describes it for.

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

:::warning[Rotating a value in this Secret does not restart the pods that read it]
`deployment-api.yaml`/`deployment-worker.yaml` only render `podAnnotations` you set yourself
(`values.yaml`'s own `api.podAnnotations`/`worker.podAnnotations`) — there is no checksum annotation
computed from the Secret's own content, the pattern many charts use to force a rollout when a Secret
changes. A `kubectl apply`/`helm upgrade` that only changes a value inside `invoicerr-secrets` is
therefore a no-op for every already-running pod: the env var was injected once, at that pod's own
start, and stays whatever it was until the pod restarts for some other reason. After rotating
anything in this Secret — `BETTER_AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `DATABASE_URL`,
the `ARCHIVE_S3_*`/`BACKUP_S3_*` keys — you still have to roll the Deployments yourself:

```bash
kubectl rollout restart deployment/invoicerr-api deployment/invoicerr-worker
```
:::

## 6. Install

```yaml title="values.prod.yaml"
image:
  repository: ghcr.io/invoicerr-app/invoicerr
  tag: "v1.4.5c" # pin an EXISTING tag — see "Which tag?" below; never "latest" for anything you operate

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

### Which tag?

`.github/workflows/docker-publish.yml` is triggered by `release: created`, and the image tag it
pushes is the git tag the release was cut from, verbatim. There is no separate image versioning
scheme: every version-numbered tag on GHCR is a published release of this repository, and the
workflow's other outputs are branch-named tags built for internal testing, which you should never
deploy. List the releases before you pin:

```bash
gh release list --repo invoicerr-app/invoicerr
```

**`:latest` is not the newest tag.** The same workflow only adds `:latest` when the tag it is
building matches what `gh release view` reports as the repository's latest release, and GitHub
excludes pre-releases from that. `v1.4.6a` (2026-07-06) and `v1.4.6b` (2026-07-07) were both
published as **pre-releases**, so neither moved the moving tag: `:latest` still resolves to the
`v1.4.5c` image published on 2026-06-29. Comparing manifest digests on GHCR is how you check this
for yourself, and it needs no credentials for a public package:

```bash
docker buildx imagetools inspect ghcr.io/invoicerr-app/invoicerr:latest
docker buildx imagetools inspect ghcr.io/invoicerr-app/invoicerr:v1.4.5c
```

As of 2026-09-20 both print the same `Digest: sha256:615f4cec…`, while `:v1.4.6b` prints a different
one. This is the concrete reason the guide says to pin: on this repository `latest` means "newest
full release", not "newest thing published", and the two have differed since July 2026.

Pinning a digest is stronger still, and the chart supports it: put the digest on the repository and
leave the tag empty (`repository: ghcr.io/invoicerr-app/invoicerr@sha256:…`, `tag: ""`), which the
templates render correctly — the `:{{ tag }}` suffix is emitted only when `image.tag` is non-empty.

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

- **A first install that hangs on the `catalogs-release` hook — older charts only.** Until commit
  `d6eda9a8`, that `pre-install`/`pre-upgrade` Job named the ServiceAccount this chart itself
  creates. Helm runs `pre-install` hooks to completion *before* applying the chart's ordinary
  manifests, and the ServiceAccount is one of those — so on a fresh namespace the Job asked for an
  identity that could not exist yet and the install deadlocked: the Job sat at `0/1` with **no pod
  at all**, `FailedCreate: serviceaccount "invoicerr" not found` against it, until Helm hit its
  `--timeout` and rolled back. `helm upgrade` was never affected, because a previous release had
  already left the ServiceAccount in the namespace — the only broken case was the one nobody
  rehearses. Current charts are fixed (the Job now falls back to the namespace's `default`
  ServiceAccount, which is all it needs: it writes catalogs to Postgres over `DATABASE_URL` and
  never calls the Kubernetes API —
  `deploy/helm/invoicerr/templates/job-catalogs-release.yaml` carries the full account). Recognise
  the symptom if you install an older chart: `kubectl get job` shows `0/1`, `kubectl get pods`
  shows nothing at all for it, and `kubectl describe job/invoicerr-catalogs-release` names the
  missing ServiceAccount.
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
- **`documents.persistence` is ReadWriteOnce, and that is a scheduling limit before it is a data
  one.** The `/data` PVC is rendered whenever *either* `archive.storage` or
  `documents.inbound.storage` is still `local` (`invoicerr.documentsVolumeNeeded`,
  `templates/_helpers.tpl`) — which includes this guide's own reference values, since
  `documents.inbound.storage` defaults to `local` even with the archive on S3. Both the `api` and
  the `worker` Deployment mount that one claim at `/data`, so on a multi-node cluster with an
  ordinary ReadWriteOnce StorageClass whichever pod lands on the second node cannot attach the
  volume and never starts at all (`ContainerCreating`, `FailedAttachVolume`) — it is not only that
  a document archived by one pod is invisible to the other. Either point
  `documents.persistence.storageClassName` at a ReadWriteMany-capable class (NFS,
  EFS/Filestore-equivalent, Longhorn…), or move **both** stores to `s3` so the PVC and its mounts
  stop being rendered — the "Steps 2 and 3 on a bare cluster" section above works through the
  second option.
