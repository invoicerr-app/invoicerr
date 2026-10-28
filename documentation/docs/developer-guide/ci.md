---
sidebar_position: 14
---

# Continuous Integration

This page documents the parts of `.github/workflows/` a contributor is likely to run into, beyond
the test suites already covered in `CLAUDE.md`'s own CI section.

## Merge queue

Pull requests into `dev` are merged through GitHub's merge queue, never with the merge button
directly. A maintainer adds an approved pull request to the queue; GitHub then builds a temporary
`gh-readonly-queue/dev/pr-<number>-<sha>` branch holding the current `dev`, every pull request
ahead in the queue, and this one, runs the required checks on it, and merges only if they pass. A
pull request whose queue run fails is removed from the queue and stays open.

This is why the workflows that produce required checks listen to `merge_group` next to
`pull_request`:

| Workflow | Required check |
| --- | --- |
| `cypress.yml` | `tests-green` |
| `scenarios.yml` | `scenarios-green` |
| `dco.yml` | `Sign-off check` |
| `codeql.yml` | `Analyze (actions)`, `Analyze (javascript-typescript)` |

A workflow added later that should gate merges needs the same trigger, otherwise the queue waits for
a check that never reports. Under `merge_group` there is no `github.event.pull_request`: `dco.yml`
reads the pull request number from the queue branch name instead. Path filters do not apply to
`merge_group`.

:::info[SonarCloud is not a queue check]
SonarCloud's automatic analysis only analyzes pull requests and the default branch, so it never
reports on a queue branch. Its result gates the pull request itself, before it is queued.
:::

## Workflow rules

SonarCloud analyzes `.github/workflows/` too. A step added to a workflow follows the same rules as
the existing ones:

- **No lifecycle scripts.** Install with `npm ci --ignore-scripts`. A package that needs its
  postinstall gets it as an explicit step instead: `./node_modules/.bin/cypress install` downloads
  the Cypress binary, `./node_modules/.bin/playwright-core install chromium` the PDF browser.
- **No `npx`.** Call the binary the lockfile installed, `./node_modules/.bin/<tool>`. `npx` installs
  a missing package on demand, at whatever version the registry serves that day. A tool no project
  depends on is installed once, at an exact version, with `npm install --prefix /tmp/ci-tools
  --no-save --ignore-scripts <name>@<version>` (see `lighthouse.yml`).
- **Actions pinned by commit SHA**, with the version in a trailing comment
  (`uses: actions/checkout@<sha> # v4`). Renovate keeps both up to date.
- **Least privilege.** The workflow declares a read-only floor at the top (`contents: read`,
  `pull-requests: read` for `dco.yml`, or `{}`), and each job that needs more declares its own
  block. A job-level block replaces the top-level one, so it restates `contents: read` when the job
  checks out the repository. Examples: `packages: write` to push an image, `security-events: write`
  to upload a SARIF report, `pages: read` for `actions/configure-pages`, `pages: write` and
  `id-token: write` only on the job that deploys to GitHub Pages.
- **No `${{ }}` inside a script.** A value from the event, an input, a matrix, `needs` or another
  step's output goes through `env:` and is read as `"$NAME"`. GitHub substitutes `${{ }}` before the
  shell parses the line, so a branch name or a tag containing shell syntax would run as code. The
  rule applies to every expression, not only attacker-controlled ones, so a reviewer never has to
  decide which values are safe.
- **The backend boots from a finished build.** A job that needs a running backend runs
  `npm run build`, then starts it with `npm run start:test:built` (`node dist/src/main` with
  `.env.test`). Never `npm run start:test` in CI: `nest start --watch` copies the `data/*.json`
  catalogues into `dist/` asynchronously and can start the app before they land, which boots it with
  an empty country catalogue and fails specs far from the cause. The country loader refuses an empty
  catalogue directory, so if the files are ever missing the backend exits at boot instead of
  reseeding every country away.
- **A new commit cancels the earlier runs of its pull request.** Every workflow triggered by
  `pull_request` declares a `concurrency` group keyed on the workflow and the pull request number,
  with `cancel-in-progress` true only for `pull_request` events. Runs for `push`, `merge_group`,
  `schedule` and `workflow_dispatch` get a group of their own and are never cancelled, so the merge
  queue and `dev` are not affected. A workflow added later with a `pull_request` trigger copies the
  same block.
