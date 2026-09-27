# Load test: how much machine Invoicerr needs per active user

Measures CPU, memory, latency and queue backlog of a full Invoicerr install (API, workers, Postgres,
Redis, OCR) while N people invoice without pause. It exists to size a node from a measurement rather
than from a pod count, and to tell whether a change — a faster OCR, a lighter PDF path — actually
moved anything.

One command creates a throwaway Scaleway cluster, deploys the chart on it, seeds the users, runs the
stages, writes the report and **destroys the cluster**:

```bash
node --env-file=<file holding the Scaleway key> loadtest.js
# or, from this directory:
npm run loadtest
```

The cluster is looked up by name (`invoicerr-loadtest`): a second run reuses the one already there
rather than paying for a second. It is destroyed when the run ends, failure included, unless
`--keep` is passed; `npm run loadtest -- --destroy` then removes it and prints what the project
still holds.

## Everything JavaScript

| File | What it is |
|---|---|
| `loadtest.js` | the command above: cluster, deploy, seed, stages, report, teardown |
| `scenario.js` | the k6 script — one virtual user's loop |
| `seed.js` | creates N users, each with a German company, 3 clients and 3 articles |
| `report.js` | writes `REPORT.md` for a run, or compares two runs |
| `lib/cluster.js` | Scaleway's public API: create, wait, kubeconfig, destroy, what the project holds |
| `lib/k8s.js` | kubectl/helm: deploy, sample `kubectl top`, read the queue and Postgres connections |
| `lib/report.js` | CSV + k6 summaries → tables |
| `values-loadtest.yaml` | the Helm values for the throwaway install |
| `scanned-supplier-invoice.pdf` | an image-only PDF, so the OCR step really runs OCR |

## The scenario

Each loop (`scenario.js`), per virtual user:

1. dashboard: `get-session`, `company/info`, `documents/dashboard`;
2. lists: quotes, invoices, clients;
3. a 5-line quote, converted to an invoice;
4. the draft invoice's PDF (synchronous Chromium render in the api pod), then `send` — numbering,
   Chromium render in a worker, archive, e-mail — polled until `sent`;
5. every 5th loop: a scanned supplier invoice uploaded for OCR (skipped with `--no-scan`).

Each virtual user has its own seeded user and company. Germany is used because its channel policy
imposes no transmission channel, so `send` goes through the whole render path and ends in e-mail.

A virtual user works without pauses, so it is worth many real customers: read the `sent/min` column
rather than the VU count when comparing against real usage.

## Options

```
--stages 1,2,10,50     virtual users per stage
--duration 5m          length of each stage
--users 50             users to seed (defaults to the largest stage)
--node BASIC2-A6C-24G  Scaleway node type to measure
--image <ref>          image repository or digest to deploy (e.g. a branch build to compare)
--set a=b              extra Helm --set, repeatable (e.g. --set worker.replicaCount=6)
--out results/<name>   where to write the run
--scan <file>          the PDF used for the OCR step / --no-scan to skip it
--keep                 leave the cluster running
--destroy              destroy the named cluster, then exit
--reuse-ip <ip>        load an instance already running, create nothing
--spread-across-nodes  podAntiAffinity so api replicas prefer separate nodes (needs --nodes > 1)
--ocr-pool <type>      a second, single-node pool tainted for the OCR pod alone
--kill-a-node-at <dur> mid-run (e.g. 3m), delete one pool node and time the Ready-count recovery
```

Comparing a change:

```bash
npm run loadtest -- --image ghcr.io/invoicerr-app/invoicerr@sha256:<new> --out results/after --keep
npm run loadtest:compare -- results/<before> results/after
```

## Credentials

The Scaleway key is never read from this repository. Put `SCW_SECRET_KEY`,
`SCW_DEFAULT_PROJECT_ID` and `SCW_DEFAULT_ORGANIZATION_ID` in a file of your own and pass it with
`node --env-file=…`. The key needs, on the load-test project alone: `KubernetesFullAccess`,
`InstancesFullAccess`, `BlockStorageFullAccess`, `LoadBalancersFullAccess`, `VPCFullAccess` and
`PrivateNetworksFullAccess`.

Use a project of its own, so deleting the project deletes everything the test could have left.

`users.json` inside a run directory holds throwaway credentials and live session cookies; run
directories keep their `kubeconfig` and `secrets.yaml` too. All three are git-ignored.

## Nothing leaves the cluster

- mail goes to an in-cluster Mailpit;
- no company has a transmission channel configured (Germany: e-mail);
- billing is off (`WARNING__ENABLE_BILLING_FOR_USERS__WARNING` unset), so Polar is never called;
- archives and uploads stay on the node's own disk.

## What a run directory holds

| File | Content |
|---|---|
| `REPORT.md` | the summary tables |
| `k6-<stage>.json` / `.txt` | k6's own summary, with one latency line per step |
| `pods.csv`, `nodes.csv` | `kubectl top` every 15 s |
| `queue.csv` | `document-action` queue depth and Postgres connections every 15 s |
| `stage-end.csv` | the queue when k6 stopped, and how long it took to drain |
| `node-kill.csv` | `--kill-a-node-at` only: when a node was killed, which one, and when the cluster showed a Ready node count again |
| `project-after.json` | what the Scaleway project still held after teardown |

## Things this harness works around, on purpose

- **Rate limits.** Nest's throttler allows 120 requests per minute per client IP and per route. k6
  sends one `X-Forwarded-For` per virtual user, and `trustProxyHops: "2"` makes that address the
  client IP, so each virtual user gets its own bucket as a distinct person would.
- **Sign-in.** better-auth's own limiter (3 sign-ins per 10 s) keys on the raw `X-Forwarded-For`
  header, which always holds two entries behind the in-pod nginx, so the cap lands on the whole
  instance rather than on each client. Runs therefore reuse the sessions created at seed time;
  `LOGIN=1` makes k6 sign in anyway.
- **The session cookie** is `__Secure-better-auth.session_token` with the Secure flag in production,
  so it is replayed by hand over plain http.
- **First install uses `--no-hooks`.** The chart's pre-install hook runs migrations before the
  bundled Postgres exists, so a fresh install with `postgresql.enabled` cannot succeed with hooks
  on. The upgrade that follows runs the same hook once the database answers.
- **Postgres and Redis persistence are off** in `values-loadtest.yaml` — see the comment there for
  the two chart defects that avoids on real block storage.
