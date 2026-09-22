# How much machine Invoicerr needs per active user — 22 September 2026

Measured on throwaway Scaleway Kapsule clusters (Paris, mutualized control plane), one node each,
image `ghcr.io/invoicerr-app/invoicerr:v2.0.0-alpha.1` pinned by digest
(`sha256:0dcf8588…`), chart `deploy/helm/invoicerr` with its bundled Postgres and Redis, 1 api pod
and 3 worker pods — the beta's own shape. k6 ran from a laptop outside the cluster. Mail went to an
in-cluster Mailpit; no transmission channel, no billing, nothing left the cluster.

Raw data is in `results/`; the harness that produced it is described in `README.md`.

**One virtual user = one person invoicing with no pause at all**, roughly one invoice every 2.5 s.
Compare real usage against the `sent/min` column, not against the number of virtual users.

## What was actually proven

- **Chromium renders on arm64.** The first invoice sent produced a real two-page PDF with correct
  totals (1 150.00 € net, 218.50 € VAT), delivered to Mailpit. The ARM node was never run before.
- **OCR runs on arm64** once `ocr-image` gained an arm64 manifest (2026-09-22): a scanned,
  image-only PDF came back with supplier, invoice number and date extracted by `local-ocr`.
- **No send ever failed** in any stage that stayed up: 0 `send_failed`, 0 timeouts, and the
  `document-action` queue was empty within 1–2 s of the load stopping, at every level.

## The numbers

### Without OCR — what the invoicing path itself costs (`results/run2-no-ocr`)

BASIC2-A6C-24G (arm64, 6 vCPU, 24 GB), 5 minutes per stage.

| Users (no pause) | sent/min | p95 lists | p95 PDF | p95 send call | send→sent | node CPU peak | node RAM peak | queue at end | errors |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 33 | 41 ms | 453 ms | 81 ms | 1.03 s | 1.5 / 6 vCPU | 3.6 GiB | empty | 0 |
| 2 | 62 | 60 ms | 563 ms | 76 ms | 1.04 s | 2.0 / 6 vCPU | 3.7 GiB | empty | 0 |
| 10 | 233 | 93 ms | 1.09 s | 267 ms | 1.09 s | 5.3 / 6 vCPU | 3.8 GiB | empty | 307 × 429 on `get-session` |
| 50 | 258 | 227 ms | 10.2 s | 588 ms | 2.24 s | 5.7 / 6 vCPU | 3.8 GiB | empty | 372 × 429 on `get-session` |

Memory per role at 50 users, peak: api 721 MiB, the three workers 1 685 MiB together, Postgres
121 MiB, Redis 25 MiB. **The 24 GB node never used more than 3.8 GiB, system included.**

### With OCR — where it breaks (`results/run1-1api-3workers`)

Same node, same stages, plus one scanned supplier invoice uploaded every fifth loop.

| Users | OCR upload p95 | node CPU peak | node RAM peak | outcome |
|---|---|---|---|---|
| 1 | 3.8 s | 1.5 vCPU | 2.8 GiB | fine |
| 2 | 3.9 s | 2.3 vCPU | 3.1 GiB | fine |
| 10 | 59.5 s | 6.0 / 6 vCPU | 4.9 GiB | 2 uploads of 52 hit the 60 s timeout |
| 50 | — | 6.0 / 6 vCPU | **22.3 GiB** | the node ran out of memory; see below |

At 50 users the OCR pod alone reached 19 GiB. The kubelet evicted it, Postgres's liveness probe
(`pg_isready`, 1 s timeout) failed under the pressure, Postgres restarted, and every subsequent
request answered 401 — the stage measured the collapse, not the application.

## What saturates first

1. **OCR, by a wide margin.** One pod, `ocrmypdf`, no concurrency cap and — in the chart —
   `ocr.resources: {}`, so no memory limit either. It saturates the six cores at ten users and
   takes the whole node's memory at fifty.
2. **PDF rendering, second.** With OCR out of the picture, the synchronous render in the api pod is
   what queues: p50 goes from 0.41 s (1 user) to 0.83 s (10) to 9.5 s (50), while the send call
   itself stays under 0.6 s. The api pod renders at `PDF_RENDER_CONCURRENCY` (4 by default).
3. **CPU, not memory, and not Postgres.** Postgres peaked at 21 connections of the 100 a stock
   instance allows, and at 121 MiB. The queue never backed up.

## Two limits that will hit real users, not just this test

- **The whole instance is capped at 100 requests per 10 s on `/api/auth/*`, all clients together.**
  Measured: 150 concurrent `get-session` calls from 150 distinct client addresses → 100 answered,
  50 refused with 429; the same 150 calls from a single address → exactly the same split. The cause
  is better-auth's own limiter, which reads the client address from `X-Forwarded-For` only when
  that header holds a single entry — behind the in-pod nginx it always holds two. The SPA calls
  `get-session` on every page load, so this is roughly ten page loads per second for the entire
  deployment.