- **CI Postgres runs with trust auth.** Service containers set `POSTGRES_HOST_AUTH_METHOD: trust`
  and connection strings carry no password. The database is reachable only from the runner and is
  thrown away with the job.

## External services in the required e2e lane

The `cypress-run` shards gate every merge, so a spec there never waits on a public server it does not
control: a slow or unavailable sandbox would block the merge queue for a reason unrelated to the
change under test. When the backend calls an outside service, the spec points it at a local fake
started from `e2e/cypress.config.ts` instead:

- a URL stored on a row (PDP, SdI, the Portuguese AT webservice) is written by the spec itself,
  toward a fake on an ephemeral port;
- a URL the backend reads from its environment at boot uses a fixed port and a variable set for the
  e2e stack: `ADDRESS_AUTOCOMPLETE_URL` (Photon, port 19876, set in `cypress.yml`),
  `KSEF_TEST_API_URL` (KSeF test API, port 19877, set in `backend/.env.test`) and
  `CHORUS_PRO_SANDBOX_URL` (both PISTE sandbox hosts, port 19878, set in `backend/.env.test`);
- the company register search (`GET /api/company-lookup`), which the onboarding wizard awaits
  before its company step, is answered in the browser: a spec that drives the wizard with a country
  that has a register calls `cy.stubCompanyLookup()` before it. Without it, a register that hangs
  holds the wizard for up to eight seconds per provider in the chain, longer than the spec waits.
  `18-onboarding-wizard.cy.ts` is the one exception: its France case tests the lookup itself and
  reaches the real chain on purpose.

The KSeF and Chorus Pro variables only repoint the test or sandbox environment: a channel connected
in production always talks to the real authority, and a unit test next to each client guards that.
The real round trip with each authority belongs in a `*.live.spec.ts` run by `compliance-live.yml`
(see [Live Testing](./live-testing.md)).

## Release notes and the Discord announcement

`.github/release.yml` groups pull requests into the categories GitHub's "Generate release notes"
uses, by label: Features (`feature`), Fixes (`bug`), Per-country compliance (`compliance`),
Documentation (`documentation`), Dependencies (`dependencies`), and everything else under Other
Changes.

:::info[This only works once pull requests carry these labels]
As of this page's last update, merged pull requests in this repository did not carry labels, so
every entry lands in "Other Changes" until that changes. Label a pull request with one of the five
above (or leave it unlabeled for "Other") before it merges if you want it to show up under the
right heading in the next release's notes.
:::

## Documentation build

