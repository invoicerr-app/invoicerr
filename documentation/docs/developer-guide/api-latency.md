---
sidebar_position: 16
---

# API latency tracking

`.github/workflows/api-latency.yml` measures the p50, p95 and p99 latency of every API route on a
stack that lives entirely on the GitHub runner: the built backend, Postgres, Redis and Mailpit as
service containers, and [k6](https://grafana.com/docs/k6/) as the client. Nothing leaves the runner
and no secret is used beyond the workflow's own `GITHUB_TOKEN`.

The result is informative. A slower route never fails the check. The job fails only when the
measurement itself is broken: the backend does not boot, the seed fails, or k6 cannot run.

The history is plotted on the [API latency](/api-latency) page of this site.

## When it runs

| Event | What happens |
| --- | --- |
| Pull request to `dev` or `main` labelled `perf` | Measures the pull request and posts the comparison as a comment |
| Pull request touching `backend/` | Same, without the label |
| The `dev` to `main` release pull request | Same, and the run is stored in the history as a `release` record |
| Every night on `dev` (02:17 UTC) | Stored in the history as a `nightly` record |
| **Run workflow** from the Actions tab | Stored as a `nightly` record for the chosen branch |

It never runs in the merge queue, and adding a label other than `perf` does not start it again.

## What is measured

The route list comes from the backend's own OpenAPI document (`/api/docs-json`), so a new route is
measured without editing the scripts, as long as its parameters can be filled.

1. **Seed.** `e2e/perf/seed.mjs` signs up one user (through the load test's own seed,
   `e2e/load/seed.js`) and fills one company to a fixed size: 25 clients, 15 articles, 120 quotes,
   200 draft invoices, 25 sent invoices, a project with time entries, a webhook, a share link and a
   logo. The sizes live in `e2e/perf/fixture.js`; changing them makes the next runs incomparable
   with the previous ones.
2. **Plan.** `e2e/perf/plan.mjs` walks the OpenAPI document. A `GET` route is measured when every
   path parameter resolves to a seeded record and every required query parameter has a value
   (`PATH_PARAMS` and `QUERY_VALUES` in `fixture.js`). Anything else is listed as not measured, with
   the reason.
3. **Measure.** `e2e/perf/latency.js` (k6, one virtual user, one request in flight) makes one
   unrecorded warm-up pass over every `GET` route, then 60 recorded passes. A route whose warm-up
   took more than a second gets 10 passes instead, so one slow export does not set the length of the
   run. It then runs 20 iterations of a scripted scenario for the mutating routes: create, update
   and delete a client, an article, a webhook, a time entry, an expense category and an API key;
   create a project; save a quote, convert it to an invoice and send it (rendered as a PDF and
   e-mailed to Mailpit); create and revoke a share link. The three document actions go through the
   same route, so each is reported on its own line, for example
   `POST /api/documents/types/{typeId}/actions/{actionId} [invoice send]`.

A request counts as an error when it answers 400 or above, or not at all.

:::info[Comparable, not absolute]
Numbers come from a shared GitHub-hosted runner, one request at a time. They show how a route moves
from one run to the next, not what a production instance under load answers. Each record carries
the runner image, its CPU and the k6 version, so a jump caused by a new runner image can be told
apart from one caused by the code.
:::

## Reading the pull request comment

The comment is posted once and updated on every run. Its table compares the head of the pull
request against the **median of the last five nightly runs**, route by route:

| Column | Meaning |
| --- | --- |
| Base p95, Base p99 | Median over the last five nightly records, in milliseconds |
| Head p95, Head p99 | This pull request |
| Delta | Head minus base, in milliseconds and in percent |
| Head p50 | Median latency of this pull request |
| Errors | Share of this route's requests that failed |

Rows are sorted by the largest p95 regression first. A route with no baseline (a new route, or no
nightly run yet) shows `n/a` and comes last. Below the table, a collapsed list names every route
that was not measured and why.

Runner noise of a few milliseconds, or tens of percent on a route that answers in 2 ms, is normal.
What deserves a look is a route that is slower by a clear margin and stays slower when the job is
run again (remove and add the `perf` label, or push).

## The history

Nightly, manual and release runs append one JSON file to the orphan `perf-data` branch, under
`records/<date>-<kind>-<commit>.json`. A record holds the commit, the version (`git describe
--tags`), the date, the runner, the k6 version, every measured route (p50, p95, p99, request count,
error rate) and the list of routes not measured.

`docs-deploy.yml` extracts those records and `documentation/scripts/fetch-api-latency.mjs`, run by
the documentation build, turns them into `static/api-latency.json`, which the
[API latency](/api-latency) page loads. A build without records (a pull request's documentation
check, a local `npm start`) shows the page with no run.

The page shows one route at a time: p95 as a solid line, p99 as a dashed line, and every published
release as a vertical marker. A run is named by its short commit and the last release published
before it, for example `5f5c7415 after 26.11.0`: release tags live on `main`, so the
record's own `git describe` on `dev` would name an older release. Hovering a point shows that name,
the run's date, p50, p95, p99 and error rate. The table below the chart lists the latest run,
slowest first; clicking a route plots it.

`docs-deploy.yml` rebuilds the site when an `API latency` run completes on `dev`, so a new record
reaches the page without waiting for a documentation change.

## Running it locally

The measurement needs a running backend built from the branch, an empty database, Redis, an SMTP
server that accepts anything (Mailpit) and k6 on the `PATH`, or named by `K6`. Swagger must be on,
which it is whenever `NODE_ENV` is not `production`.

```bash
cd backend
npm run build
./node_modules/.bin/dotenv -e .env.test -- node --enable-source-maps dist/src/main &

cd ..
e2e/perf/measure.sh http://localhost:4000 /tmp/api-latency
```

`/tmp/api-latency/result.json` then holds the per-route numbers, `plan.json` the routes and the
reasons for those not measured. To build a record and the comment exactly as CI does:

```bash
PERF_KIND=pr PERF_COMMIT=$(git rev-parse --short=12 HEAD) PERF_RUNNER=local PERF_K6=$(k6 version) \
  node e2e/perf/report.mjs record /tmp/api-latency/result.json /tmp/api-latency/plan.json /tmp/api-latency/record.json
node e2e/perf/report.mjs compare /tmp/api-latency/record.json <directory of records> /tmp/api-latency/comment.md
```

To preview the page with the published history, or with records of your own, point the
documentation build at a directory of records:

```bash
mkdir -p /tmp/api-latency-records
git fetch origin perf-data && git archive FETCH_HEAD records | tar -x -C /tmp/api-latency-records
cd documentation
API_LATENCY_RECORDS=/tmp/api-latency-records/records npm start
```

:::info[Use a fresh database]
Every run signs up a new user and adds its own company and documents next to those of earlier runs.
Start from an empty, migrated and seeded database (`prisma migrate deploy` then `prisma db seed`)
for numbers comparable with CI.
:::

## Extending it

- A new `GET` route whose path parameter is not covered: add the parameter to `PATH_PARAMS` in
  `e2e/perf/fixture.js`, seeding the record in `seed.mjs` if none exists yet.
- A new mutating route: add a step to `scenario()` in `e2e/perf/latency.js` and the route to
  `SCRIPTED` in `fixture.js`.
- A route that cannot be measured on the runner: add it to `EXCLUDED` with the reason, which the
  comment and the page then show.

The pure parts are tested with `node --test` in `e2e/perf/` and `npm test` in `documentation/`.