- **Sign-in is capped at 3 per 10 s for the whole instance**, for the same reason: eight sign-ins
  from eight distinct addresses, the fourth onwards refused. A morning where thirty people log in
  at once means most of them retrying.

Both are a fixed `rateLimit` away in `backend/src/lib/auth.ts`, or a `customRules`/`ip` resolver
that reads the real client address. Neither is a load-test artefact.

## Three chart defects found on the way

1. **A fresh install with `postgresql.enabled: true` cannot succeed.** The `catalogs-release`
   pre-install hook runs `prisma migrate deploy` before the bundled Postgres exists, and fails
   `P1001: Can't reach database server`. Only ever installed on kind, where the same race happened
   to be won. Workaround used here: `--no-hooks` on the first install, then `helm upgrade`.
2. **The bundled Postgres cannot start on real block storage.** The PVC is mounted directly as
   `PGDATA`, and `initdb` refuses a directory containing `lost+found`. It needs a subdirectory
   (`PGDATA=/var/lib/postgresql/data/pgdata`).
3. **The bundled Redis cannot write to its own volume.** `bitnami/redis` runs as uid 1001 and the
   chart sets no `fsGroup`, so `mkdir /bitnami/redis` fails with permission denied.

All three are dev/kind-only paths — production uses an external Postgres and Redis — but they make
the chart's own `postgresql.enabled` path unusable anywhere else.

Also worth fixing: `ocr.resources` and the bundled Postgres/Redis probes (`timeoutSeconds` is left
at 1 s, which is what turned a busy node into a database restart).

## Does a bigger node help? (`results/run3-12core`)

BASIC2-A12C-24G (arm64, 12 vCPU, 24 GB), same chart, same stages, no OCR.

| Users | sent/min | p95 PDF | send→sent p95 | node CPU peak |
|---|---|---|---|---|
| 10 | 264 (6 vCPU node: 233) | 893 ms (1.09 s) | 1.07 s (1.09 s) | 6.5 / 12 vCPU |
| 50 | 352 (6 vCPU node: 258) | 7.07 s (10.2 s) | 1.12 s (2.24 s) | **7.9 / 12 vCPU** |

Twice the cores bought 36 % more throughput, and the node was no longer the thing running out: at
fifty users it sat at 7.9 of 12 vCPU while PDFs still took seven seconds. **The ceiling is one api
pod rendering four PDFs at a time** (`PDF_RENDER_CONCURRENCY`, default 4), not the machine.

## Sizing

What was measured, per node, with 1 api pod and 3 workers:

| Node | arch | vCPU / RAM | €/month (excl. VAT) | sustained | at 50 users |
|---|---|---|---|---|---|
| BASIC2-A6C-24G (today's candidate) | arm64 | 6 / 24 | 65.92 | **233 invoices/min** at 10 users, CPU 5.3/6 | 258/min, PDF p95 10.2 s |
| BASIC2-A12C-24G | arm64 | 12 / 24 | 115.19 | 264/min at 10 users, CPU 6.5/12 | 352/min, PDF p95 7.1 s |

Reading it as a purchase:

1. **Ten users hammering — 233 invoices a minute — fit in six ARM cores.** That is about 14 000
   invoices an hour, far past anything the beta will see. The binding resource is CPU.
2. **The 24 GB are wasted.** Peak memory across every pod, system included, was 3.8 GiB — and that
   was with Chromium rendering continuously. `BASIC2-A6C-12G` (6 vCPU, 12 GB, **57.60 €/month**)
   holds the same load for 8.32 €/month less, and leaves 3× headroom on memory.
   → **For ten hammering users: `BASIC2-A6C-12G`, 57.60 €/month.** Nothing smaller was measured, so
   anything below six cores is a guess, not a number.
3. **For fifty hammering users, buying a bigger node is the wrong move.** The 12-core node costs
   49 € more a month and still renders PDFs in seven seconds, because a single api pod is the
   limit. The cheap experiment — three api replicas on the six-core node — has not been run yet;
   until it is, no node size can be recommended for fifty simultaneous hammering users.
4. **Both figures are hammering users.** A real invoicing customer issues a handful of documents an
   hour, not thirty a minute. Size against the `sent/min` column and your own expected volume.

## What could not be measured

- **The OCR path under a fixed concurrency**: the cap was not in the image tested. The measurement
  above is of an unbounded OCR, which is why it ends in an eviction rather than in a queue. The
  build carrying the asynchronous, two-at-a-time OCR published linux/amd64 only, so it could not
  run on the arm64 node every other number here comes from.
- **More api replicas**, which is the measurement that would actually settle the sizing question:
  `npm run loadtest -- --set api.replicaCount=3 --stages 50`. Until it is run, "three api pods on
  the small node beat one api pod on a big node" is a hypothesis, not a result.
- **A second node / real replication**: every stage ran on a single node, as the production
  candidate does. Nothing here says what a second pool would add.
- **Real-user think time**: every virtual user hammers. The `sent/min` column is the honest axis for
  comparison; the virtual-user count is not.
- **The `latest` OCR image was used by digest** (`sha256:720481a4…`), not a release tag: it had
  just gained arm64 support the same day.
