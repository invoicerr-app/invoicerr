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

`release-discord.yml` posts a short summary of every published **pre-release** to the Discord
announcements channel, through a webhook kept as the `DISCORD_RELEASES_WEBHOOK` repository secret.
A full release (the pre-release checkbox left unticked) never posts here; see
`docker-publish.yml` for why only an unchecked pre-release box is what ships an image to
`:latest`, which this workflow does not touch.

Without the secret configured, the workflow logs a notice and skips cleanly rather than failing
the run. `workflow_dispatch` can simulate a pre-release publish (with made-up release details) to
exercise that skip path, or the real posting once the secret is set, without waiting for an actual
release.

## Lighthouse CI on the frontend

`lighthouse.yml` runs on a pull request that touches `frontend/`: it builds the frontend, serves
the static build, and audits it with [`@lhci/cli`](https://github.com/GoogleChrome/lighthouse-ci),
posting the Performance, Accessibility, Best Practices and SEO scores as a comment on the pull
request (updated in place on every push, rather than piling up a new comment each time) and
uploading the full report as a `lighthouse-report` artifact.

:::info[Only the sign-in page is covered today]
The dashboard and the document/invoice screens sit behind the app's auth layout, which this job
cannot reach: it serves a plain static build with no backend behind it, so there is no session to
authenticate with. Covering those screens needs the full stack (Postgres, Redis, the backend) plus
a seeded, authenticated session, the same shape of setup the Cypress e2e suites already pay for.
That is a bigger lift than this first pass, and is left for a follow-up once this baseline is
useful.
:::

This is informative only: no score failing the pull request yet. Budgets (a minimum score below
which the job fails) are a deliberate follow-up once a baseline of real scores exists, not
something to add by just editing this file.
