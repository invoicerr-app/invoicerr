---
sidebar_position: 14
---

# Continuous Integration

This page documents the parts of `.github/workflows/` a contributor is likely to run into, beyond
the test suites already covered in `CLAUDE.md`'s own CI section.

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

## DCO check

`dco.yml` runs on every pull request targeting `dev` or `main`. It reads the pull request's commits
through the GitHub API and fails if one of them (other than a merge commit or a bot commit) has no
`Signed-off-by` line matching its author, as required by
[`CONTRIBUTING.md`](https://github.com/invoicerr-app/invoicerr/blob/dev/CONTRIBUTING.md).
The failing run names each offending commit; fix it with `git rebase --signoff <base-branch>` and a
force-push.

:::info[Not required by branch protection]
This check runs and reports, but a pull request can still be merged while it is red until branch
protection is updated to require it.
:::

`release-discord.yml` posts a short summary of every published **pre-release** to the Discord
announcements channel, through a webhook kept as the `DISCORD_RELEASES_WEBHOOK` repository secret.
A full release (the pre-release checkbox left unticked) never posts here; see
`docker-publish.yml` for why only an unchecked pre-release box is what ships an image to
`:latest`, which this workflow does not touch.

Without the secret configured, the workflow logs a notice and skips cleanly rather than failing
the run. `workflow_dispatch` can simulate a pre-release publish (with made-up release details) to
exercise that skip path, or the real posting once the secret is set, without waiting for an actual
release.

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

This is informative only: no score failing the pull request yet. Budgets (a minimum score below
which the job fails) are a deliberate follow-up once a baseline of real scores exists, not
something to add by just editing this file.