The changelog at `/changelog` is generated at build time: `documentation/scripts/fetch-changelog.mjs`
fetches every published release and writes one post per release into `documentation/changelog/`.
Docusaurus compiles those posts as MDX, so `documentation/scripts/changelog-post.mjs` makes each
release body MDX-safe first: HTML comments (GitHub's generated notes open with one) are dropped, and
`{`, `}` and `<` outside code are escaped. Its tests run with `npm test` in `documentation/`.

`docs.yml` runs those tests and the full site build on every pull request to `dev` or `main` that
touches `documentation/`. `docs-deploy.yml` builds and publishes the site after a push to `dev`.
A release body is not part of any pull request, so a new kind of breakage in release notes still
shows up first on the next deploy or the next documentation pull request.

## DCO check

`dco.yml` runs on every pull request targeting `dev` or `main`. It reads the pull request's commits
through the GitHub API and fails if one of them has no `Signed-off-by` line matching its author, as
required by [`CONTRIBUTING.md`](https://github.com/invoicerr-app/invoicerr/blob/dev/CONTRIBUTING.md).
Merge commits, bot commits and the commits Hosted Weblate makes for translators are skipped, since
none of them can run `git commit -s`. The failing run names each offending commit; fix it with
`git rebase --signoff <base-branch>` and a force-push.

It also runs on every merge queue entry, reading the pull request number from the queue branch
name, so it can be a required check of the queue.

`release-discord.yml` posts a short summary of every published **pre-release** to the Discord
announcements channel, through a webhook kept as the `DISCORD_RELEASES_WEBHOOK` repository secret.
A full release (the pre-release checkbox left unticked) never posts here; see
`docker-publish.yml` for why only an unchecked pre-release box is what ships an image to
`:latest`, which this workflow does not touch.

Without the secret configured, the workflow logs a notice and skips cleanly rather than failing
the run. `workflow_dispatch` can simulate a pre-release publish (with made-up release details) to
exercise that skip path, or the real posting once the secret is set, without waiting for an actual
release.

## Backend dependency updates

Two rules for anyone, Renovate included, who changes `backend/package.json` or its lockfile:

- **The NestJS framework packages move together.** `@nestjs/common`, `@nestjs/core`,
  `@nestjs/platform-express` and `@nestjs/testing` are released together and stay on one version.
  `@nestjs/platform-express` imports internals of `@nestjs/core` from the same release, so a lockfile
  that moves it alone breaks every spec that loads an upload controller, and the backend never boots:
  `The requested module '@nestjs/core/internal' does not provide an export named ...`.
- **`multer` is overridden.** `@nestjs/platform-express` pins an exact `multer`, and
  `FileInterceptor` parses uploads with that copy, not with the backend's own dependency. The
  `overrides` entry `"multer": "$multer"` makes both the version `backend/package.json` names. After a
  `multer` update, `npm ls multer` shows a single version, `deduped` under `@nestjs/platform-express`.

## Docker image vulnerability scanning (Trivy)

Every image this repository builds and pushes gets scanned for known OS package and Node
dependency vulnerabilities with [Trivy](https://trivy.dev):

- `docker-dev.yml` scans the `dev-...` tag right after pushing it to `ghcr.io`.
- `docker-publish.yml` scans the release (or `:test-workflow`) manifest right after it is created.
- `trivy.yml` builds the Dockerfile locally (never pushed) on a pull request that touches the
  Dockerfile or either of the two workflows above, so a change to the build gets a scan before it
  reaches `dev`.

Each scan runs twice:

1. A full report, every severity, uploaded as SARIF to the repository's **Security** tab
   (`Security` > `Code scanning`). This is informational: nothing in it fails the build.
2. A gate restricted to `CRITICAL` findings with a known fix (`ignore-unfixed: true`). Only this
   second run can fail the job.

:::info[The gate starts narrow on purpose]
Only fixable CRITICAL findings fail CI today. A finding with no available fix would fail every
run forever with nothing anyone could do about it, so it is reported but not gated. Widening the
gate to HIGH, or dropping `ignore-unfixed`, is a deliberate follow-up once the current baseline of
findings is known and triaged, not something to do by just editing the `severity` input.
:::

## API latency

`api-latency.yml` measures p50, p95 and p99 of every API route with k6 on a stack local to the
runner, comments the comparison on pull requests labelled `perf` or touching `backend/`, and keeps a
nightly history plotted on the [API latency](/api-latency) page. It never fails on a regression and
never runs in the merge queue. See [API latency tracking](./api-latency.md).

## Lighthouse CI on the frontend

`lighthouse.yml` audits the logged-in screens with [`@lhci/cli`](https://github.com/GoogleChrome/lighthouse-ci).
It brings up the same stack as the Cypress job (Postgres, Redis, the backend, the built frontend),
seeds a test account with a company, a client, a quote and an invoice through the API
(`.github/lighthouse/seed.sh`), signs in with a Puppeteer script (`.github/lighthouse/login.cjs`) and
audits:

- `/dashboard`
- `/documents/invoice` and `/documents/quote` (the lists)
- `/documents/invoice/:id` (a draft invoice, which is the invoice editor) and `/documents/quote/:id`
- `/settings/company`

The "new document" dialog opens from a button and has no URL of its own, so it cannot be audited by a
page load.

It runs when `dev` is merged into `main` (a pull request targeting `main`), and by hand: open the
Actions tab, pick **Lighthouse CI** and use **Run workflow** on the branch you want to measure.

The Performance, Accessibility, Best Practices and SEO scores, with the final URL of each page, go to
the run summary and, on a pull request, to a single comment updated in place. The full reports are the
`lighthouse-report` artifact.

:::info[A redirect fails the job]
Every audited page must end on the path that was requested. A redirect to the sign-in page would
still get a score, so the job fails instead of reporting it.
:::

Accessibility is gated: a score below 100 on any audited page fails the job, and the summary lists
the failing audits per page. Performance, Best Practices and SEO stay informative. See
[UI Conventions](./ui-conventions.md#accessibility-checks) for the axe checks that catch the same
problems earlier, on every pull request.
